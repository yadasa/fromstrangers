// functions/index.js

const admin     = require('firebase-admin');
const path      = require('path');
const os        = require('os');
const fs        = require('fs').promises;
const sharp     = require('sharp');
const ffmpeg    = require('fluent-ffmpeg');
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const ffmpegInstaller        = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller       = require('@ffprobe-installer/ffprobe');

// point FFmpeg → its installed binary
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// bootstrap the Admin SDK
admin.initializeApp();

// Trigger fires on any new or overwritten file under “photos/…”
exports.generateThumbnail = onObjectFinalized(
  {
    // defaults to your default bucket; you can override if needed:
    bucket: process.env.FIREBASE_CONFIG
             ? JSON.parse(process.env.FIREBASE_CONFIG).storageBucket
             : undefined,
    // run in us-central1 by default; change if your bucket lives elsewhere:
    region: 'us-central1'
  },
  async (event) => {
    const object   = event.data;            // the Storage object metadata
    const filePath = object.name || '';     // e.g. "photos/ABC123.jpg"
    if (!filePath.startsWith('photos/')) return;

    const fileName  = path.basename(filePath);          // "ABC123.jpg"
    const photoId   = path.parse(fileName).name;        // "ABC123"
    const bucket    = admin.storage().bucket(object.bucket);
    const tmpFile   = path.join(os.tmpdir(), fileName);
    const tmpThumb  = path.join(os.tmpdir(), `${photoId}.jpg`);
    const thumbPath = `thumbnails/${photoId}.jpg`;

    // 1) Download the newly uploaded file to temp
    await bucket.file(filePath).download({ destination: tmpFile });

    // 2) Branch on image vs. video
    const isVideo = (object.contentType || '').startsWith('video/');
    if (isVideo) {
      // extract first frame at 220px wide
      await new Promise((resolve, reject) => {
        ffmpeg(tmpFile)
          .frames(1)
          .outputOptions(['-vf scale=220:-1'])
          .save(tmpThumb)
          .on('end', resolve)
          .on('error', reject);
      });
    } else {
      // resize image to 220px wide
      await sharp(tmpFile)
        .resize({ width: 220 })
        .jpeg()
        .toFile(tmpThumb);
    }

    // 3) Upload thumbnail back to Storage
    await bucket.upload(tmpThumb, {
      destination: thumbPath,
      metadata:    { contentType: 'image/jpeg' }
    });
    await bucket.file(thumbPath).makePublic();
    const thumbUrl = bucket.file(thumbPath).publicUrl();

    // 4) Write the new URL into Firestore
    await admin
      .firestore()
      .collection('photos')
      .doc(photoId)
      .update({
        thumbnailLink:       thumbUrl,
        thumbnailReplacedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    // 5) Clean up temp files
    await fs.unlink(tmpFile);
    await fs.unlink(tmpThumb);
  }
);
