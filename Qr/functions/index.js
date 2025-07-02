// functions/index.js

const functions = require('firebase-functions/v1"');
const admin     = require('firebase-admin');
const path      = require('path');
const os        = require('os');
const fs        = require('fs').promises;
const sharp     = require('sharp');
const ffmpeg    = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

admin.initializeApp();

// — Payment‐confirmation Firestore trigger —————————————————————————
exports.onPaymentConfirmed = functions.firestore
  .document('events/{eventId}/rsvps/{rsvpId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after  = change.after.data()  || {};
    if (!before.hasPaid && after.hasPaid === true) {
      const { eventId, rsvpId } = context.params;
      let userName = 'Someone';
      try {
        const memberSnap = await admin
          .firestore()
          .collection('members')
          .doc(rsvpId)
          .get();
        if (memberSnap.exists) {
          userName = memberSnap.data().name || 'Someone';
        }
      } catch (err) {
        console.error('Error fetching member name:', err);
      }
      const commentRef = admin
        .firestore()
        .collection('events')
        .doc(eventId)
        .collection('comments')
        .doc();
      await commentRef.set({
        text:      `${userName} has paid and is confirmed.`,
        name:      userName,
        user:      '',
        system:    true,
        type:      'payment_confirmation',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      await change.after.ref.update({ paymentCommentGenerated: true });
    }
    return null;
  });

// — Thumbnail‐generation Storage trigger —————————————————————————
exports.generateThumbnail = functions.storage.object().onFinalize(async object => {
  const filePath = object.name;  // e.g. "photos/ABC123.jpg"
  if (!filePath || !filePath.startsWith('photos/')) return null;

  const fileName   = path.basename(filePath);
  const photoId    = path.parse(fileName).name;
  const bucket     = admin.storage().bucket(object.bucket);
  const tmpFile    = path.join(os.tmpdir(), fileName);
  const tmpThumb   = path.join(os.tmpdir(), `${photoId}.jpg`);
  const thumbPath  = `thumbnails/${photoId}.jpg`;

  // Download the uploaded file
  await bucket.file(filePath).download({ destination: tmpFile });

  // Decide whether it's a video
  const isVideo = (object.contentType || '').startsWith('video/');

  if (isVideo) {
    // Extract first frame at 220px wide
    await new Promise((resolve, reject) => {
      ffmpeg(tmpFile)
        .frames(1)
        .outputOptions(['-vf scale=220:-1'])
        .save(tmpThumb)
        .on('end', resolve)
        .on('error', reject);
    });
  } else {
    // Resize image to 220px wide
    await sharp(tmpFile)
      .resize({ width: 220 })
      .jpeg()
      .toFile(tmpThumb);
  }

  // Upload thumbnail and make public
  await bucket.upload(tmpThumb, {
    destination: thumbPath,
    metadata:    { contentType: 'image/jpeg' }
  });
  await bucket.file(thumbPath).makePublic();
  const thumbUrl = bucket.file(thumbPath).publicUrl();

  // Write back to Firestore
  await admin
    .firestore()
    .collection('photos')
    .doc(photoId)
    .update({
      thumbnailLink:       thumbUrl,
      thumbnailReplacedAt: admin.firestore.FieldValue.serverTimestamp()
    });

  // Clean up temp files
  await fs.unlink(tmpFile);
  await fs.unlink(tmpThumb);

  return null;
});
