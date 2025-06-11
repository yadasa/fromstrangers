// /js/vibes.js

document.addEventListener('DOMContentLoaded', () => {
  let saved = false;
  let dirty = false;                 // tracks user edits
  let answeredBefore = new Set();
  let existingPoints = 0;

  // 1) login gating
  const phone = loadPhone();
  if (!phone) return;
  document.getElementById('phone-entry').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  const db = firebase.firestore();
  const form = document.getElementById('vibe-form');
  const questionsEl = document.getElementById('questionsContainer');
  const saveBtn = document.getElementById('saveBtn');
  const postSave = document.getElementById('postSaveButtons');
  const returnHome = document.getElementById('returnHome');
  const editBtn = document.getElementById('editBtn');
  const backArrow = document.getElementById('back-arrow');
  const wFormDone = document.querySelector('.w-form-done');

  // 2) Warn on unload or back if dirty & not saved
  window.addEventListener('beforeunload', e => {
    if (!saved && dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  backArrow.addEventListener('click', e => {
    if (!saved && dirty && !confirm('You have unsaved changes. Leave anyway?')) {
      e.preventDefault();
    }
  });

  // 3) Fetch existing vibes & prefill + animate
  db.collection('members').doc(phone).get().then(snap => {
    const data = snap.data() || {};
    const existing = data.vibes || {};
    existingPoints = data.sPoints || 0;

    // mark which were non-zero already
    Object.entries(existing).forEach(([k, v]) => {
      if (v !== 0) answeredBefore.add(k);
    });

    // prefill sliders
    document.querySelectorAll('.range-slider').forEach(slider => {
      const key = slider.name;
      const val = existing[key] || 0;
      slider.value = 0;
      slider.dispatchEvent(new Event('input'));  // show white
      if (val !== 0) {
        // animate from 0 to stored val
        animateSlider(slider, 0, val);
      }
    });
  });

  // animate helper
  function animateSlider(slider, from, to, duration = 600) {
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = t * (2 - t); // easeOutQuad
      slider.value = from + (to - from) * eased;
      slider.dispatchEvent(new Event('input'));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // 4) Gradient + dirty‐flag logic
  const midPct = 50, fadeWidth = 2;
  document.querySelectorAll('.range-slider').forEach(slider => {
    const min = parseFloat(slider.min),
          max = parseFloat(slider.max);

    // track user‐driven changes only
    slider.addEventListener('input', e => {
      if (e.isTrusted) dirty = true;
    });

    function updateGradient() {
      const val = parseFloat(slider.value);
      if (val === 0) {
        slider.style.background = '#FFFFFF';
        return;
      }
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
      slider.style.background = bg.replace(/\s+/g, ' ');
    }

    slider.addEventListener('input', updateGradient);
    updateGradient();
  });

  // 5) Save → award points, toggle UI
  form.addEventListener('submit', async e => {
    e.preventDefault();

    // gather vibes
    const vibes = {};
    for (let i = 1; i <= 20; i++) {
      vibes[`q${i}`] = parseFloat(form.elements[`q${i}`].value);
    }
    ['chillVsCompetitive','indoorsVsOutdoors','plannedVsSpontaneous','smallVsLarge','quietVsVibrant']
      .forEach(k => vibes[k] = parseFloat(form.elements[k].value));

    // compute new points
    let newPts = 0;
    Object.entries(vibes).forEach(([k, v]) => {
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
      dirty = false;  // no longer dirty

      // move ✅ message above buttons & show it
      postSave.parentNode.insertBefore(wFormDone, postSave);
      wFormDone.style.display = 'block';

      // hide questions/save, show return/edit
      questionsEl.style.display = 'none';
      saveBtn.style.display = 'none';
      postSave.style.display = 'flex';
    } catch (err) {
      console.error(err);
      alert('Error saving—please try again');
    }
  });

  // 6) Return home
  returnHome.addEventListener('click', () => {
    window.location = 'index.html';
  });

  // 7) Edit responses → restore UI
  editBtn.addEventListener('click', () => {
    saved = false;
    dirty = false;
    wFormDone.style.display = 'none';
    questionsEl.style.display = 'block';
    saveBtn.style.display = 'block';
    postSave.style.display = 'none';
  });
});
