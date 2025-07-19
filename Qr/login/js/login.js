// /login/login.js

// 1) Initialize Firebase exactly as in event.js
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig.js");
}
firebase.initializeApp(window.firebaseConfig);
const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();
const recaptchaContainer = document.getElementById('recaptcha-container');

/**
 * Try cache first; fall back to server if nothing’s in IndexedDB.
 */
async function getMemberDoc(phone) {
  const ref = db.collection('members').doc(phone);
  try {
    const snap = await ref.get({ source: 'cache' });
    if (snap.exists) return snap;
  } catch {}
  return await ref.get();
}

// 2) Emulator setup (identical to event.js)
if (location.hostname === 'localhost') {
  firebase.firestore().useEmulator('127.0.0.1', 8080);
  firebase.functions().useEmulator('127.0.0.1', 5001);
}

// 3) Invisible reCAPTCHA (only render once)
async function initRecaptcha() {
  if (auth.currentUser) return;
  if (window.recaptchaVerifier) return;
  
  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier(
    'recaptcha-container',
    {
      size: 'invisible',
      callback: token => console.log('reCAPTCHA token:', token),
      'expired-callback': () => {
        console.warn('reCAPTCHA expired; re-rendering');
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
        initRecaptcha();
      }
    }
  );
  await window.recaptchaVerifier.render();
}

// 0a) Helpers to persist phone & name locally
function savePhone(phone) {
  try { localStorage.setItem('userPhone', phone); } catch {}
  document.cookie = `userPhone=${phone};max-age=${60*60*24*365};path=/;SameSite=Lax`;
}
function loadPhone() {
  try { return localStorage.getItem('userPhone'); } catch {}
  const m = document.cookie.match(/(?:^|; )userPhone=(\d{10})/);
  return m ? m[1] : null;
}
function saveName(name) {
  try { localStorage.setItem('userName', name); } catch {}
}
function loadName() {
  return localStorage.getItem('userName') || '';
}

