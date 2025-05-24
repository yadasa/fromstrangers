// 1) Init Firebase
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig.js");
}
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

// 2) Decrypt helper
function decryptText(noisy) {
  if (noisy.length <= 10) throw "Invalid payload";
  return atob(noisy.slice(5, -5));
}

// 3) Elements & state
const scanBtn    = document.getElementById('btn-scan');
const wrapper    = document.getElementById('scanner-wrapper');
const closeCam   = document.getElementById('scanner-close');
const popup      = document.getElementById('scan-popup');
const popupMsg   = document.getElementById('scan-popup-msg');
const popupClose = document.getElementById('scan-popup-close');
let html5Scanner;

// 4) Show popup
let popupTimer;
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

// 5) Flash background
function flash(ok) {
  document.body.classList.add(ok ? 'flash-success' : 'flash-error');
  setTimeout(() =>
    document.body.classList.remove(ok ? 'flash-success' : 'flash-error'),
    500
  );
}

// 6) Show/hide scanner UI
function showScanner() {
  scanBtn.style.opacity = '0';
  setTimeout(() => scanBtn.style.display = 'none', 300);

  wrapper.classList.add('show');
}
function hideScanner() {
  wrapper.classList.remove('show');
  setTimeout(() => wrapper.style.display = 'none', 300);

  scanBtn.style.display = 'block';
  setTimeout(() => scanBtn.style.opacity = '1', 50);
}

// 7) Start scanning
async function startQRScan() {
  showScanner();
  html5Scanner = new Html5Qrcode("qr-scanner");

  // iOS inline playback hack
  const obs = new MutationObserver(() => {
    const vid = document.querySelector('#qr-scanner video');
    if (vid) {
      vid.setAttribute('playsinline', '');
      obs.disconnect();
    }
  });
  obs.observe(wrapper, { childList: true, subtree: true });

  try {
    await html5Scanner.start(
      { facingMode: "environment" },
      { fps:10, qrbox:parseInt(getComputedStyle(document.documentElement)
                                .getPropertyValue('--qr-size')) },
      async raw => {
        await html5Scanner.stop();
        hideScanner();

        let plain;
        try { plain = decryptText(raw); }
        catch { flash(false); return showPopup("Error: invalid QR"); }

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

        await docRef.update({
          sPoints: firebase.firestore.FieldValue.increment(7)
        });
        flash(true);
        showPopup(`✅ Welcome, ${name}!`);
      },
      _err => {}
    );
  } catch(e) {
    console.error(e);
    hideScanner();
    flash(false);
    showPopup("Error starting camera");
  }
}

// 8) Wire events
scanBtn .addEventListener('click', startQRScan);
closeCam.addEventListener('click', () => {
  if (html5Scanner) html5Scanner.stop();
  hideScanner();
});
popupClose.addEventListener('click', hidePopup);
