// functions/index.js

const functions = require('firebase-functions/v1');
const admin     = require('firebase-admin');

admin.initializeApp();

/**
 * onPaymentConfirmed
 *
 * Listens for updates to RSVP documents under events/{eventId}/rsvps/{rsvpId}.
 * When the hasPaid field flips from falsy to true, writes a system comment
 * to events/{eventId}/comments and marks the RSVP so we don’t duplicate.
 */
exports.onPaymentConfirmed = functions.firestore
  .document('events/{eventId}/rsvps/{rsvpId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after  = change.after.data()  || {};

    // Only proceed when hasPaid transitions from falsy→true
    if (!before.hasPaid && after.hasPaid === true) {
      const { eventId, rsvpId } = context.params;

      // Fetch the user’s display name
      let userName = 'Someone';
      try {
        const memberSnap = await admin
          .firestore()
          .collection('members')
          .doc(rsvpId)
          .get();
        if (memberSnap.exists) {
          const md = memberSnap.data();
          userName = md.name || md.Name || 'Someone';
        }
      } catch (err) {
        console.error('Error fetching member name:', err);
      }

      // Prepare a new system comment
      const commentRef = admin
        .firestore()
        .collection('events')
        .doc(eventId)
        .collection('comments')
        .doc(); // auto-generated ID

      const commentData = {
        text:      `${userName} has paid and is confirmed.`,
        name:      userName,
        user:      '',                        // no user ID for system comments
        system:    true,
        type:      'payment_confirmation',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };

      // Mark the RSVP so we don’t generate the same comment twice
      const rsvpRef = change.after.ref;

      // Commit both writes atomically
      const batch = admin.firestore().batch();
      batch.set(commentRef, commentData);
      batch.update(rsvpRef, { paymentCommentGenerated: true });
      return batch.commit();
    }

    // Nothing to do if hasPaid didn’t just flip to true
    return null;
  });
