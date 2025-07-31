/*
  js/app.js

  - Firebase Phone Auth (SMS + reCAPTCHA)
  - Firestore membership check
  - QR modal (centered + backdrop)
  - Scan-only link (pwd protected)
  - View/Add Photos, Group Chat, Suggest Activity buttons
*/

const SKIP_SMS = false;      
const LOCAL_OVERRIDE = true; // force 127.0.0.1 when running on localhost
function loadPhone() {
  try { return localStorage.getItem('userPhone'); } catch { return null; }
}
// 0. Fade-in setup
document.addEventListener('DOMContentLoaded', () => {
  const elems = [
    document.getElementById('title'),
    ...document.querySelectorAll('#controls button'),
    document.getElementById('link-scan')
  ];
  elems.forEach(el => {
    if (!el) return;
    el.style.opacity = '0';
    el.style.transition = 'opacity 500ms ease';
  });
  elems.forEach((el, i) => {
    if (!el) return;
    setTimeout(() => (el.style.opacity = '1'), i * 100);
  });

  const wrapper = document.getElementById('qr-wrapper');
  if (wrapper) {
    wrapper.style.opacity = '0';
    wrapper.style.transition = 'opacity 300ms ease';
    // === FIX STARTS HERE ===
    // These styles ensure the modal is bigger and appears on top of the overlay.
    Object.assign(wrapper.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: '2001', // Higher than the overlay's z-index of 1000
        width: '320px', // Making the modal bigger
        height: '320px',
        padding: '20px',
        borderRadius: '10px',
        boxShadow: '0 5px 20px rgba(0,0,0,0.3)'
    });
    // === FIX ENDS HERE ===
  }
});

