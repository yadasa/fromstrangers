// 1. Init Firebase
if (!window.firebaseConfig) throw new Error("Missing firebaseConfig.js");
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

// 2. Decrypt helper
function decryptText(noisy) {
  if (noisy.length <= 10) throw "Invalid payload";
  return atob(noisy.slice(5, -5));
}

// 3. Popup helpers
const popup      = document.getElementById('scan-popup');
const popupMsg   = document.getElementById('scan-popup-msg');
const popupClose = document.getElementById('scan-popup-close');
let popupTimer;
popupClose.onclick = () => hidePopup();
function showPopup(msg) {
  clearTimeout(popupTimer);
  popupMsg.textContent = msg;
  popup.style.display = 'block';
  popup.style.opacity = '1';
  popupTimer = setTimeout(hidePopup, 7000);
}
function hidePopup() {
  popup.style.opacity = '0';
  clearTimeout(popupTimer);
  setTimeout(() => popup.style.display = 'none', 300);
}

// 4. Flash helper
const flash = document.getElementById('flash-overlay');
function doFlash(success) {
  flash.classList.toggle('fail', !success);
  flash.style.opacity = '1';
  setTimeout(() => flash.style.opacity = '0', 200);
}

// 5. Scan logic
let scanner; 
async function startQRScan() {
  const btn        = document.getElementById('btn-scan');
  const scannerEl  = document.getElementById('qr-scanner');
  const closeBtn   = document.getElementById('scanner-close');

  // toggle UI
  btn.style.display = 'none';
  scannerEl.style.display = 'block';
  closeBtn.style.display = 'block';

  // stop on close
  closeBtn.onclick = async () => {
    await scanner.stop();
    resetUI();
  };

  // init scanner
  scanner = new Html5Qrcode("qr-scanner");
  // ensure video plays inline on iOS
  new MutationObserver((_,o)=> {
    const v = document.querySelector('#qr-scanner video');
    if (v) { v.setAttribute('playsinline',''); o.disconnect(); }
  }).observe(scannerEl,{ childList:true, subtree:true });

  try {
    await scanner.start(
      { facingMode:"environment" },
      { fps:10, qrbox:256 },
      onDecodeSuccess,
      _ => {}
    );
  } catch(e) {
    console.error(e);
    showPopup("Error starting camera");
    resetUI();
  }
}

// 6. On decode (success or fail)
async function onDecodeSuccess(raw) {
  await scanner.stop();

  let plain, phone, docRef, snap, data;
  try {
    plain = decryptText(raw);
    phone = plain.slice(11);
    docRef= db.collection('members').doc(phone);
    snap  = await docRef.get();
    if (!snap.exists) throw "No record";
    data = snap.data();
    if (!data.onList) throw "Not on list";

    // award points
    await docRef.update({
      sPoints: firebase.firestore.FieldValue.increment(7)
    });
    doFlash(true);
    showPopup(`✅ Welcome, ${data.name || phone}!`);
  } catch(err) {
    console.warn(err);
    doFlash(false);
    showPopup(
      err === "Not on list"    ? "❌ Not on list" :
      err === "No record"      ? `No record for ${phone}` :
                                "Invalid QR"
    );
  } finally {
    resetUI();
  }
}

// 7. Reset to button
function resetUI() {
  document.getElementById('scanner-close').style.display = 'none';
  document.getElementById('qr-scanner').style.display = 'none';
  document.getElementById('btn-scan').style.display = 'block';
}

// 8. Wire button
document.getElementById('btn-scan')
        .addEventListener('click', startQRScan);
