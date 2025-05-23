/*
  js/app.js

  - Modal QR with backdrop & click-to-close
  - On load: phone-entry → sanitize input, drop leading '1'
  - Verify in Firestore → set testPhone, memberName, memberOnList
  - QR = timestamp + 'R' + phone, encrypted (Base64 + 5-char noise)
  - Refresh every 4s with fade + synced timer
  - Scan QR (password protected) → decrypt → extract phone → lookup Firestore:
      • if onList → add 7 to sPoints
      • alert user “Welcome, name!” or “Not on list”
  - Buttons:
      • View/Add Photos → opens iCloud album
      • Group Chat → only if memberOnList
      • Suggest Activity → prompt & append to suggestions array
*/

// 0. Fade-in setup
document.addEventListener('DOMContentLoaded', () => {
  const elems = [
    document.getElementById('title'),
    ...document.querySelectorAll('#controls button'),
    document.getElementById('link-scan')
  ];
  elems.forEach(el => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 500ms ease';
  });
  elems.forEach((el, i) => setTimeout(() => el.style.opacity = '1', i * 100));

  const wrapper = document.getElementById('qr-wrapper');
  wrapper.style.opacity = '0';
  wrapper.style.transition = 'opacity 300ms ease';
});

// 1. Initialize Firebase using external config
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig! Make sure js/firebaseConfig.js exists");
}
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

// 2. Phone-entry state
let testPhone = '';
let memberName = '';
let memberOnList = false;
document.getElementById('phone-submit').onclick = async () => {
  let raw = document.getElementById('phone-input').value.replace(/\D/g, '');
  if (raw.length === 11 && raw.startsWith('1')) raw = raw.slice(1);
  if (raw.length !== 10) {
    return alert('Please enter a valid 10-digit number.');
  }
  const snap = await db.collection('members').doc(raw).get();
  if (!snap.exists) {
    return alert('Phone not found on event list.');
  }
  const data = snap.data();
  testPhone = raw;
  memberName = data.name || data.Name || 'No Name';
  memberOnList = !!data.onList;
  document.getElementById('user-name').innerText = memberName;
  document.getElementById('phone-entry').style.display = 'none';
  document.getElementById('app').style.display = 'block';
};

// 3. Utils & state
const QR_REFRESH    = 4;               // seconds
const SCAN_COOLDOWN = 35 * 60 * 1000;  // ms
const COLORS = { green:"#5c5146", gold:"#b49e85" };
let qrCode, qrInterval, timerInterval, countdown;

// 4. Noise + Base64
function randomNoise(n) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({length:n}, () => chars.charAt(
    Math.floor(Math.random()*chars.length)
  )).join('');
}
function encryptText(txt) {
  return randomNoise(5) + btoa(txt) + randomNoise(5);
}
function decryptText(noisy) {
  if (noisy.length <= 10) throw 'Invalid payload';
  return atob(noisy.slice(5, -5));
}

