/*
  js/app.js

  - Firebase Phone Auth (SMS + Recaptcha)
  - Firestore membership check
  - QR modal (centered + backdrop)
  - Scan-only link (password protected)
  - View/Add Photos, Group Chat, Suggest Activity buttons
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
  elems.forEach((el,i) => {
    setTimeout(() => el.style.opacity = '1', i * 100);
  });

  const wrapper = document.getElementById('qr-wrapper');
  wrapper.style.opacity = '0';
  wrapper.style.transition = 'opacity 300ms ease';
});

// 1. Initialize Firebase
if (!window.firebaseConfig) {
  throw new Error("Missing js/firebaseConfig.js");
}
firebase.initializeApp(window.firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// 2. Phone-entry + SMS auth
let testPhone = '';
let memberName = '';
let memberOnList = false;

document.getElementById('phone-submit').onclick = async () => {
  // sanitize
  let raw = document.getElementById('phone-input').value.replace(/\D/g, '');
  if (raw.length === 11 && raw.startsWith('1')) raw = raw.slice(1);
  if (raw.length !== 10) {
    return alert('Enter a valid 10-digit phone.');
  }
  // invisible reCAPTCHA
  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier(
    'recaptcha-container',
    { size: 'invisible' }
  );
  try {
    const confirmation = await auth.signInWithPhoneNumber(
      '+1' + raw,
      window.recaptchaVerifier
    );
    window.confirmationResult = confirmation;
    document.getElementById('otp-entry').style.display = 'block';
  } catch (err) {
    console.error(err);
    alert('SMS not sent: ' + err.message);
  }
};

// 3. OTP verification
document.getElementById('otp-submit').onclick = async () => {
  const code = document.getElementById('otp-input').value.trim();
  if (code.length !== 6) return alert('Enter the 6-digit code.');
  try {
    const cred = await window.confirmationResult.confirm(code);
    const user = cred.user;
    // strip "+1"
    testPhone = user.phoneNumber.replace('+1','');
    // membership lookup
    const snap = await db.collection('members').doc(testPhone).get();
    if (!snap.exists) {
      return alert('No RSVP found.');
    }
    const data = snap.data();
    memberName   = data.name || data.Name || 'No Name';
    memberOnList = !!data.onList;

    document.getElementById('user-name').innerText = memberName;
    document.getElementById('phone-entry').style.display = 'none';
    document.getElementById('app').style.display = 'block';
  } catch (err) {
    console.error(err);
    alert('Code incorrect: ' + err.message);
  }
};

// 4. QR & encryption utils
const QR_REFRESH    = 4;                // seconds
const SCAN_COOLDOWN = 35 * 60 * 1000;   // ms
const COLORS        = { green:"#5c5146", gold:"#b49e85" };
let qrCode, qrInterval, timerInterval, countdown;

function randomNoise(n) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({length:n}, () =>
    chars.charAt(Math.floor(Math.random()*chars.length))
  ).join('');
}
function encryptText(txt) {
  return randomNoise(5) + btoa(txt) + randomNoise(5);
}
function decryptText(noisy) {
  if (noisy.length <= 10) throw 'Invalid payload';
  return atob(noisy.slice(5, -5));
}

function pad2(n){ return String(n).padStart(2,'0'); }
function nowStr(){
  const d = new Date();
  return `${pad2(d.getMonth()+1)}${pad2(d.getDate())}`
       + `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

// 5. Modal backdrop & QR positioning
let qrOverlay = null;
function ensureOverlay() {
  if (!qrOverlay) {
    qrOverlay = document.createElement('div');
    qrOverlay.id = 'qr-overlay';
    Object.assign(qrOverlay.style, {
      position: 'fixed', top: 0, left: 0,
      width: '100%', height: '100%',
      background: 'rgba(0,0,0,0.5)',
      display: 'none', zIndex: 1000
    });
    document.body.appendChild(qrOverlay);
    qrOverlay.addEventListener('click', hideQR);
  }
}

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

function generateAndFadeQR(){
  countdown = QR_REFRESH;
  document.getElementById('qr-timer').innerText = `Refreshing in ${countdown}s`;

  const payload = `${nowStr()}R${testPhone}`;
  const cipher  = encryptText(payload);

  const disp = document.getElementById('qr-display');
  disp.innerHTML = '';
  qrCode = new QRCode(disp, {
    text:       cipher,
    width:      256,
    height:     256,
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

function startTimer(){
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    countdown--;
    document.getElementById('qr-timer').innerText = `Refreshing in ${countdown}s`;
  }, 1000);
}
document.getElementById('qr-close').onclick = hideQR;

// 6. Scan QR (password protected)
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
      if (scannedMap[phone] &&
          Date.now()-scannedMap[phone] < SCAN_COOLDOWN) 
      {
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
    _ => {}
  );
}

// 7. Other button actions
function openPhotos() {
  window.open(
    'https://www.icloud.com/sharedalbum/#B2X5yeZFhGti50E',
    '_blank'
  );
}
function openChat() {
  if (!testPhone)        return alert('Enter your phone first.');
  if (!memberOnList)     return alert('Group chat is for approved members only.');
  window.location.href   = 'https://ig.me/j/Aba0eY89-aoNrGqG/';
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

// 8. Wire up all controls
window.addEventListener('load', () => {
  document.getElementById('btn-display').onclick = toggleQRDisplay;
  document.getElementById('btn-photos').onclick  = openPhotos;
  document.getElementById('btn-chat').onclick    = openChat;
  document.getElementById('btn-suggest').onclick = suggestActivity;
  document.getElementById('link-scan').onclick   = e => {
    e.preventDefault();
    const pwd = prompt("Enter admin password to scan QR:");
    if (pwd === 'prix') startQRScan();
    else alert('Incorrect password.');
  };
});
