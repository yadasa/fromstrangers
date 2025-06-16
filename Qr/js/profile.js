// js/profile.js
import { computeVibeSimilarity } from './vibeSimilarity.js';

document.addEventListener('DOMContentLoaded', () => {
  if (!window.firebaseConfig) throw new Error('Missing firebaseConfig.js');
  firebase.initializeApp(window.firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  // Your profile‐only Drive folder ID
  const PROFILE_DRIVE_FOLDER_ID = '1zmOhvhrskbhtnot2RD86MNU__6bmuxo2';

  const appEl       = document.getElementById('profile-app');
  const hdrTitle    = document.getElementById('header-title');
  const backArrow   = document.getElementById('back-arrow');

  const profileImg   = document.getElementById('profile-img');
  const changePicBtn = document.getElementById('change-pic');
  const imgInput     = document.getElementById('img-input');

  const nameView   = document.getElementById('name-view');
  const nameInput  = document.getElementById('name-input');
  const instaView  = document.getElementById('insta-view');
  const instaInput = document.getElementById('insta-input');

  const pinInput     = document.getElementById('pin-input');
  const confirmPin   = document.getElementById('confirm-pin-input');
  const pwError      = document.getElementById('pw-error');

  const editBtn   = document.getElementById('edit-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const saveBtn   = document.getElementById('save-btn');

  const cropOverlay   = document.getElementById('crop-overlay');
  const cropContainer = document.getElementById('crop-container');
  const cropConfirm   = document.getElementById('crop-confirm');
  const cropCancel    = document.getElementById('crop-cancel');

  const instagramLink     = document.getElementById('instagram-link');
  const vibeSimilarityEl  = document.getElementById('vibe-similarity');

  let profileDocId = null;
  let originalName = '', originalInsta = '';
  let dirty = false, saved = false;

  async function hashHex(str) {
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(str)
    );
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2,'0'))
      .join('');
  }

  async function generateProfileId(phone) {
    const rev = phone.split('').reverse();
    let noise = '';
    for (const d of rev) {
      noise += d + Math.floor(Math.random()*100).toString().padStart(2,'0');
    }
    const prefix = Math.floor(Math.random()*10000)
                     .toString().padStart(4,'0');
    const suffix = Math.floor(Math.random()*10000)
                     .toString().padStart(4,'0');
    return await hashHex(prefix + noise + suffix);
  }

  function getProfileId() {
    return new URLSearchParams(location.search).get('id');
  }

  auth.onAuthStateChanged(async user => {
    if (!user) return location.replace('../index.html');
    const me = localStorage.getItem('userPhone');
    if (!me) return location.replace('../index.html');

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
                       .where('profileId','==',pid)
                       .get();
    if (qs.empty) return alert('Profile not found');
    const doc  = qs.docs[0];
    profileDocId = doc.id;
    const data   = doc.data();
    const isMe   = profileDocId === me;

    // grab the wrappers for each section
    const vibeField       = vibeSimilarityEl.closest('.profile-field');
    const topMatchesField = document.getElementById('top-matches')
                                  .closest('.profile-field');

    // hide/show appropriately
    if (isMe) {
      // you’re on your own page → hide Vibe Similarity, show Most Similar Strangers
      vibeField.style.display       = 'none';
      topMatchesField.style.display = '';
    } else {
      // you’re on someone else’s page → show Vibe Similarity, hide Most Similar Strangers
      vibeField.style.display       = '';
      topMatchesField.style.display = 'none';
    }

    // populate name / instagram
    originalName  = data.name || '';
    originalInsta = data.instagramHandle || '';
    nameView.innerText   = originalName;
    nameInput.value      = originalName;
    instaView.innerText  = originalInsta.replace('@','');
    instaInput.value     = originalInsta.replace('@','');
    instagramLink.href   =
      `instagram://user?username=${originalInsta.replace('@','')}`;

    // header & profile image
    hdrTitle.innerText = `Profile: ${originalName}`;
    profileImg.src = data.profilePic
      ? `/api/drive/thumb?id=${data.profilePic}&sz=128`
      : '../assets/defaultpfp.png';
    // hide edit if not your own
    if (!isMe) editBtn.style.display = 'none';

    // compute vibe similarity when viewing another user
    if (!isMe && vibeSimilarityEl) {
      const meSnap       = await db.collection('members').doc(me).get();
      const meVibes      = meSnap.data()?.vibes || {};
      const otherVibes   = data.vibes || {};
      const pct = computeVibeSimilarity(meVibes, otherVibes)
                    .toFixed(1);
      vibeSimilarityEl.innerText = `${pct}%`;
    } else if (vibeSimilarityEl) {
      vibeSimilarityEl.innerText = '—';
    }

    // inside auth.onAuthStateChanged, after you determine `isMe`…
    if (isMe) {
      // fetch your vibes
      const meSnap  = await db.collection('members').doc(me).get();
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
      const scores  = allSnap.docs
        .filter(d => d.id !== me && d.data().vibes)
        .map(d => ({
          name:       d.data().name,
          phone:      d.id, 
          name:       d.data().name,
          profilePic: d.data().profilePic || null,
          profileId:  d.data().profileId  || null,
          score:      computeVibeSimilarity(meVibes, d.data().vibes)
        }));

      // sort & take top 5
      scores.sort((a,b) => b.score - a.score);
      const top5 = scores.slice(0,5);

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
          if ((el===pinInput || el===confirmPin) &&
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
    nameInput.value      = originalName;
    instaInput.value     = originalInsta;
    pinInput.value       = '';
    confirmPin.value     = '';
    pwError.style.display= 'none';
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
      viewport: { width:512, height:512, type:'square' },
      boundary: { width:333, height:333 }
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
    cropOverlay.style.display = 'none';
    window.cropper.destroy();
    window.cropper = null;

    const fd = new FormData();
    fd.append('owner',     localStorage.getItem('userPhone'));
    fd.append('ownerName', nameInput.value);
    fd.append('file',      blob);
    fd.append('folderId',  PROFILE_DRIVE_FOLDER_ID);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/drive/uploadpfp');
    xhr.onload = async () => {
      if (xhr.status !== 200) {
        console.error('Upload failed:', xhr.responseText);
        return alert('Upload failed');
      }
      const res = JSON.parse(xhr.responseText);

      const memberRef = db.collection('members').doc(profileDocId);
      try {
        await db.runTransaction(async tx => {
          const udoc = await tx.get(memberRef);
          if (!udoc.exists) throw new Error('User doc not found');
          const udata = udoc.data();
          const now = new Date();
          const weekAgo = new Date(now - 7*24*60*60*1000);
          const uploads = udata.profileImageUploads || [];
          const recent  = uploads.filter(ts => ts.toDate() > weekAgo);
          const eligible = recent.length < 2;

          const updateData = {
            profilePic: res.id,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            profileImageUploads: [...recent, ...(eligible ? [now] : [])]
          };
          if (eligible) {
            updateData.sPoints =
              firebase.firestore.FieldValue.increment(75);
          }
          tx.update(memberRef, updateData);
        });

        // create hidden photo record
        await db.collection('photos')
                .doc(res.id)
                .set({ visibility:false }, { merge:true });

        profileImg.src = `/api/drive/thumb?id=${res.id}&sz=512`;
        alert('Profile picture updated!');
      } catch (err) {
        console.error('Transaction failed:', err);
        alert('Error updating profile picture.');
      }
    };
    xhr.send(fd);



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
      updates.name   = newName;
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
      originalName  = nameView.innerText  =
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
