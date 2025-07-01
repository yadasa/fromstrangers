// migrateReplaceUrl.cjs

/**
 * CLI tool to:
 *  • Migrate each photo’s `url` → Firebase Storage (once per doc), preserving file extensions
 *  • Then generate a new thumbnail for each migrated URL:
 *      – Images: resize to the width specified in the original `thumbnailLink` (e.g. `=s220`)
 *      – Videos: extract the first frame at that width
 *    and overwrite `photos/{photoId}.thumbnailLink` with the new Storage URL.
 *  • Log original `url` and `thumbnailLink` in `migrationLogs/{photoId}` for undo.
 *
 * Usage:
 *   node migrateReplaceUrl.cjs
 *   node migrateReplaceUrl.cjs undo
 *
 * Prereqs:
 *   npm install firebase-admin googleapis axios cli-progress sharp fluent-ffmpeg @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe
*/

const path        = require('path');
const os          = require('os');
const fs          = require('fs').promises;
const admin       = require('firebase-admin');
const { google }  = require('googleapis');
const axios       = require('axios');
const cliProgress = require('cli-progress');
const sharp       = require('sharp');
const ffmpeg      = require('fluent-ffmpeg');
const ffmpegPath  = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

// configure ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// load configs
const firebaseConfig = require('./firebaseConfig.js');

// initialize Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: firebaseConfig.storageBucket,
});
const db         = admin.firestore();
const bucket     = admin.storage().bucket();
const FieldValue = admin.firestore.FieldValue;

// initialize Drive API via JWT
const driveAuth = new google.auth.JWT({
  email:  serviceAccount.client_email,
  key:    serviceAccount.private_key,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth: driveAuth });

// helper: extract Drive file ID from various URL formats
function extractDriveFileId(url) {
  let m;
  if (m = url.match(/\/d\/([\w-]+)/))            return m[1];
  if (m = url.match(/[?&]id=([\w-]+)/))          return m[1];
  if (m = url.match(/drive-storage\/([\w-]+)=/)) return m[1];
  return null;
}

// helper: map MIME type to file extension
function extFromContentType(type) {
  if (!type) return '';
  const t = type.split(';')[0].trim().toLowerCase();
  switch (t) {
    case 'image/jpeg':      return '.jpg';
    case 'image/png':       return '.png';
    case 'image/gif':       return '.gif';
    case 'image/webp':      return '.webp';
    case 'video/mp4':       return '.mp4';
    case 'video/quicktime': return '.mov';
    case 'video/x-msvideo': return '.avi';
    default:                return '';
  }
}

// unified download: returns { buf, contentType }
async function downloadAndType(url) {
  const fileId = extractDriveFileId(url);
  if (fileId) {
    // fetch metadata for contentType
    const meta = await drive.files.get({ fileId, fields: 'mimeType' });
    const contentType = meta.data.mimeType;
    // fetch bytes
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    return { buf: Buffer.from(res.data), contentType };
  } else {
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    return { buf: Buffer.from(res.data), contentType: res.headers['content-type'] };
  }
}

// video-extension regex
const videoRegex = /\.(mp4|mov|avi|mkv|webm)(\?|$)/i;

