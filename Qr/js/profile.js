// /js/profile.js
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

  const instagramLink = document.getElementById('instagram-link');

  let profileDocId = null, originalName = '', originalInsta = '';
  let dirty = false, saved = false;

  async function hashHex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2,'0')).join('');
  }

  async function generateProfileId(phone) {
    const rev = phone.split('').reverse();
    let noise = '';
    for (const d of rev) {
      noise += d + Math.floor(Math.random()*100).toString().padStart(2,'0');
    }
    const prefix = Math.floor(Math.random()*10000).toString().padStart(4,'0');
    const suffix = Math.floor(Math.random()*10000).toString().padStart(4,'0');
    return await hashHex(prefix + noise + suffix);
  }

  function getProfileId() {
    return new URLSearchParams(location.search).get('id');
  }

  auth.onAuthStateChanged(async user => {
    if (!user) return location.replace('../index.html');
    const me = localStorage.getItem('userPhone');
    if (!me) return location.replace('../index.html');

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

    const qs = await db.collection('members').where('profileId','==',pid).get();
    if (qs.empty) return alert('Profile not found');
    const doc = qs.docs[0];
    profileDocId = doc.id;
    const data = doc.data();

    originalName    = data.name || '';
    originalInsta   = data.instagramHandle || '';
    nameView.innerText  = originalName;
    nameInput.value     = originalName;
    instaView.innerText = originalInsta;
    instaInput.value    = originalInsta;

    // Add this line
    instagramLink.href = `https://instagram.com/${originalInsta.replace('@', '')}`;

    hdrTitle.innerText = `Profile: ${originalName}`;
    profileImg.src     = data.profilePic
      ? `/api/drive/thumb?id=${data.profilePic}&sz=128`
      : '../assets/defaultpfp.png';

    if (profileDocId !== me) editBtn.style.display = 'none';

    [nameInput, instaInput, pinInput, confirmPin].forEach(el => {
      el.addEventListener('input', () => {
        dirty = true;
        if (el === pinInput || el === confirmPin) {
          pwError.style.display = (confirmPin.value && pinInput.value !== confirmPin.value)
            ? 'block' : 'none';
        }
      });
    });
  });

  window.addEventListener('beforeunload', e => {
    if (dirty && !saved) { e.preventDefault(); e.returnValue = ''; }
  });
  backArrow.addEventListener('click', e => {
    if (dirty && !saved && !confirm('You have unsaved changes. Leave anyway?')) {
      e.preventDefault();
    }
  });

  editBtn.onclick = () => {
    dirty = false; saved = false;
    appEl.classList.add('editing');
  };

  cancelBtn.onclick = () => {
    nameInput.value  = originalName;
    instaInput.value = originalInsta;
    pinInput.value   = '';
    confirmPin.value = '';
    pwError.style.display = 'none';
    dirty = false;
    appEl.classList.remove('editing');
  };

  // Cropping + upload
  changePicBtn.onclick = () => imgInput.click();
  imgInput.onchange = () => {
    const f = imgInput.files[0];
    if (!f) return;
    if (window.cropper) cropper.destroy();
    window.cropper = new Croppie(cropContainer,{
      viewport:{width:128,height:128,type:'square'},
      boundary:{width:300,height:300}
    });
    const r = new FileReader();
    r.onload = () => cropper.bind({url: r.result});
    r.readAsDataURL(f);
    cropOverlay.style.display = 'flex';
  };
  cropCancel.onclick = () => {
    cropOverlay.style.display = 'none';
    cropper.destroy(); cropper = null;
    imgInput.value = '';
  };
  cropConfirm.onclick = async () => {
    if (!cropper) return;
    const blob = await cropper.result('blob');
    cropOverlay.style.display = 'none';
    cropper.destroy(); cropper = null;

    // build FormData with folderId override
    const fd = new FormData();
    fd.append('owner', localStorage.getItem('userPhone'));
    fd.append('ownerName', nameInput.value);
    fd.append('file', blob);
    fd.append('folderId', PROFILE_DRIVE_FOLDER_ID);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/drive/upload');
    xhr.onload = async () => {
      if (xhr.status !== 200) {
        console.error('Upload failed:', xhr.responseText);
        return alert('Upload failed');
      }
      const res = JSON.parse(xhr.responseText);

      // 1) update member record with new profilePic
      await db.collection('members').doc(profileDocId)
              .update({ profilePic: res.id });

      // 2) create a Firestore doc for this file with visibility=false
      await db.collection('photos').doc(res.id).set({
        visibility: false
      }, { merge: true });

      // 3) update the UI
      profileImg.src = `/api/drive/thumb?id=${res.id}&sz=128`;
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
        return alert('Password must be ≥6 characters and include 1 uppercase letter.');
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
      await db.collection('members').doc(profileDocId).update(updates);
      saved = true; dirty = false;
      appEl.classList.remove('editing');
      originalName  = nameView.innerText  = updates.name || originalName;
      originalInsta = instaView.innerText = updates.instagramHandle || originalInsta;
      hdrTitle.innerText = `Profile: ${originalName}`;
      alert('Profile saved.');
    } catch (err) {
      console.error(err);
      alert('Save failed.');
    }
  };
});
