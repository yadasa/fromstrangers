// 1) Initialize Firebase exactly as in event.js
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig.js");
}
firebase.initializeApp(window.firebaseConfig);
const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();

// 2) Emulator setup (identical to event.js)
if (location.hostname === 'localhost') {
  firebase.firestore().useEmulator('127.0.0.1', 8080);
  firebase.functions().useEmulator('127.0.0.1', 5001);
}

// 3) Invisible reCAPTCHA (only render once)
async function initRecaptcha() {
  // If already set up, do nothing
  if (window.recaptchaVerifier) return;
  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier(
    'recaptcha-container',
    {
      size: 'invisible',
      callback: token => console.log('reCAPTCHA token:', token),
      'expired-callback': () => {
        console.warn('reCAPTCHA expired; re-rendering');
        // force recreate if expired
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
        initRecaptcha();
      }
    }
  );
  await window.recaptchaVerifier.render();
}

// 4) Session persistence
function savePhone(phone) {
  try { localStorage.setItem('userPhone', phone); } catch {}
  document.cookie = `userPhone=${phone};max-age=${60*60*24*365};path=/;SameSite=Lax`;
}
function loadPhone() {
  try { return localStorage.getItem('userPhone'); } catch {}
  const m = document.cookie.match(/(?:^|; )userPhone=(\d{10})/);
  return m ? m[1] : null;
}

// 5) DOM Ready → wire up state transitions & init reCAPTCHA
document.addEventListener('DOMContentLoaded', async () => {
  await initRecaptcha();  // <- run once

  const initialScreen   = document.getElementById('initial-screen');
  const phoneScreen     = document.getElementById('phone-screen');
  const codeScreen      = document.getElementById('code-screen');

  const signInBtn       = document.getElementById('sign-in-btn');
  const confirmBtn      = document.getElementById('confirm-btn');
  const verifyBtn       = document.getElementById('verify-btn');
  const backToInitial   = document.getElementById('back-to-initial');
  const backToPhone     = document.getElementById('back-to-phone');

  const phoneInput      = document.getElementById('phone-input');
  const otpInput        = document.getElementById('otp-input');

  const signUpBtn       = document.getElementById('sign-up');
  const signupOverlay   = document.getElementById('signup-overlay');
  const signupClose     = document.getElementById('signup-close');
  const signupIframe    = signupOverlay.querySelector('iframe');

  // A) “Sign In” → show phone entry
  signInBtn.onclick = () => {
    initialScreen.style.display = 'none';
    phoneScreen.style.display   = 'block';
  };

  // Back arrow: phone → initial
  backToInitial.onclick = () => {
    phoneScreen.style.display   = 'none';
    initialScreen.style.display = 'block';
  };

  // B) “Confirm” → check Firestore before sending SMS
  confirmBtn.onclick = async () => {
    let raw = phoneInput.value.replace(/\D/g, '');
    if (raw.length === 11 && raw.startsWith('1')) raw = raw.slice(1);
    if (raw.length !== 10) {
      alert('Please enter a valid 10-digit phone.');
      return;
    }

    // Only send if profile exists
    try {
      const profileSnap = await db.collection('members').doc(raw).get();
      if (!profileSnap.exists) {
        alert('Profile not found. Check the number and try again.');
        return;
      }
    } catch (err) {
      console.error('Error checking profile:', err);
      alert('Error verifying profile. Please try again later.');
      return;
    }

    // Use the already-rendered reCAPTCHA
    try {
      const confirmation = await auth.signInWithPhoneNumber(
        '+1' + raw,
        window.recaptchaVerifier
      );
      window.confirmationResult = confirmation;

      // move to code entry
      phoneScreen.style.display = 'none';
      codeScreen.style.display  = 'block';
    } catch (err) {
      console.error('signInWithPhoneNumber error:', err);
      alert('SMS not sent: ' + err.message);
    }
  };

  // Back arrow: code → phone
  backToPhone.onclick = () => {
    codeScreen.style.display  = 'none';
    phoneScreen.style.display = 'block';
  };

  // C) OTP verify (button & auto)
  async function verifyCode() {
    const code = otpInput.value.trim();
    if (code.length !== 6) return;
    try {
      const cred = await window.confirmationResult.confirm(code);
      const phone = cred.user.phoneNumber.replace('+1','');
      savePhone(phone);

      // optional: fetch name
      const snap = await db.collection('members').doc(phone).get();
      const name = snap.exists ? snap.data().name : '';

      // hide overlay & notify parent
      document.getElementById('phone-entry').style.display = 'none';
      window.parent.postMessage({ type:'loginSuccess', phone, name }, '*');
    } catch (err) {
      console.error('OTP confirm error:', err);
      alert('Invalid code: ' + err.message);
    }
  }

  verifyBtn.onclick = verifyCode;
  otpInput.addEventListener('input', () => {
    if (otpInput.value.trim().length === 6) verifyCode();
  });

  // F) Sign-Up overlay
  signUpBtn.onclick = () => {
    const refToken = new URLSearchParams(location.search).get('ref') || '';
    signupIframe.src = `https://fromstrangers.social/join/?ref=${encodeURIComponent(refToken)}`;
    signupOverlay.style.display = 'block';
  };
  signupClose.onclick = () => signupOverlay.style.display = 'none';
});