// 4) DOM Ready → set up persistence, auth‐listener, UI logic
document.addEventListener('DOMContentLoaded', () => {
  // 4.0) Optimistically restore UI from localStorage
  const cachedPhone = loadPhone();
  const cachedName  = loadName();
  if (cachedPhone) {
    const phoneEntry = document.getElementById('phone-entry');
    const appEl      = document.getElementById('app');
    const nameEl     = document.getElementById('user-name');
    if (phoneEntry) phoneEntry.style.display = 'none';
    if (appEl)      appEl.style.display      = 'block';
    if (nameEl)     nameEl.innerText         = cachedName;
    window.parent.postMessage(
      { type: 'loginSuccess', phone: cachedPhone, name: cachedName },
      '*'
    );
  }

  // 4.3) React to sign‐in (or reload) events *immediately*
  auth.onAuthStateChanged(async user => {
    if (!user) {
      localStorage.removeItem('userPhone');
      localStorage.removeItem('userName');
      const appEl      = document.getElementById('app');
      const phoneEntry = document.getElementById('phone-entry');
      if (appEl)      appEl.style.display      = 'none';
      if (phoneEntry) phoneEntry.style.display = 'block';
      return;
    }

       // ➋ user just signed in (or was already), so clear any existing widget:
       if (window.recaptchaVerifier) {
         window.recaptchaVerifier.clear();
         window.recaptchaVerifier = null;
       }
    const phone = user.phoneNumber.replace('+1', '');
    const snap  = await getMemberDoc(phone);
    const name  = snap.exists ? snap.data().name : '';
    savePhone(phone);
    saveName(name);

    const phoneEntry = document.getElementById('phone-entry');
    const appEl      = document.getElementById('app');
    const nameEl     = document.getElementById('user-name');
    if (phoneEntry) phoneEntry.style.display = 'none';
    if (appEl)      appEl.style.display      = 'block';
    if (nameEl)     nameEl.innerText         = name;

    window.parent.postMessage(
      { type: 'loginSuccess', phone, name },
      '*'
    );
  });

  // 4.1) Fire-and-forget: persist session (won’t block the UI)
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch(err => console.warn('Couldn’t set persistence:', err));

  

  // 4.4) Grab DOM elements (with null‐guards)
  const initialScreen = document.getElementById('initial-screen');
  const phoneScreen   = document.getElementById('phone-screen');
  const codeScreen    = document.getElementById('code-screen');

  const signInBtn     = document.getElementById('sign-in-btn');
  const confirmBtn    = document.getElementById('confirm-btn');
  const verifyBtn     = document.getElementById('verify-btn');
  const backToInitial = document.getElementById('back-to-initial');
  const backToPhone   = document.getElementById('back-to-phone');

  const phoneInput    = document.getElementById('phone-input');
  const otpInput      = document.getElementById('otp-input');

  const signUpBtn     = document.getElementById('sign-up');
  const signupOverlay = document.getElementById('signup-overlay');
  const signupClose   = document.getElementById('signup-close');
  const signupIframe  = signupOverlay?.querySelector('iframe');

  // A) “Sign In” → show phone entry
  if (signInBtn) signInBtn.onclick = () => {
    initialScreen?.style && (initialScreen.style.display = 'none');
    phoneScreen?.style &&   (phoneScreen.style.display   = 'block');
  };

  // Back arrow: phone → initial
  if (backToInitial) backToInitial.onclick = () => {
    phoneScreen?.style &&   (phoneScreen.style.display   = 'none');
    initialScreen?.style && (initialScreen.style.display = 'block');
  };

  // B) “Confirm” → check Firestore before sending SMS
  if (confirmBtn) confirmBtn.onclick = async () => {
    if (!phoneInput) return;
    let raw = phoneInput.value.replace(/\D/g, '');
    if (raw.length === 11 && raw.startsWith('1')) raw = raw.slice(1);
    if (raw.length !== 10) {
      alert('Please enter a valid 10-digit phone.');
      return;
    }

    try {
      const profileSnap = await getMemberDoc(raw);
      if (!profileSnap.exists) {
        alert('Profile not found. Check the number and try again.');
        return;
      }

      // ← INSERT DENIED CHECK HERE
      if (profileSnap.data().status === 'denied') {
        alert('Your access has been denied. Please contact support.');
        return;
      }

      
    } catch (err) {
      console.error('Error checking profile:', err);
      alert('Error verifying profile. Please try again later.');
      return;
    }

    if (!window.recaptchaVerifier) {
      await initRecaptcha();
    }

    try {
      const confirmation = await auth.signInWithPhoneNumber(
        '+1' + raw,
        window.recaptchaVerifier
      );
      window.confirmationResult = confirmation;
      phoneScreen?.style && (phoneScreen.style.display = 'none');
      codeScreen?.style  && (codeScreen.style.display  = 'block');
    } catch (err) {
      console.error('signInWithPhoneNumber error:', err);
      alert('SMS not sent: ' + err.message);
    }
  };

  // Back arrow: code → phone
  if (backToPhone) backToPhone.onclick = () => {
    codeScreen?.style  && (codeScreen.style.display  = 'none');
    phoneScreen?.style && (phoneScreen.style.display = 'block');
  };

  // C) OTP verify (button & auto)
  async function verifyCode() {
    if (!otpInput) return;
    const code = otpInput.value.trim();
    if (code.length !== 6) return;
    try {
      await window.confirmationResult.confirm(code);
      // onAuthStateChanged will do the rest
    } catch (err) {
      console.error('OTP confirm error:', err);
      alert('Invalid code: ' + err.message);
    }
  }
  if (verifyBtn) verifyBtn.onclick = verifyCode;
  if (otpInput) otpInput.addEventListener('input', () => {
    if (otpInput.value.trim().length === 6) verifyCode();
  });

  // F) Sign-Up overlay
  if (signUpBtn) signUpBtn.onclick = () => {
    const refToken = new URLSearchParams(location.search).get('ref') || '';
    if (signupIframe) {
      signupIframe.src = `../signup.html?ref=${encodeURIComponent(refToken)}`;
      signupOverlay?.style && (signupOverlay.style.display = 'block');
    }
  };
  if (signupClose) signupClose.onclick = () =>
    signupOverlay?.style && (signupOverlay.style.display = 'none');
});
