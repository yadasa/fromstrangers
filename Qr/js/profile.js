// js/profile.js
import { computeVibeSimilarity } from './vibeSimilarity.js';
function randomChars(len = 7) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
// ─── A) LOCAL STORAGE HELPERS ──────────────────────────────────────
function savePhone(phone) {
  try { localStorage.setItem('userPhone', phone); } catch { }
  document.cookie = `userPhone=${phone};max-age=${60 * 60 * 24 * 365};path=/;SameSite=Lax`;
}
function loadPhone() {
  try { return localStorage.getItem('userPhone'); } catch { }
  const m = document.cookie.match(/(?:^|; )userPhone=(\d{10})/);
  return m ? m[1] : null;
}
function saveName(name) {
  try { localStorage.setItem('userName', name); } catch { }
}
function loadName() {
  return localStorage.getItem('userName') || '';
}


document.addEventListener('DOMContentLoaded', () => {
  if (!window.firebaseConfig) throw new Error('Missing firebaseConfig.js');
  firebase.initializeApp(window.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  // ─── B) SET PERSISTENCE (non-blocking) ─────────────────────────────
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(err => console.warn('Auth persistence failed:', err));

  // ─── C) OPTIMISTIC UI FROM CACHE ──────────────────────────────────
  const cachedPhone = loadPhone();
  const cachedName = loadName();
  if (cachedPhone) {
    // 1) show the profile app shell immediately
    const appEl = document.getElementById('profile-app');
    if (appEl) appEl.style.display = 'block';

    // 2) set header title
    const hdrTitle = document.getElementById('header-title');
    if (hdrTitle) hdrTitle.innerText = cachedName;


  }

  // Your profile‐only Drive folder ID
  const PROFILE_DRIVE_FOLDER_ID = '1zmOhvhrskbhtnot2RD86MNU__6bmuxo2';

  const appEl = document.getElementById('profile-app');
  const hdrTitle = document.getElementById('header-title');
  const backArrow = document.getElementById('back-arrow');

  const profileImg = document.getElementById('profile-img');
  const changePicBtn = document.getElementById('change-pic');
  const imgInput = document.getElementById('img-input');

  const nameView = document.getElementById('name-view');
  const nameInput = document.getElementById('name-input');
  const instaView = document.getElementById('insta-view');
  const instaInput = document.getElementById('insta-input');

  const pinInput = document.getElementById('pin-input');
  const confirmPin = document.getElementById('confirm-pin-input');
  const pwError = document.getElementById('pw-error');

  const editBtn = document.getElementById('edit-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const saveBtn = document.getElementById('save-btn');

  const cropOverlay = document.getElementById('crop-overlay');
  const cropContainer = document.getElementById('crop-container');
  const cropConfirm = document.getElementById('crop-confirm');
  const cropCancel = document.getElementById('crop-cancel');

  const instagramLink = document.getElementById('instagram-link');
  const vibeSimilarityEl = document.getElementById('vibe-similarity');

  let profileDocId = null;
  let originalName = '', originalInsta = '';
  let dirty = false, saved = false;

  async function hashHex(str) {
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(str)
    );
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function generateProfileId(phone) {
    const rev = phone.split('').reverse();
    let noise = '';
    for (const d of rev) {
      noise += d + Math.floor(Math.random() * 100).toString().padStart(2, '0');
    }
    const prefix = Math.floor(Math.random() * 10000)
      .toString().padStart(4, '0');
    const suffix = Math.floor(Math.random() * 10000)
      .toString().padStart(4, '0');
    return await hashHex(prefix + noise + suffix);
  }

  window.generateProfileId = generateProfileId;

  function getProfileId() {
    return new URLSearchParams(location.search).get('id');
  }

  auth.onAuthStateChanged(async user => {
    // 1) Optimistic fall-back: bail to login if no Firebase session OR no cached phone
    const cachedPhone = loadPhone();
    if (!user || !cachedPhone) {
      localStorage.removeItem('userPhone');
      localStorage.removeItem('userName');
      return location.replace('../index.html');
    }

    // 2) We have a real user—sync canonical phone → cache
    const me = user.phoneNumber.replace('+1', '');
    savePhone(me);

    // 3) Pull fresh displayName → cache
    const memberSnap = await db.collection('members').doc(me).get();
    const displayName = memberSnap.exists ? memberSnap.data().name : '';
    saveName(displayName);

    // 4) Reveal app shell & header optimistically
    const appEl = document.getElementById('profile-app');
    if (appEl) appEl.style.display = 'block';
    const hdrTitle = document.getElementById('header-title');
    if (hdrTitle) hdrTitle.innerText = displayName;

    // ensure we have a profileId in the URL
    let pid = getProfileId();
    if (!pid) {
      const ref = db.collection('members').doc(me);
      const snap = await ref.get();
      if (!snap.exists) return alert('Profile not found');
      pid = snap.data().profileId;
      if (!pid) {
        pid = await generateProfileId(me);
        await ref.update({ profileId: pid });
      }
      return location.replace(`${location.pathname}?id=${pid}`);
    }

    // load the profile being viewed
    const qs = await db.collection('members')
      .where('profileId', '==', pid)
      .get();
    if (qs.empty) return alert('Profile not found');
    const doc = qs.docs[0];
    profileDocId = doc.id;
    const data = doc.data();
    // ——— show sPoints ———
    const spoints = (data.sPointsTotal + data.sPoints) || 0;
    const spointsLink = document.getElementById('spoints-link');
    spointsLink.addEventListener('click', e => {
      e.preventDefault(); // stop the default navigation
    });
    spointsLink.textContent = `${spoints} sP`;
    // (the href is already set in the HTML to /leaderboard.html)

    // ▼ INSERT STEP 3 ▼
    // ▼ STEP 3: pill ↔ children toggle, auto-collapse, modals, etc. ─────
    // grab all the elements we need
    const spointsBox = document.getElementById('spoints-box');
    const childrenContainer = document.getElementById('spoints-children-container');
    const btnLeaderboard = document.getElementById('btn-leaderboard');
    const btnTransfer = document.getElementById('btn-transfer');
    const btnInfo = document.getElementById('btn-info');

    const transferModal = document.getElementById('transfer-modal');
    const transferInput = document.getElementById('transfer-amount');
    const transferError = document.getElementById('transfer-error');
    const transferOk = document.getElementById('transfer-confirm');
    const transferCancel = document.getElementById('transfer-cancel');

    const infoModal = document.getElementById('info-modal');
    const infoText = document.getElementById('info-text');
    const infoClose = document.getElementById('info-close');

    // collapse logic & timer
    let collapseTimer;
    function collapse() {
      childrenContainer.classList.remove('visible');
      spointsBox.classList.remove('hidden');
    }
    function startCollapseTimer() {
      clearTimeout(collapseTimer);
      collapseTimer = setTimeout(collapse, 3000);
    }

    // 1) tap the pill → hide it, show the 3 buttons, start 3s timer
    spointsBox.addEventListener('click', () => {
      spointsBox.classList.add('hidden');
      childrenContainer.classList.add('visible');
      startCollapseTimer();
    });

    // 2) Leaderboard: navigate immediately & collapse
    btnLeaderboard.addEventListener('click', () => {
      window.location.href = '/leaderboard.html';
      collapse();
    });

    // 3) Transfer sP: open modal & pause collapse timer
    btnTransfer.addEventListener('click', () => {
      clearTimeout(collapseTimer);
      transferInput.value = '';
      transferError.textContent = '';
      transferModal.classList.add('visible');
    });
    transferCancel.addEventListener('click', () => {
      transferModal.classList.remove('visible');
      if (childrenContainer.classList.contains('visible')) startCollapseTimer();
    });
    transferOk.addEventListener('click', async () => {
      const amt = parseInt(transferInput.value, 10);
      if (!amt || amt < 1) {
        transferError.textContent = 'Enter a positive number.';
        return;
      }

      transferOk.disabled = true;
      transferError.textContent = 'Processing…';

      

      try {
        await db.runTransaction(async tx => {
          const FieldValue = firebase.firestore.FieldValue;
          const fromRef = db.collection('members').doc(me);
          const toRef = db.collection('members').doc(profileDocId);

          const [fromSnap, toSnap] = await Promise.all([
            tx.get(fromRef),
            tx.get(toRef)
          ]);

          const fromPts = (fromSnap.data().sPoints || 0);
          const toPts = (toSnap.data().sPoints || 0);

          if (amt > fromPts) throw new Error('INSUFFICIENT');

          tx.update(fromRef, { sPoints: fromPts - amt });
          tx.update(toRef, { sPoints: toPts + amt });

          const timestamp = FieldValue.serverTimestamp();
          const recdId = `recd-${amt}sP-${randomChars()}`;
          const sentId = `sent-${amt}sP-${randomChars()}`;
          const senderLogRef    = fromRef.collection('sPointsLog').doc(sentId);
          const recipientLogRef = toRef  .collection('sPointsLog').doc(recdId);

          
          tx.set(senderLogRef, {
            type:      'sent',
            amount:    amt,
            to:        profileDocId,
            timestamp: timestamp
          });
          tx.set(recipientLogRef, {
            type:      'received',
            amount:    amt,
            from:      me,
            timestamp: timestamp
          });
        });

        // **fetch the updated recipient balance**  
        const updatedSnap = await db.collection('members')
          .doc(profileDocId)
          .get();
        const updatedPts = updatedSnap.data().sPoints || 0;

        transferError.style.color = 'green';
        transferError.textContent = `Transferred ${amt} sP!`;

        // **update the pill with the new, correct value**  
        const spointsLink = document.getElementById('spoints-link');
        spointsLink.textContent = `${updatedPts} sP`;

      } catch (err) {
        if (err.message === 'INSUFFICIENT') {
          transferError.textContent = 'Not enough sP.';
        } else {
          console.error(err);
          transferError.textContent = 'Transfer failed.';
        }
      } finally {
        transferOk.disabled = false;
        setTimeout(() => {
          transferModal.classList.remove('visible');
          transferError.style.color = 'red';
          if (childrenContainer.classList.contains('visible')) startCollapseTimer();
        }, 1000);
      }
    });


    // 4) Info: fetch rubric.json & open modal, pause timer
    btnInfo.addEventListener('click', async () => {
      clearTimeout(collapseTimer);
      // fetch the rubric
      const res = await fetch('/rubric.json');
      const rubric = await res.json();

      // build human‐readable HTML
      let html = `<p>${rubric.intro}</p>`;

      // quarterly event paragraph
      const q = rubric.quarterlyEvent;
      const examples = q.examples.join(', ');
      html += `<p>${q.template
        .replace('{periodMonths}', q.periodMonths)
        .replace('{examples}', examples)
        .replace(/{topHolders}/g, q.topHolders)}</p>`;

      // rules list
      html += `<ul>`;
      for (const rule of rubric.rules) {
        // inject points and any “per” text
        let line = rule.template
          .replace(/{points}/g, rule.points)
          .replace(/{per}/g, rule.per || '');
        html += `<li>${line}</li>`;
      }
      html += `</ul>`;

      // render into the new container
      const infoContent = document.getElementById('info-content');
      infoContent.innerHTML = html;

      // show the modal
      infoModal.classList.add('visible');
    });

    infoClose.addEventListener('click', () => {
      infoModal.classList.remove('visible');
      if (childrenContainer.classList.contains('visible')) startCollapseTimer();
    });
    // ────────────────────────────────────────────────────────────────


    const isMe = profileDocId === me;

    if (isMe) {
      btnTransfer.style.display = 'none';
    }

    // grab the wrappers for each section
    const vibeField = vibeSimilarityEl.closest('.profile-field');
    const topMatchesField = document.getElementById('top-matches')
      .closest('.profile-field');

    // hide/show appropriately
    if (isMe) {
      // you’re on your own page → hide Vibe Similarity, show Most Similar Strangers
      vibeField.style.display = 'none';
      topMatchesField.style.display = '';
    } else {
      // you’re on someone else’s page → show Vibe Similarity, hide Most Similar Strangers
      vibeField.style.display = '';
      topMatchesField.style.display = 'none';
    }

    // populate name / instagram
    originalName = data.name || '';
    originalInsta = data.instagramHandle || '';
    nameView.innerText = originalName;
    nameInput.value = originalName;
    instaView.innerText = originalInsta.replace('@', '');
    instaInput.value = originalInsta.replace('@', '');
    instagramLink.href =
      `instagram://user?username=${originalInsta.replace('@', '')}`;

    // header & profile image
    // header & profile image
    hdrTitle.innerText = `${originalName}`;

    if (data.profilePic) {
      // 1) Try the raw Storage download URL first
      profileImg.src = data.profilePic;

      // 2) If that fails (invalid URL or network error), fall back to Drive thumbnail
      profileImg.onerror = () => {
        profileImg.onerror = null;  // prevent infinite loop
        profileImg.src = `/api/drive/thumb?id=${data.profilePic}&sz=128`;
      };
    } else {
      // 3) No profilePic at all → use default avatar
      profileImg.src = '../assets/defaultpfp.png';
    }

    // hide edit if not your own
    if (!isMe) editBtn.style.display = 'none';

    // compute vibe similarity when viewing another user
    if (!isMe && vibeSimilarityEl) {
      const meSnap = await db.collection('members').doc(me).get();
      const meVibes = meSnap.data()?.vibes || {};
      const otherVibes = data.vibes || {};
      const pct = computeVibeSimilarity(meVibes, otherVibes)
        .toFixed(1);
      vibeSimilarityEl.innerText = `${pct}%`;
      // Load Venn diagram with the similarity percentage
      const vennFrame = document.getElementById('vibe-venn');
      if (vennFrame) {
        vennFrame.src = `./venn.html?pct=${pct}`;
        vennFrame.style.display = '';  // reveal the iframe now that src is set
      }

    } else if (vibeSimilarityEl) {
      vibeSimilarityEl.innerText = '—';
    }

    // inside auth.onAuthStateChanged, after you determine `isMe`…
    if (isMe) {
      // fetch your vibes
      const meSnap = await db.collection('members').doc(me).get();
      const meVibes = meSnap.data()?.vibes || {};

      // ——————— NEW: check if you’ve answered >=11 questions ———————
      const nonZeroCount = Object.values(meVibes)
        .filter(val => parseFloat(val) !== 0)
        .length;

      if (nonZeroCount < 11) {
        // hide the matches wrapper (optional)
        const topField = document.getElementById('top-matches')
          .closest('.profile-field');
        if (topField) topField.style.display = 'block';

        // clear out any old content
        const container = document.getElementById('top-matches');
        container.innerHTML = '';

        // create & insert the button
        const btn = document.createElement('button');
        btn.textContent = 'Enter your vibes to view';
        btn.className = 'w-button';             // or your own button class
        btn.onclick = () => {
          window.location.href = '../vibes.html'; // adjust to your vibe-entry route
        };
        container.appendChild(btn);

        // stop here—don’t render the match cards
        return;
      }
      // ————————————————————————————————————————————————————————

      // load everyone else
      const allSnap = await db.collection('members').get();
      const scores = allSnap.docs
        .filter(d => d.id !== me && d.data().vibes)
        .map(d => ({
          name: d.data().name,
          phone: d.id,
          name: d.data().name,
          profilePic: d.data().profilePic || null,
          profileId: d.data().profileId || null,
          score: computeVibeSimilarity(meVibes, d.data().vibes)
        }));

      // sort & take top 5
      scores.sort((a, b) => b.score - a.score);
      const top5 = scores.slice(0, 5);

      // render as horizontal cards
      const container = document.getElementById('top-matches');
      container.innerHTML = '';  // clear “Loading…”
      top5.forEach(u => {
        const card = document.createElement('div');
        card.className = 'match-card';

        const img = document.createElement('img');
        img.className = 'match-pic';
        img.src = u.profilePic
          ? `/api/drive/thumb?id=${u.profilePic}&sz=64`
          : '../assets/defaultpfp.png';
        img.onerror = () => {
          img.onerror = null;
          img.src = '../assets/defaultpfp.png';
        };

        const label = document.createElement('div');
        label.className = 'match-name';
        label.textContent = u.name;

        card.appendChild(img);
        card.appendChild(label);
        card.addEventListener('click', async () => {
          let pid = u.profileId;
          if (!pid) {
            // no profileId yet: generate one and save it
            pid = await generateProfileId(u.phone);
            await db.collection('members')
              .doc(u.phone)
              .update({ profileId: pid });
          }
          // now redirect
          window.location.href = `/profile?id=${pid}`;
        });

        container.appendChild(card);
      });
    }





    // mark inputs dirty on change
    [nameInput, instaInput, pinInput, confirmPin]
      .forEach(el => {
        el.addEventListener('input', () => {
          dirty = true;
          if ((el === pinInput || el === confirmPin) &&
            confirmPin.value &&
            pinInput.value !== confirmPin.value) {
            pwError.style.display = 'block';
          } else {
            pwError.style.display = 'none';
          }
        });
      });
  });

  // warn before unload if unsaved
  window.addEventListener('beforeunload', e => {
    if (dirty && !saved) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  backArrow.addEventListener('click', e => {
    if (dirty && !saved &&
      !confirm('You have unsaved changes. Leave anyway?')) {
      e.preventDefault();
    }
  });

  // toggle editing state
  editBtn.onclick = () => {
    dirty = false; saved = false;
    appEl.classList.add('editing');
  };
  cancelBtn.onclick = () => {
    nameInput.value = originalName;
    instaInput.value = originalInsta;
    pinInput.value = '';
    confirmPin.value = '';
    pwError.style.display = 'none';
    dirty = false;
    appEl.classList.remove('editing');
  };

  // Croppie-based upload flow
  changePicBtn.onclick = () => imgInput.click();
  imgInput.onchange = () => {
    const f = imgInput.files[0];
    if (!f) return;
    if (window.cropper) window.cropper.destroy();
    window.cropper = new Croppie(cropContainer, {
      viewport: { width: 300, height: 300, type: 'square' },
      boundary: { width: 300, height: 300 }
    });
    const reader = new FileReader();
    reader.onload = () => window.cropper.bind({ url: reader.result });
    reader.readAsDataURL(f);
    cropOverlay.style.display = 'flex';
  };
  cropCancel.onclick = () => {
    cropOverlay.style.display = 'none';
    if (window.cropper) window.cropper.destroy();
    window.cropper = null;
    imgInput.value = '';
  };
  cropConfirm.onclick = async () => {
    if (!window.cropper) return;
    const blob = await window.cropper.result('blob');
    // tear down the crop UI
    cropOverlay.style.display = 'none';
    window.cropper.destroy();
    window.cropper = null;

    // 1) Upload to Firebase Storage under "pfps/<profileDocId>_<timestamp>"
    const timestamp = Date.now();
    const filePath  = `pfps/${profileDocId}_${timestamp}.jpg`;  // or .png
    const storageRef = firebase.storage().ref(filePath);
    let snapshot;
    try {
      snapshot = await storageRef.put(blob);
    } catch (err) {
      console.error('Storage upload failed:', err);
      return alert('Upload failed');
    }

    // 2) Get the public download URL
    let downloadURL;
    try {
      downloadURL = await snapshot.ref.getDownloadURL();
    } catch (err) {
      console.error('Getting download URL failed:', err);
      return alert('Could not retrieve image URL');
    }

    // 3) Write to Firestore (award points if still under weekly cap)
    const memberRef = db.collection('members').doc(profileDocId);
    try {
      await db.runTransaction(async tx => {
        const userDoc = await tx.get(memberRef);
        if (!userDoc.exists) throw new Error('User doc not found');

        const data = userDoc.data();
        const uploads     = data.profileImageUploads || [];
        const weekAgo     = Date.now() - 7*24*60*60*1000;
        const recent      = uploads.filter(ts => ts.toMillis() > weekAgo);
        const eligible    = recent.length < 2;
        const newUploads  = [...recent, firebase.firestore.Timestamp.fromMillis(timestamp)];

        const updateData = {
          profilePic: downloadURL,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
          profileImageUploads: newUploads
        };
        if (eligible) {
          updateData.sPoints = firebase.firestore.FieldValue.increment(75);
        }
        tx.update(memberRef, updateData);
      });
    } catch (err) {
      console.error('Firestore transaction failed:', err);
      alert('Error saving your profile picture.');
      return;
    }

    // 4) Reflect it immediately in the UI
    profileImg.src = downloadURL;
    alert('Profile picture updated!');
  };


  saveBtn.onclick = async e => {
    e.preventDefault();
    const me = localStorage.getItem('userPhone');
    if (profileDocId !== me) return;

    const pw = pinInput.value.trim();
    if (pw) {
      if (pw.length < 6 || !/[A-Z]/.test(pw)) {
        return alert(
          'Password must be ≥6 chars and include at least one uppercase letter.'
        );
      }
      if (pw !== confirmPin.value.trim()) {
        return alert('Passwords do not match.');
      }
    }

    const updates = {};
    const newName = nameInput.value.trim();
    if (newName && newName !== originalName) {
      updates.ogname = originalName;
      updates.name = newName;
    }
    updates.instagramHandle = instaInput.value.trim();
    if (pw) updates.pin = await hashHex(pw);

    try {
      await db.collection('members')
        .doc(profileDocId)
        .update(updates);
      saved = true;
      dirty = false;
      appEl.classList.remove('editing');
      originalName = nameView.innerText =
        updates.name || originalName;
      originalInsta = instaView.innerText =
        updates.instagramHandle || originalInsta;
      hdrTitle.innerText = `Profile: ${originalName}`;
      alert('Profile saved.');
    } catch (err) {
      console.error(err);
      alert('Save failed.');
    }
  };
});
