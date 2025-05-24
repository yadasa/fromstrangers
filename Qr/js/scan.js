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

// 3. Popup helper
const popup = document.getElementById('scan-popup');
const popupMsg = document.getElementById('scan-popup-msg');
const popupClose = document.getElementById('scan-popup-close');
let popupTimer;

function showPopup(msg) {
  clearTimeout(popupTimer);
  popupMsg.textContent = msg;
  popup.style.display = 'block';
  popup.style.opacity = '1';
  popupClose.onclick = hidePopup;
  popupTimer = setTimeout(hidePopup, 7000);
}

function hidePopup() {
  popup.style.opacity = '0';
  clearTimeout(popupTimer);
  setTimeout(() => popup.style.display = 'none', 300);
}

// 4. Scan handler
async function startQRScan() {
  const btn = document.getElementById('btn-scan');
  const scannerEl = document.getElementById('qr-scanner');

  btn.style.display = 'none';
  scannerEl.style.display = 'block';

  const scanner = new Html5Qrcode("qr-scanner");
  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: parseInt(getComputedStyle(document.documentElement)
                                .getPropertyValue('--qr-size')) },
      async decodedText => {
        await scanner.stop();

        let plain;
        try {
          plain = decryptText(decodedText);
        } catch {
          return showPopup("Error: invalid QR");
        }

        const phone = plain.slice(11);
        const docRef = db.collection("members").doc(phone);
        const snap = await docRef.get();
        if (!snap.exists) {
          return showPopup(`No record for ${phone}`);
        }
        const data = snap.data();
        if (!data.onList) {
          return showPopup("❌ Not on list");
        }
        await docRef.update({
          sPoints: firebase.firestore.FieldValue.increment(7)
        });
        showPopup(`✅ Welcome, ${data.name || phone}!`);
      },
      _ => {
        // ignore frame scan errors
      }
    );
  } catch (e) {
    console.error(e);
    showPopup("Error starting camera");
  }
}

// 5. Wire the button
document.getElementById('btn-scan')
        .addEventListener('click', startQRScan);
