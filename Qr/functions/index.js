// functions/index.js

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const path = require("path");
const os = require("os");
const fs = require("fs").promises;
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

admin.initializeApp();

// — existing onPaymentConfirmed :contentReference[oaicite:1]{index=1}
exports.onPaymentConfirmed = functions.firestore
    .document("events/{eventId}/rsvps/{rsvpId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data() || {};
      const after = change.after.data() || {};
      if (!before.hasPaid && after.hasPaid === true) {
        const {eventId, rsvpId} = context.params;
        let userName = "Someone";
        try {
          const memberSnap = await admin
              .firestore()
              .collection("members")
              .doc(rsvpId)
              .get();
          if (memberSnap.exists) {
            const md = memberSnap.data();
            userName = md.name || md.Name || "Someone";
          }
        } catch (err) {
          console.error("Error fetching member name:", err);
        }
        const commentRef = admin
            .firestore()
            .collection("events")
            .doc(eventId)
            .collection("comments")
            .doc();
        const commentData = {
          text: `${userName} has paid and is confirmed.`,
          name: userName,
          user: "",
          system: true,
          type: "payment_confirmation",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        };
        const rsvpRef = change.after.ref;
        const batch = admin.firestore().batch();
        batch.set(commentRef, commentData);
        batch.update(rsvpRef, {paymentCommentGenerated: true});
        return batch.commit();
      }
      return null;
    });

// — new generateThumbnail trigger —————————————————————————————
exports.generateThumbnail = functions.storage
    .object()
    .onFinalize(async (object) => {
      const filePath = object.name; // e.g. "photos/ABC123.jpg"
      if (!filePath.startsWith("photos/")) return null;
      const fileName = path.basename(filePath); // "ABC123.jpg"
      const photoId = path.parse(fileName).name; // "ABC123"
      const bucketName = object.bucket;
      const tmpFile = path.join(os.tmpdir(), fileName);
      const tmpThumb = path.join(os.tmpdir(), `${photoId}.jpg`);
      const thumbPath = `thumbnails/${photoId}.jpg`;
      const bucket = admin.storage().bucket(bucketName);

      // 1️⃣ Download original to temp
      await bucket.file(filePath).download({destination: tmpFile});

      // 2️⃣ Decide image vs video
      const contentType = object.contentType || "";
      const isVideo = contentType.startsWith("video/") ||
      /\.(mp4|mov|avi|mkv|webm)$/i.test(fileName);

      if (isVideo) {
      // extract first frame @220 px wide
        await new Promise((resolve, reject) => {
          ffmpeg(tmpFile)
              .frames(1)
              .outputOptions([`-vf scale=220:-1`])
              .save(tmpThumb)
              .on("end", resolve)
              .on("error", reject);
        });
      } else {
      // resize image to 220 px wide
        await sharp(tmpFile)
            .resize({width: 220})
            .jpeg()
            .toFile(tmpThumb);
      }

      // 3️⃣ Upload thumbnail back
      await bucket.upload(tmpThumb, {
        destination: thumbPath,
        metadata: {contentType: "image/jpeg"},
      });
      await bucket.file(thumbPath).makePublic();
      const thumbUrl = bucket.file(thumbPath).publicUrl();

      // 4️⃣ Update Firestore
      await admin
          .firestore()
          .collection("photos")
          .doc(photoId)
          .update({
            thumbnailLink: thumbUrl,
            thumbnailReplacedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

      // 5️⃣ Clean up temp files
      await fs.unlink(tmpFile);
      await fs.unlink(tmpThumb);
      return null;
    });