async function migrate() {
  await driveAuth.authorize();

  // fetch all photo docs
  const snap = await db.collection('photos').get();
  const docs = snap.docs;

  // 1) URL migration
  const urlDocs = docs.filter(d => {
    const data = d.data();
    return !data.replacedAt && data.url;
  });

  if (urlDocs.length) {
    const urlBar = new cliProgress.SingleBar({
      format: 'Uploading URLs |{bar}| {value}/{total}',
      clearOnComplete: true
    }, cliProgress.Presets.shades_classic);
    urlBar.start(urlDocs.length, 0);

    for (const docSnap of urlDocs) {
      const data = docSnap.data();
      const id   = docSnap.id;
      const ref  = db.collection('photos').doc(id);
      const log  = db.collection('migrationLogs').doc(id);

      try {
        const { buf, contentType } = await downloadAndType(data.url);

        // preserve extension
        const urlPath = data.url.split('?')[0];
        let ext = path.extname(urlPath).toLowerCase();
        if (!ext) ext = extFromContentType(contentType);

        const dstPath = `photos/${id}${ext}`;
        const file    = bucket.file(dstPath);
        await file.save(buf, { metadata: { contentType } });
        await file.makePublic();
        const newUrl = file.publicUrl();

        await log.set({ photoId: id, originalUrl: data.url }, { merge: true });
        await ref.update({
          url:        newUrl,
          replacedAt: FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.error(`URL migrate failed [${docSnap.id}]:`, err.message);
      }

      urlBar.increment();
    }

    urlBar.stop();
  } else {
    console.log('✅ All URLs already migrated.');
  }

  // 2) Thumbnail generation and upload
  const thumbDocs = docs.filter(d => {
    const data = d.data();
    return data.replacedAt && !data.thumbnailReplacedAt && data.thumbnailLink;
  });

  if (thumbDocs.length === 0) {
    console.log('✅ No thumbnails to generate.');
    return;
  }

  const thumbBar = new cliProgress.SingleBar({
    format: 'Thumbnailing     |{bar}| {value}/{total}',
    clearOnComplete: true
  }, cliProgress.Presets.shades_classic);
  thumbBar.start(thumbDocs.length, 0);

  for (const docSnap of thumbDocs) {
    const data      = docSnap.data();
    const id        = docSnap.id;
    const ref       = db.collection('photos').doc(id);
    const log       = db.collection('migrationLogs').doc(id);
    const thumbLink = data.thumbnailLink;

    // determine width from "=s220"
    let size = 220;
    const msz = thumbLink.match(/=s(\d+)/);
    if (msz) size = parseInt(msz[1], 10);

    try {
      let thumbBuf;
      const isVideo = videoRegex.test(thumbLink);

      if (isVideo) {
        // download video to temp file
        const tmpVid = path.join(os.tmpdir(), `${id}.video`);
        const { buf: vidBuf } = await downloadAndType(thumbLink);
        await fs.writeFile(tmpVid, vidBuf);

        // extract first frame
        const tmpJpg = path.join(os.tmpdir(), `${id}.jpg`);
        await new Promise((res, rej) => {
          ffmpeg(tmpVid)
            .frames(1)
            .outputOptions([`-vf scale=${size}:-1`])
            .save(tmpJpg)
            .on('end', res)
            .on('error', rej);
        });

        thumbBuf = await fs.readFile(tmpJpg);
        await fs.unlink(tmpVid);
        await fs.unlink(tmpJpg);
      } else {
        // fetch image bytes and resize
        const { buf: imgBuf } = await downloadAndType(data.url);
        thumbBuf = await sharp(imgBuf)
          .resize({ width: size })
          .jpeg()
          .toBuffer();
      }

      // upload thumbnail as JPEG
      const thumbPath = `thumbnails/${id}.jpg`;
      const thumbFile = bucket.file(thumbPath);
      await thumbFile.save(thumbBuf, {
        metadata: { contentType: 'image/jpeg' }
      });
      await thumbFile.makePublic();
      const newThumbUrl = thumbFile.publicUrl();

      await log.set({ originalThumbnail: thumbLink }, { merge: true });
      await ref.update({
        thumbnailLink:       newThumbUrl,
        thumbnailReplacedAt: FieldValue.serverTimestamp()
      });
    } catch (err) {
      console.error(`Thumbnail generation failed [${docSnap.id}]:`, err.message);
    }

    thumbBar.increment();
  }

  thumbBar.stop();
  console.log('🎉 Migration complete.');
}

async function undo() {
  const logsSnap = await db.collection('migrationLogs').get();
  if (logsSnap.empty) {
    console.log('ℹ️ No logs to undo.');
    return;
  }

  const bar = new cliProgress.SingleBar({
    format: 'Undoing         |{bar}| {value}/{total}',
    clearOnComplete: true
  }, cliProgress.Presets.shades_classic);
  bar.start(logsSnap.size, 0);

  for (const logSnap of logsSnap.docs) {
    const { photoId, originalUrl, originalThumbnail } = logSnap.data();
    const ref = db.collection('photos').doc(photoId);
    const updates = {};

    if (originalUrl !== undefined) {
      updates.url        = originalUrl;
      updates.replacedAt = FieldValue.delete();
    }
    if (originalThumbnail !== undefined) {
      updates.thumbnailLink       = originalThumbnail;
      updates.thumbnailReplacedAt = FieldValue.delete();
    }

    await ref.update(updates);
    await logSnap.ref.delete();
    bar.increment();
  }

  bar.stop();
  console.log('🔄 Undo complete.');
}

(async () => {
  if (process.argv[2] === 'undo') await undo();
  else                             await migrate();
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
