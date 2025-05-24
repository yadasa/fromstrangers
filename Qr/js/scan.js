// js/scan.js

// 1. Init Firebase (compat)
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig.js");
}
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

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

// 4. Flash overlay
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

// 5. Popup helper
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

  // close early on X
  popupClose.onclick = () => {
    clearTimeout(popupTimer);
    hidePopup();
  };
  // auto‐dismiss after 4s
  popupTimer = setTimeout(hidePopup, 4000);
}
function hidePopup() {
  popup.style.opacity = '0';
  clearTimeout(popupTimer);
  setTimeout(() => popup.style.display = 'none', 300);
}

// 6. Scan handler
async function startQRScan() {
  const btn       = document.getElementById('btn-scan');
  const scannerEl = document.getElementById('qr-scanner');

  // show camera preview
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
        // stop camera
        await scanner.stop();

        // reset UI
        scannerEl.style.display = 'none';
        btn.style.display       = 'block';

        // decrypt & parse
        let plain;
        try {
          plain = decryptText(decodedText);
        } catch {
          return showPopup("Error: invalid QR", false);
        }

        // expiry
        const timePart = plain.slice(0,10);
        if (diffSec(timePart) > 28) {
          return showPopup("Error: QR expired", false);
        }

        // lookup member
        const phone  = plain.slice(11);
        const docRef = db.collection("members").doc(phone);
        const snap   = await docRef.get();
        if (!snap.exists) {
          return showPopup(`No record for ${phone}`, false);
        }
        const data = snap.data();
        if (!data.onList) {
          return showPopup("❌ Not on list", false);
        }

        // award points
        await docRef.update({
          sPoints: firebase.firestore.FieldValue.increment(7)
        });
        showPopup(`✅ Welcome, ${data.name || phone}!`, true);
      },
      _error => {
        // ignore frame scanning errors
      }
    );
  } catch (e) {
    console.error(e);
    // reset UI on start failure
    scannerEl.style.display = 'none';
    btn.style.display       = 'block';
    showPopup("Error starting camera", false);
  }
}

// 7. Wire the button
document.getElementById('btn-scan')
        .addEventListener('click', startQRScan);