// 1. Initialize Firebase + set LOCAL persistence
(async function initApp(){
  if (!window.firebaseConfig) {
    throw new Error("Missing js/firebaseConfig.js");
  }
  firebase.initializeApp(window.firebaseConfig);
  const auth = firebase.auth();
  // fire-and-forget; we don't block rendering on this
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch(err => console.warn('Couldn’t set persistence:', err));
  const db   = firebase.firestore();
  // turn on local cache + multi-tab sync
  db.enablePersistence({ synchronizeTabs: true })
    .catch(err => {
      // persistence can fail if you have multiple tabs open in older browsers
      console.warn("Firestore persistence failed:", err.code);
    });

  // ── LISTEN FOR LOGIN FROM IFRAME ─────────────────────────────────────────
  window.addEventListener('message', async e => {
    if (e.origin !== window.location.origin) return;
    const msg = e.data;
    if (msg.type === 'loginSuccess' && msg.phone) {
      return handleLogin(msg.phone, msg.name || '');
    }
  });

  // ── ONCE WE GET A SUCCESSFUL LOGIN ───────────────────────────────────────
  async function handleLogin(phone, name) {
    // persist
    savePhone(phone);

    // swap UI
    document.getElementById('phone-entry').style.display = 'none';
    document.getElementById('app').style.display         = 'block';
    document.getElementById('user-name').innerText      = name;

    
  }

  // 1a. If on "localhost", redirect to "127.0.0.1" (Chrome sometimes rejects localhost reCAPTCHA)
  if (LOCAL_OVERRIDE && location.hostname === 'localhost') {
    const newHref = location.href.replace('localhost', '127.0.0.1');
    location.replace(newHref);
  }

  // === Persist phone across sessions ===
  function savePhone(phone) {
    try { localStorage.setItem('userPhone', phone); } catch {}
    document.cookie = `userPhone=${phone};max-age=${60*60*24*365};path=/;SameSite=Lax`;
  }
  function loadPhone() {
    try { return localStorage.getItem('userPhone'); } catch {}
    const m = document.cookie.match(/(?:^|; )userPhone=(\d{10})/);
    return m ? m[1] : null;
  }

  /**
   * Try to get the member doc from cache first;
   * if it’s missing or stale, fall back to server.
   */
  async function getMemberDoc(phone) {
    const ref = db.collection('members').doc(phone);
    // 1) try cache
    try {
      const snap = await ref.get({ source: 'cache' });
      if (snap.exists) return snap;
    } catch (_) { /* cache read failed; ignore */ }

    // 2) fall back to server
    return await ref.get();
  }

  // 0a) Listen for loginSuccess from our /login iframe
  window.addEventListener('message', async e => {
    if (e.origin !== window.location.origin) return;
    const msg = e.data;
    if (msg.type === 'loginSuccess' && msg.phone) {
      return handleLogin(msg.phone, msg.name || '');
    }
  });

  // 0b) handleLogin: hide iframe, show app, save phone
  async function handleLogin(phone, name) {
    // persist
    savePhone(phone);

    // update UI
    document.getElementById('phone-entry').style.display = 'none';
    document.getElementById('app').style.display         = 'block';
    document.getElementById('user-name').innerText      = name;

  
  }


  // 2. Invisible reCAPTCHA initialization helper
  async function initRecaptcha() {
    // Clear any existing verifier
    if (window.recaptchaVerifier) {
      try { window.recaptchaVerifier.clear(); }
      catch (_) { /* ignore */ }
    }

    // Create a brand-new invisible reCAPTCHA bound to the container
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier(
      'recaptcha-container',
      {
        size: 'invisible',
        callback: token => {
          console.log('reCAPTCHA solved, token:', token);
        },
        'expired-callback': () => {
          console.warn('reCAPTCHA expired; clearing & reinitializing');
          initRecaptcha();
        }
      }
    );

    // Render the widget and wait for it to be ready
    await window.recaptchaVerifier.render();
    // Immediately trigger verification to obtain a fresh token
    await window.recaptchaVerifier.verify();
  }

  // 3. Phone-entry + SMS auth
  let testPhone     = '';
  let memberName    = '';
  let memberOnList  = false;



  // 5. QR & encryption
  const QR_REFRESH    = 4;
  const SCAN_COOLDOWN = 35 * 60 * 1000;
  const COLORS        = { green:"#5c5146", gold:"#b49e85" };
  let qrCode, qrInterval, timerInterval, countdown;

  function randomNoise(n) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: n }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');
  }
  function encryptText(txt) {
    return randomNoise(5) + btoa(txt) + randomNoise(5);
  }
  function decryptText(noisy) {
    if (noisy.length <= 10) throw 'Invalid payload';
    return atob(noisy.slice(5, -5));
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function nowStr() {
    const d = new Date();
    return (
      `${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
      `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
    );
  }

  // 6. Modal backdrop & QR positioning
  let qrOverlay = null;
  function ensureOverlay() {
    if (!qrOverlay) {
      qrOverlay = document.createElement('div');
      qrOverlay.id = 'qr-overlay';
      Object.assign(qrOverlay.style, {
        position: 'fixed', top: 0, left: 0,
        width: '100%', height: '100%',

        background: 'rgba(0,0,0,0)',
        display: 'none', zIndex: 999
      });
      document.body.appendChild(qrOverlay);
      qrOverlay.addEventListener('click', hideQR);
    }
  }

  function toggleQRDisplay() {
    const w = document.getElementById('qr-wrapper');
    if (!w) return;
    w.style.display === 'block' ? hideQR() : showQR();
  }

  function showQR() {
    clearInterval(qrInterval);
    clearInterval(timerInterval);
    const scanResult = document.getElementById('scan-result');
    if (scanResult) scanResult.innerText = '';

    ensureOverlay();
    qrOverlay.style.display = 'block';

    const w = document.getElementById('qr-wrapper');
    if (!w) return;
    w.style.display = 'block';
    w.style.opacity = '0';
    requestAnimationFrame(() => (w.style.opacity = '1'));

    generateAndFadeQR();
    startTimer();
    qrInterval = setInterval(generateAndFadeQR, QR_REFRESH * 1000);
  }

  function hideQR() {
    clearInterval(qrInterval);
    clearInterval(timerInterval);
    if (qrOverlay) qrOverlay.style.display = 'none';

    const w = document.getElementById('qr-wrapper');
    if (!w) return;
    w.style.opacity = '0';
    setTimeout(() => {
      w.style.display = 'none';
      const closeBtn = document.getElementById('qr-close');
      if (closeBtn) closeBtn.style.display = 'none';
    }, 300);
  }

  function generateAndFadeQR() {
    countdown = QR_REFRESH;
    const timerEl = document.getElementById('qr-timer');
    if (timerEl) timerEl.innerText = `Refreshing in ${countdown}s`;

    const payload = `${nowStr()}R${testPhone}`;
    const cipher  = encryptText(payload);
    const disp    = document.getElementById('qr-display');
    if (!disp) return;

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
      requestAnimationFrame(() => (qrElem.style.opacity = '1'));
    }
    const closeBtn = document.getElementById('qr-close');
    if (closeBtn) closeBtn.style.display = 'block';
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      countdown--;
      const timerEl = document.getElementById('qr-timer');
      if (timerEl) timerEl.innerText = `Refreshing in ${countdown}s`;
    }, 1000);
  }

  const scannedMap = {};
  async function startQRScan() {
    clearInterval(qrInterval);
    clearInterval(timerInterval);
    hideQR();

    const scanResult = document.getElementById('scan-result');
    if (scanResult) scanResult.innerText = '';

    const scanner = new Html5Qrcode('qr-scanner');
    try {
      await scanner.start(
        { facingMode:'environment' },
        { fps:10, qrbox:250 },
        async (raw) => {
          await scanner.stop();
          let decoded;
          try { decoded = decryptText(raw); }
          catch { return alert('Invalid QR'); }

          const phone = decoded.slice(11);
          if (
            scannedMap[phone] &&
            Date.now() - scannedMap[phone] < SCAN_COOLDOWN
          ) {
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
            sPoints: firebase.firestore.FieldValue.increment(70)
          });
          alert(`✅ Welcome, ${name}!`);
        },
        (_) => {}
      );
    } catch (err) {
      console.error('Error starting QR scan:', err);
      alert('Cannot start scanner.');
    }
  }

  // 7. Other actions
  function openPhotos() {
    window.location.href = 'photos.html';
  }
  function openChat() {
    const phone = loadPhone();
    if (!phone)       return alert('Enter your phone first.');
    if (!memberOnList) return alert('Group chat is for approved members only.');
    window.location.href = 'https://ig.me/j/Aba0eY89-aoNrGqG/';
  }
  async function suggestActivity() {
    if (!loadPhone()) return alert('Enter your phone first.');
    const s = prompt("What activity would you like us to do next?");
    if (!s || !s.trim()) return;
    try {
      await db.collection('members').doc(testPhone).update({
        suggestions: firebase.firestore.FieldValue.arrayUnion(s.trim())
      });
      alert('Thanks for your suggestion!');
    } catch (err) {
      console.error(err);
      alert('Error saving suggestion.');
    }
  }

  // 8. Wire up controls
  window.addEventListener('load', () => {
    const btnDisplay  = document.getElementById('btn-display');
    const btnPhotos   = document.getElementById('btn-photos');
    const btnChat     = document.getElementById('btn-chat');
    const btnSuggest  = document.getElementById('btn-suggest');
    const linkScan    = document.getElementById('link-scan');
    const btnQrClose  = document.getElementById('qr-close');
    const btnSignOut  = document.getElementById('sign-out');
    const btnSignUp   = document.getElementById('sign-up');  // just redirects

    if (btnDisplay) btnDisplay.onclick = toggleQRDisplay;
    if (btnPhotos)  btnPhotos.onclick  = openPhotos;
    if (btnChat)    btnChat.onclick    = openChat;
    if (btnSuggest) btnSuggest.onclick = suggestActivity;
    if (linkScan) {
      linkScan.onclick = (e) => {
        e.preventDefault();
        const pwd = prompt("Enter admin password to scan QR:");
        if (pwd === 'prix') startQRScan();
        else alert('Incorrect password.');
      };
    }
    if (btnQrClose) btnQrClose.onclick = hideQR;

    // Sign Up button simply redirects
    if (btnSignUp) {
      btnSignUp.onclick = () => {
        window.location.href = 'https://fromstrangers.social/join';
      };
    }

    // Sign Out logic
    if (btnSignOut) {
      btnSignOut.onclick = () => {
        // Firebase sign-out
        auth.signOut().catch(console.error);

        // Clear stored phone from localStorage and cookie
        try { localStorage.removeItem('userPhone'); } catch {}
        document.cookie = 'userPhone=; max-age=0; path=/;';

        // Reload page to show phone-entry again
        location.reload();
      };
    }

      const btnLeaderboard = document.getElementById('btn-leaderboard');
      if (btnLeaderboard) {
        btnLeaderboard.onclick = () => {
          if (!loadPhone()) {
            return alert('Enter your phone first.');
          }
          window.location.href = 'leaderboard.html';
        };
      }

  });
})();