// 5. Timestamp helper
function pad2(n){ return String(n).padStart(2,'0'); }
function nowStr(){
  const d = new Date();
  return `${pad2(d.getMonth()+1)}${pad2(d.getDate())}`
       + `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

// 6. Modal backdrop setup
let qrOverlay = null;
function ensureOverlay() {
  if (!qrOverlay) {
    qrOverlay = document.createElement('div');
    qrOverlay.id = 'qr-overlay';
    Object.assign(qrOverlay.style, {
      position: 'fixed', top: 0, left: 0,
      width: '100%', height: '100%',
      background: 'rgba(0,0,0,0.5)',
      display: 'none',
      zIndex: 1000
    });
    document.body.appendChild(qrOverlay);
    qrOverlay.addEventListener('click', hideQR);
  }
}

// 7. Toggle/display QR
function toggleQRDisplay(){
  const w = document.getElementById('qr-wrapper');
  w.style.display==='block' ? hideQR() : showQR();
}
function showQR(){
  clearInterval(qrInterval);
  clearInterval(timerInterval);
  document.getElementById('scan-result').innerText = '';

  ensureOverlay();
  qrOverlay.style.display = 'block';

  const w = document.getElementById('qr-wrapper');
  w.style.display = 'block';
  w.style.opacity = '0';
  requestAnimationFrame(() => w.style.opacity = '1');

  generateAndFadeQR();
  startTimer();
  qrInterval = setInterval(generateAndFadeQR, QR_REFRESH * 1000);
}
function hideQR(){
  clearInterval(qrInterval);
  clearInterval(timerInterval);
  if (qrOverlay) qrOverlay.style.display = 'none';

  const w = document.getElementById('qr-wrapper');
  w.style.opacity = '0';
  setTimeout(() => {
    w.style.display = 'none';
    document.getElementById('qr-close').style.display = 'none';
  }, 300);
}

// 8. Generate & fade QR + reset timer
function generateAndFadeQR(){
  countdown = QR_REFRESH;
  document.getElementById('qr-timer').innerText = `Refreshing in ${countdown}s`;

  const payload = `${nowStr()}R${testPhone}`;
  const cipher  = encryptText(payload);

  const disp = document.getElementById('qr-display');
  disp.innerHTML = '';
  qrCode = new QRCode(disp, {
    text:       cipher,
    width:      256, height:256,
    colorDark:  COLORS.green,
    colorLight: COLORS.gold
  });

  const qrElem = disp.querySelector('canvas, img, table');
  if (qrElem) {
    qrElem.style.opacity = '0';
    qrElem.style.transition = 'opacity 300ms ease';
    requestAnimationFrame(() => qrElem.style.opacity = '1');
  }
  document.getElementById('qr-close').style.display = 'block';
}

// 9. Timer ticker
function startTimer(){
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    countdown--;
    document.getElementById('qr-timer').innerText = `Refreshing in ${countdown}s`;
  }, 1000);
}

// 10. Close button
document.getElementById('qr-close').onclick = hideQR;

// 11. Scan & award points
const scannedMap = {};
async function startQRScan(){
  clearInterval(qrInterval);
  clearInterval(timerInterval);
  hideQR();

  document.getElementById('scan-result').innerText = '';
  const scanner = new Html5Qrcode('qr-scanner');
  await scanner.start(
    { facingMode:'environment' },
    { fps:10, qrbox:250 },
    async raw => {
      await scanner.stop();
      let decoded;
      try { decoded = decryptText(raw); }
      catch { return alert('Invalid QR'); }

      const phone = decoded.slice(11);
      if (scannedMap[phone] && Date.now()-scannedMap[phone] < SCAN_COOLDOWN) {
        return alert('Already scanned recently');
      }
      scannedMap[phone] = Date.now();

      const docRef = db.collection('members').doc(phone);
      const snap   = await docRef.get();
      if (!snap.exists) {
        return alert(`No record for ${phone}`);
      }
      const { name, onList } = snap.data();
      if (!onList) {
        return alert(`❌ Sorry, ${name}, not on the list.`);
      }

      await docRef.update({
        sPoints: firebase.firestore.FieldValue.increment(7)
      });
      alert(`✅ Welcome, ${name}!`);
    },
    _=>{}
  );
}

// 12. New button behaviors
function openPhotos() {
  window.open(
    'https://www.icloud.com/sharedalbum/#B2X5yeZFhGti50E',
    '_blank'
  );
}
function openChat() {
  if (!testPhone) return alert('Enter your phone first.');
  if (!memberOnList) return alert('Group chat is for approved members only.');
  window.location.href = 'https://ig.me/j/Aba0eY89-aoNrGqG/';
}
async function suggestActivity() {
  if (!testPhone) return alert('Enter your phone first.');
  const suggestion = prompt("What activity would you like us to do next?");
  if (!suggestion || !suggestion.trim()) return;
  try {
    await db.collection('members').doc(testPhone).update({
      suggestions: firebase.firestore.FieldValue.arrayUnion(suggestion.trim())
    });
    alert('Thanks for your suggestion!');
  } catch (err) {
    console.error(err);
    alert('Error saving suggestion.');
  }
}

// 13. Wire all buttons on load (with password prompt for scan)
window.addEventListener('load', () => {
  document.getElementById('btn-display').onclick = toggleQRDisplay;
  document.getElementById('btn-photos').onclick  = openPhotos;
  document.getElementById('btn-chat').onclick    = openChat;
  document.getElementById('btn-suggest').onclick = suggestActivity;
  document.getElementById('link-scan').onclick   = e => {
    e.preventDefault();
    const pwd = prompt("Enter admin password to scan QR:");
    if (pwd === 'prix') {
      startQRScan();
    } else {
      alert('Incorrect password.');
    }
  };
});
