// js/scan.js

// 1) Init Firebase
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig.js");
}
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

// 2) Decrypt & timestamp helpers
function decryptText(noisy) {
  if (noisy.length <= 10) throw "Invalid payload";
  return atob(noisy.slice(5, -5));
}

function diffSec(ts) {
  const now = new Date();
  const qr  = new Date(
    now.getFullYear(),
    +ts.slice(0,2) - 1,
    +ts.slice(2,4),
    +ts.slice(4,6),
    +ts.slice(6,8),
    +ts.slice(8,10)
  );
  return Math.abs((now - qr) / 1000);
}

// 3) Elements & state
const scanBtn    = document.getElementById('btn-scan');
const wrapper    = document.getElementById('scanner-wrapper');
const qrScanner  = document.getElementById('qr-scanner');
const closeCam   = document.getElementById('scanner-close');
const popup      = document.getElementById('scan-popup');
const popupMsg   = document.getElementById('scan-popup-msg');
const popupClose = document.getElementById('scan-popup-close');
let html5Scanner, popupTimer;

// 4) Popup
function showPopup(msg) {
  clearTimeout(popupTimer);
  popupMsg.innerText = msg;
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

// 5) Flash
function flash(ok) {
  document.body.classList.add(ok ? 'flash-success' : 'flash-error');
  setTimeout(() =>
    document.body.classList.remove(ok ? 'flash-success' : 'flash-error'),
    500
  );
}

// 6) Show/hide scanner UI
function showScanner() {
  scanBtn.style.transition = 'opacity 300ms';
  scanBtn.style.opacity = '0';
  setTimeout(() => scanBtn.style.display = 'none', 300);

  wrapper.style.display = 'block';
  qrScanner.style.display = 'block';
  requestAnimationFrame(() => wrapper.classList.add('show'));
}
function hideScanner() {
  if (html5Scanner) {
    html5Scanner.stop().catch(()=>{});
  }
  wrapper.classList.remove('show');
  setTimeout(() => {
    wrapper.style.display = 'none';
    qrScanner.style.display = 'none';
  }, 300);

  scanBtn.style.display = 'block';
  setTimeout(() => scanBtn.style.opacity = '1', 50);
}

// 7) Main scan routine
async function startQRScan() {
  showScanner();

  html5Scanner = new Html5Qrcode("qr-scanner");

  // iOS inline
  const obs = new MutationObserver(() => {
    const vid = qrScanner.querySelector('video');
    if (vid) {
      vid.setAttribute('playsinline', '');
      obs.disconnect();
    }
  });
  obs.observe(qrScanner, { childList: true, subtree: true });

  try {
    await html5Scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: parseInt(getComputedStyle(document.documentElement)
                                .getPropertyValue('--qr-size')) },
      async raw => {
        // got a code!
        await html5Scanner.stop();
        hideScanner();

        let plain;
        try {
          plain = decryptText(raw);
        } catch {
          flash(false);
          return showPopup("Invalid QR code");
        }

        // expiration check
        const timePart = plain.slice(0,10);
        if (diffSec(timePart) > 28) {
          flash(false);
          return showPopup("Error: QR expired");
        }

        // extract phone & lookup
        const phone = plain.slice(11);
        const docRef = db.collection("members").doc(phone);
        const snap   = await docRef.get();
        if (!snap.exists) {
          flash(false);
          return showPopup(`No record for ${phone}`);
        }
        const { name, onList } = snap.data();
        if (!onList) {
          flash(false);
          return showPopup("❌ Not on list");
        }

        // award points & success
        await docRef.update({
          sPoints: firebase.firestore.FieldValue.increment(7)
        });
        flash(true);
        showPopup(`✅ Welcome, ${name}!`);
      },
      _err => {
        // silent
      }
    );
  } catch(e) {
    console.error(e);
    hideScanner();
    flash(false);
    showPopup("Error starting camera");
  }
}

// 8) Wiring
scanBtn   .addEventListener('click', startQRScan);
closeCam  .addEventListener('click', hideScanner);
popupClose.addEventListener('click', hidePopup);
