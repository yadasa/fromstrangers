// js/scan.js

// 1. Init Firebase (compat)
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig.js");
}
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

// 1.a Your Boat Party ID (replace with your real ID)
const BOAT_PARTY_ID = 'aZa4ZA6i18jB1a4Hg8BD';

// 2. Decrypt helper
function decryptText(noisy) {
  if (noisy.length <= 10) throw "Invalid payload";
  return atob(noisy.slice(5, -5));
}

// 3. Timestamp diff (sec)
function diffSec(ts) {
  const now = new Date();
  const qrTime = new Date(
    now.getFullYear(),
    +ts.slice(0,2) - 1,
    +ts.slice(2,4),
    +ts.slice(4,6),
    +ts.slice(6,8),
    +ts.slice(8,10)
  );
  return Math.abs((now - qrTime) / 1000);
}

// 4. Flash overlay (unchanged)
let flashOverlay = null;
function ensureFlashOverlay() {
  if (!flashOverlay) {
    flashOverlay = document.createElement('div');
    flashOverlay.id = 'flash-overlay';
    Object.assign(flashOverlay.style, {
      position:'fixed',top:0,left:0,width:'100%',height:'100%',
      pointerEvents:'none', opacity:0,
      transition:'opacity 300ms ease', zIndex:1002
    });
    document.body.appendChild(flashOverlay);
  }
}
function flashScreen(success) {
  ensureFlashOverlay();
  flashOverlay.style.background = success
    ? 'rgba(0,255,0,0.3)'
    : 'rgba(255,0,0,0.3)';
  flashOverlay.style.opacity = '1';
  setTimeout(() => flashOverlay.style.opacity = '0', 1000);
}

// 5. Popup helper (unchanged)
const popup      = document.getElementById('scan-popup');
const popupMsg   = document.getElementById('scan-popup-msg');
const popupClose = document.getElementById('scan-popup-close');
let popupTimer;
function showPopup(msg, success) {
  clearTimeout(popupTimer);
  popupMsg.textContent = msg;
  popup.style.display = 'block';
  popup.style.opacity = '1';
  flashScreen(success);

  popupClose.onclick = () => {
    clearTimeout(popupTimer);
    hidePopup();
  };
  popupTimer = setTimeout(hidePopup, 4000);
}
function hidePopup() {
  popup.style.opacity = '0';
  clearTimeout(popupTimer);
  setTimeout(() => popup.style.display = 'none', 300);
}

// 6. Scan handler (modified)
async function startQRScan() {
  const btn       = document.getElementById('btn-scan');
  const scannerEl = document.getElementById('qr-scanner');

  btn.style.display       = 'none';
  scannerEl.style.display = 'block';

  const scanner = new Html5Qrcode("qr-scanner");
  try {
    await scanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: parseInt(getComputedStyle(document.documentElement)
                        .getPropertyValue('--qr-size'))
      },
      async decodedText => {
        await scanner.stop();
        scannerEl.style.display = 'none';
        btn.style.display       = 'block';

        let plain;
        try {
          plain = decryptText(decodedText);
        } catch {
          return showPopup("Error: invalid QR", false);
        }

        const timePart = plain.slice(0,10);
        if (diffSec(timePart) > 28) {
          return showPopup("Error: QR expired", false);
        }

        const phone  = plain.slice(11);
        const docRef = db.collection("members").doc(phone);
        const snap   = await docRef.get();
        if (!snap.exists) {
          return showPopup(`No record for ${phone}`, false);
        }
        const data = snap.data();

        // 🚩 bp check: flash red & stop if bp===false
        if (!data.bp === true) {
          return showPopup("❌ Not eligible for Boat Party", false);
        }

        // ✈️ jet check: separate popup if /boatParty/{BOAT_PARTY_ID}/jet === "yes"
        const jetSnap = await docRef
          .collection("boatParty")
          .doc(BOAT_PARTY_ID)
          .get();
        if (jetSnap.exists && jetSnap.data().jet === 'yes') {
          showPopup("🎉 jet ski user", true);
        }

        // 🎁 Award 700 points
        await docRef.update({
          sPoints: firebase.firestore.FieldValue.increment(700)
        });
        showPopup(`✅ Welcome, ${data.name || phone}!`, true);
      },
      _error => {
        // ignore scan-frame errors
      }
    );
  } catch (e) {
    console.error(e);
    scannerEl.style.display = 'none';
    btn.style.display       = 'block';
    showPopup("Error starting camera", false);
  }
}

// 7. Wire the button (unchanged)
document.getElementById('btn-scan')
        .addEventListener('click', startQRScan);
