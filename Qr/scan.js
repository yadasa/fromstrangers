// js/scan.js

// 1. Init Firebase (using your js/firebaseConfig.js)
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig.js");
}
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

// 2. Simple decrypt matching your QR generator
function decryptText(noisy) {
  if (noisy.length <= 10) throw "Invalid payload";
  // strip 5 chars front/back, then Base64-decode
  return atob(noisy.slice(5, -5));
}

// 3. Scan handler
async function startQRScan() {
  const btn = document.getElementById('btn-scan');
  const resultEl = document.getElementById('scan-result');
  btn.disabled = true;
  resultEl.textContent = '';

  const scanner = new Html5Qrcode("qr-scanner");
  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 256 },
      async decodedText => {
        await scanner.stop();
        btn.disabled = false;

        // 3a. Decrypt & parse membership phone
        let plain;
        try {
          plain = decryptText(decodedText);
        } catch {
          resultEl.textContent = "Error: invalid QR";
          return;
        }
        const phone = plain.slice(11); // mmddhhmmssR + phone

        // 3b. Firestore lookup & validation
        const docRef = db.collection("members").doc(phone);
        const snap   = await docRef.get();
        if (!snap.exists) {
          resultEl.textContent = `No record for ${phone}`;
          return;
        }
        const data = snap.data();
        if (!data.onList) {
          resultEl.textContent = `❌ Not on list`;
          return;
        }

        // 3c. Award points
        await docRef.update({
          sPoints: firebase.firestore.FieldValue.increment(7)
        });
        resultEl.textContent = `✅ Welcome, ${data.name || phone}!`;
      },
      errorMessage => {
        // you can ignore scan errors here
      }
    );
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    resultEl.textContent = "Error starting camera";
  }
}

// 4. Wire the button
document.getElementById('btn-scan')
        .addEventListener('click', startQRScan);
