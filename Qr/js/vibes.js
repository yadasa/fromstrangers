// /js/vibes.js

// ─── 0) LOCAL-CACHE HELPERS ────────────────────────────────────────────────
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

// ─── 1) APP SHELL SHOW/HIDE ─────────────────────────────────────────────────
function showVibesApp() {
  const pe = document.getElementById('phone-entry');
  const app = document.getElementById('app');
  if (pe)  pe.style.display  = 'none';
  if (app) app.style.display = 'block';
}

// ─── 2) “INIT VIBES” MOVED OUT INTO A REUSABLE FUNCTION ───────────────────
async function initVibes(phone) {
  let saved = false;
  let dirty = false;
  const answeredBefore = new Set();
  let existingPoints = 0;

  const db           = firebase.firestore();
  const form         = document.getElementById('vibe-form');
  const questionsEl  = document.getElementById('questionsContainer');
  const saveBtn      = document.getElementById('saveBtn');
  const postSave     = document.getElementById('postSaveButtons');
  const returnHome   = document.getElementById('returnHome');
  const editBtn      = document.getElementById('editBtn');
  const backArrow    = document.getElementById('back-arrow');
  const wFormDone    = document.querySelector('.w-form-done');

  // — fetch existing vibes & prefill —
  const snap = await db.collection('members').doc(phone).get();
  const data = snap.data() || {};
  const existing = data.vibes || {};
  existingPoints = data.sPoints || 0;
  Object.entries(existing).forEach(([k, v]) => {
    if (v !== 0) answeredBefore.add(k);
  });
  document.querySelectorAll('.range-slider').forEach(slider => {
    const key = slider.name;
    const val = existing[key] || 0;
    slider.value = 0;
    slider.dispatchEvent(new Event('input'));
    if (val !== 0) animateSlider(slider, 0, val);
  });

  // — animate helper —
  function animateSlider(slider, from, to, duration = 600) {
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = t * (2 - t);
      slider.value = from + (to - from) * eased;
      slider.dispatchEvent(new Event('input'));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // — gradient + dirty-flag logic —
  const midPct = 50, fadeWidth = 2;
  document.querySelectorAll('.range-slider').forEach(slider => {
    const min = parseFloat(slider.min), max = parseFloat(slider.max);
    slider.addEventListener('input', e => { if (e.isTrusted) dirty = true; });
    const updateGradient = () => {
      const val = parseFloat(slider.value);
      if (val === 0) return slider.style.background = '#FFFFFF';
      const pct = ((val - min) / (max - min)) * 100;
      let bg;
      if (val > 0) {
        const fs = midPct - fadeWidth;
        bg = `linear-gradient(to right,
          #FFFFFF 0%, #FFFFFF ${fs}%,
          #DCC9B8 ${midPct}%,
          #1A1A1A ${pct}%,
          #FFFFFF ${pct}%, #FFFFFF 100%
        )`;
      } else {
        const fe = midPct + fadeWidth;
        bg = `linear-gradient(to right,
          #FFFFFF 0%, #FFFFFF ${pct}%,
          #1A1A1A ${pct}%,
          #DCC9B8 ${midPct}%,
          #FFFFFF ${fe}%, #FFFFFF 100%
        )`;
      }
      slider.style.background = bg.replace(/\s+/g,' ');
    };
    slider.addEventListener('input', updateGradient);
    updateGradient();
  });

  // — warn on unload or back if dirty & not saved —
  window.addEventListener('beforeunload', e => {
    if (!saved && dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  if (backArrow) {
    backArrow.addEventListener('click', e => {
      if (!saved && dirty && !confirm('You have unsaved changes. Leave anyway?')) {
        e.preventDefault();
      }
    });
  }

  // — form submit: save vibes + award points —
  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    const vibes = {};
    for (let i = 1; i <= 20; i++) {
      vibes[`q${i}`] = parseFloat(form.elements[`q${i}`].value);
    }
    ['chillVsCompetitive','indoorsVsOutdoors','plannedVsSpontaneous',
     'smallVsLarge','quietVsVibrant']
      .forEach(k => vibes[k] = parseFloat(form.elements[k].value));

    let newPts = 0;
    Object.entries(vibes).forEach(([k,v]) => {
      if (v !== 0 && !answeredBefore.has(k)) newPts += 7;
    });

    try {
      const ref = db.collection('members').doc(phone);
      await ref.set({ vibes }, { merge: true });
      if (newPts) {
        await ref.update({
          sPoints: firebase.firestore.FieldValue.increment(newPts)
        });
      }
      saved = true;
      dirty = false;

      if (wFormDone && postSave) {
        postSave.parentNode.insertBefore(wFormDone, postSave);
        wFormDone.style.display = 'block';
      }
      if (questionsEl) questionsEl.style.display = 'none';
      if (saveBtn)     saveBtn.style.display     = 'none';
      if (postSave)    postSave.style.display    = 'flex';
    } catch (err) {
      console.error(err);
      alert('Error saving—please try again');
    }
  });

  // — return home & edit buttons —
  if (returnHome) returnHome.addEventListener('click', () => {
    window.location = 'index.html';
  });
  if (editBtn) editBtn.addEventListener('click', () => {
    saved = false; dirty = false;
    if (wFormDone) wFormDone.style.display = 'none';
    if (questionsEl) questionsEl.style.display = 'block';
    if (saveBtn)     saveBtn.style.display     = 'block';
    if (postSave)    postSave.style.display    = 'none';
  });
}

// ─── 3) MAIN ENTRY: WIRE UP FIREBASE AUTH & OPTIMISTIC UI ─────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!window.firebaseConfig) {
    throw new Error('Missing firebaseConfig.js');
  }
  firebase.initializeApp(window.firebaseConfig);
  const auth = firebase.auth();

  // 3.1) Don’t block on persistence
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch(err => console.warn('Auth persistence failed:', err));

  // 3.2) Optimistically show UI & kick off load from cached phone
  const cachedPhone = loadPhone();
  if (cachedPhone) {
    showVibesApp();
    initVibes(cachedPhone);
  }

  // 3.3) Now wait for real auth
  auth.onAuthStateChanged(async user => {
    if (!user) {
      // no session → clear cache & bounce to login
      localStorage.removeItem('userPhone');
      localStorage.removeItem('userName');
      return location.replace('index.html');
    }
    const phone = user.phoneNumber.replace('+1','');
    savePhone(phone);

    showVibesApp();
    initVibes(phone);
  });
});
