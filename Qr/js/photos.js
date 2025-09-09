// js/photos.js


// 1) Initialize Firebase -----------------------------------------------------
if (!window.firebaseConfig) throw new Error("Missing firebaseConfig.js");
firebase.initializeApp(window.firebaseConfig);
const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();

// ── 0a) Helpers to persist phone & name locally ───────────────────────────
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

let isAdminUser = false;

function canDeletePhoto(itemOrOwnerPhone) {
  const owner = typeof itemOrOwnerPhone === 'string'
    ? itemOrOwnerPhone
    : itemOrOwnerPhone.ownerPhone;
  return owner === userPhone || isAdminUser === true;
}


const PAGE_SIZE = 30;
let lastDoc = null;

// 2) DOM refs ---------------------------------------------------------------
const overlay           = document.getElementById('phone-entry');
const inpPhone          = document.getElementById('phone-input');
const btnPhone          = document.getElementById('phone-submit');
const otpEntryDiv       = document.getElementById('otp-entry');
const inpOtp            = document.getElementById('otp-input');
const btnVerifyOtp      = document.getElementById('otp-submit');
const appDiv            = document.getElementById('photos-app');
const userInfoEl        = document.getElementById('user-info-photos');
const pointsInfoEl      = document.getElementById('points-info');

const btnUpload         = document.getElementById('btn-upload');
const btnSelect         = document.getElementById('btn-select');
const btnShare          = document.getElementById('btn-share');
const btnDelete         = document.getElementById('btn-delete-multi');

const fileInput         = document.getElementById('file-input');
const gallery           = document.getElementById('gallery');

const controlsDiv       = document.getElementById('controls-photos');
const btnLoadMore       = document.getElementById('btn-load-more');
const loadMoreContainer = document.getElementById('load-more-container');
const modalOverlay      = document.getElementById('modal-overlay');
const modalContent      = document.getElementById('modal-content');
const modalImage        = document.getElementById('modal-image');
const modalVideo        = document.getElementById('modal-video');
const modalClose        = document.getElementById('modal-close');
const modalDownload     = document.getElementById('modal-download');
const modalLoading      = document.getElementById('modal-loading-overlay');
const pointsOverlay     = document.getElementById('points-overlay');
const pointsClose       = document.getElementById('points-close');

let userPhone            = loadPhone() || '';
let userName             = '';
let userPoints           = 0;
let uploadPointsToday    = 0, lastUploadDate = '';
let commentPointsToday   = 0, lastCommentDate = '';
let nextPageToken        = null;
let autoTriggered        = false;

let selectMode           = false;
let selectedItems        = new Set();

// 3) Invisible reCAPTCHA helper ---------------------------------------------
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
        console.warn('reCAPTCHA expired; reinitializing');
        initRecaptcha();
      }
    }
  );

  // Render the widget and wait for it to be ready, then immediately verify
  await window.recaptchaVerifier.render();
  await window.recaptchaVerifier.verify();
}

// 4) On load: either resume session or show phone-entry overlay ---------------
window.addEventListener('DOMContentLoaded', async () => {
  
    // 4.0) Optimistically restore UI from cache:
    const cachedPhone = loadPhone();
    const cachedName  = loadName();
    if (cachedPhone) {
      overlay.style.display = 'none';
      appDiv.style.display  = 'block';
      userInfoEl.innerText  = `Logged in as ${cachedName}`;
      // background refresh of full profile & points
      fetchUserNameAndShow(cachedPhone);
    } else {
      overlay.style.display     = 'flex';
      otpEntryDiv.style.display = 'none';
    }

    // immediately kick off the gallery load:
    loadGallery();
  
    // 4.1) Fire-and-forget: persist session locally
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .catch(err => console.warn('Couldn’t set persistence:', err));
  
    // 4.2) Fire-and-forget: render invisible reCAPTCHA
    initRecaptcha().catch(console.error);
  
    // 4.3) React to full Firebase Auth state
    auth.onAuthStateChanged(async user => {
      if (!user) {
        // session expired → roll back to login
        localStorage.removeItem('userPhone');
        localStorage.removeItem('userName');
        overlay.style.display     = 'flex';
        appDiv.style.display      = 'none';
        return;
      }
      // valid session → fetch membership, persist & update UI
      const phone = user.phoneNumber.replace('1','');
      const snap  = await db.collection('members').doc(phone).get();
      const name  = snap.exists ? (snap.data().name||'') : '';
      savePhone(phone);
      saveName(name);
      overlay.style.display     = 'none';
      otpEntryDiv.style.display = 'none';
      appDiv.style.display      = 'block';
      userInfoEl.innerText      = `Logged in as ${name}`;
      // re-load full profile (points, gallery, etc)
      await fetchUserNameAndShow(phone);
    });

  btnShare.style.display  = 'none';
  btnDelete.style.display = 'none';

  window.addEventListener('scroll', () => { autoTriggered = true; });
  if (btnLoadMore) {
    btnLoadMore.onclick = () => {
      autoTriggered = true;
      loadMore();
    };
  }

  // helper to close both image *and* video
  function closeModal() {
    modalOverlay.style.display = 'none';
    modalLoading.style.display = 'none';
    modalVideo.pause?.();     // stop the video if it’s playing
    modalImage.src   = '';    // clear out the old src
    modalVideo.src   = '';    // clear out the old src
  }

  // — X BUTTON —
  modalClose.addEventListener('click', e => {
    e.preventDefault();
    closeModal();
  });

  // — CLICK ON BACKDROP —
  modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeModal();
  });

  //  — PREVENT CLICK INSIDE CONTENT FROM BUBBLING UP —
  modalContent.addEventListener('click', e => {
    e.stopPropagation();
  });


  // 8) Upload logic -----------------------------------------------------------
btnUpload.onclick = () => fileInput.click();
fileInput.onchange = () => uploadFiles(fileInput.files);



});

// 5) Phone submission -------------------------------------------------------
btnPhone.onclick = async () => {
  let raw = inpPhone.value.replace(/\D/g, '');
  if (raw.length === 11 && raw.startsWith('1')) raw = raw.slice(1);
  if (raw.length !== 10) {
    return alert('Enter a valid 10-digit phone.');
  }

  // Initialize & await fresh reCAPTCHA token
  try {
    await initRecaptcha();
  } catch (err) {
    console.error('Failed to set up reCAPTCHA:', err);
    return alert('reCAPTCHA setup failed. Please reload and try again.');
  }

  // Send SMS via Firebase
  try {
    const confirmation = await auth.signInWithPhoneNumber(
      '+1' + raw,
      window.recaptchaVerifier
    );
    window.confirmationResult = confirmation;
    otpEntryDiv.style.display = 'block';
  } catch (err) {
    console.error('signInWithPhoneNumber error:', err);
    if (err.code === 'auth/invalid-app-credential') {
      alert('reCAPTCHA token invalid/expired; please try again.');
    } else {
      alert('SMS not sent: ' + err.message);
    }
  }
};

// 6) OTP verification -------------------------------------------------------
btnVerifyOtp.onclick = async () => {
  const code = inpOtp.value.trim();
  if (code.length !== 6) return alert('Enter the 6-digit code.');
  try {
    const cred = await window.confirmationResult.confirm(code);
    const user = cred.user;
    userPhone = user.phoneNumber.replace('+1','');
    savePhone(userPhone);
    userName = data.name || data.Name || 'No Name';
    saveName(userName);

    // Fetch Firestore membership
    const snap = await db.collection('members').doc(userPhone).get();
    if (!snap.exists) {
      alert('No membership record found. Please sign up first.');
      return;
    }
    const data = snap.data();
    isAdminUser = data.isAdmin === true;
    if (!data.onList) {
      alert('Your membership is not approved for this feature.');
      return;
    }
    // Store user data locally
    userName            = data.name || data.Name || 'No Name';
    userPoints          = data.sPoints || 0;
    uploadPointsToday   = data.uploadPointsToday || 0;
    lastUploadDate      = data.lastUploadPointsDate || '';
    commentPointsToday  = data.commentPointsToday || 0;
    lastCommentDate     = data.lastCommentPointsDate || '';

    overlay.style.display = 'none';
    otpEntryDiv.style.display = 'none';
    appDiv.style.display  = 'block';
    userInfoEl.innerText  = `Logged in as ${userName}`;
    pointsInfoEl.innerHTML = `<span id="points-value">${userPoints}</span> sPoints – <a id="points-info-link" href="#">info</a>`;
    pointsInfoEl.style.display = 'block';
    document.getElementById('points-info-link').onclick = e => {
      e.preventDefault();
      pointsOverlay.style.display = 'flex';
    };

    
  } catch (err) {
    console.error('OTP confirm error:', err);
    alert('Code incorrect: ' + err.message);
  }
};

// 7) Fetch user name and show app (when resuming session) -------------------
async function fetchUserNameAndShow(phone) {
  const snap = await db.collection('members').doc(phone).get();
  if (!snap.exists) {
    // If somehow record is missing, clear and show overlay again
    localStorage.removeItem('userPhone');
    overlay.style.display = 'flex';
    return;
  }
  const data = snap.data();
  isAdminUser         = data.isAdmin === true;
  userName            = data.name || data.Name || 'No Name';
  userPoints          = data.sPoints || 0;
  uploadPointsToday   = data.uploadPointsToday || 0;
  lastUploadDate      = data.lastUploadPointsDate || '';
  commentPointsToday  = data.commentPointsToday || 0;
  lastCommentDate     = data.lastCommentPointsDate || '';

  overlay.style.display = 'none';
  appDiv.style.display  = 'block';
  userInfoEl.innerText  = `Logged in as ${userName}`;
  pointsInfoEl.innerHTML = `<span id="points-value">${userPoints}</span> sPoints – <a id="points-info-link" href="#">info</a>`;
  pointsInfoEl.style.display = 'block';
  document.getElementById('points-info-link').onclick = e => {
    e.preventDefault();
    pointsOverlay.style.display = 'flex';
  };

  
}



async function uploadFiles(files) {
  for (const file of files) {
    // 1) Create placeholder card
    const card = document.createElement('div');
    card.className = 'photo-card new-upload';
    if (selectMode) card.classList.add('select-mode');

    const isVideo = file.type.startsWith('video/');
    if (isVideo) card.classList.add('video');

    // 2) Thumbnail preview or play icon
    let imgEl = null;
    if (!isVideo) {
      imgEl = document.createElement('img');
      imgEl.src = URL.createObjectURL(file);
      imgEl.alt = file.name;
      card.append(imgEl);
    } else {
      const playIcon = document.createElement('div');
      playIcon.className = 'play-icon';
      playIcon.innerText = '▶';
      card.append(playIcon);
    }

    // 3) Caption overlay
    const cap = document.createElement('div');
    cap.className = 'photo-caption';
    cap.appendChild(document.createElement('div')).innerText = new Date().toLocaleDateString();
    cap.appendChild(document.createElement('div')).innerText = `From ${userName}`;
    card.append(cap);

    // 4) Progress bar
    const progressBar = document.createElement('div');
    progressBar.className = 'upload-progress';
    card.append(progressBar);

    // 5) Insert into gallery
    gallery.prepend(card);
    requestAnimationFrame(() => card.classList.add('slide-in'));

    // 6) Upload to Firebase Storage
    const fileId = db.collection('photos').doc().id;
    const storageRef = storage.ref(`photos/${fileId}`);
    const uploadTask = storageRef.put(file);

    // 7) Wire up progress updates
    uploadTask.on('state_changed',
      snapshot => {
        if (snapshot.totalBytes) {
          const pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          progressBar.style.width = pct + '%';
        }
      },
      error => {
        console.error('Upload failed', error);
        alert(`Upload failed for file: ${file.name}`);
        card.remove();
      }
    );

    // 8) Await completion & get download URL
    let downloadURL;
    try {
      await uploadTask;
      downloadURL = await storageRef.getDownloadURL();
    } catch {
      // error already handled above
      continue;
    }

    // 9) Write metadata to Firestore
    const meta = {
      name:         file.name,
      url:          downloadURL,
      thumbnailLink: '', // Cloud Function will fill this
      ownerPhone:   userPhone,
      ownerName:    userName,
      timestamp:    firebase.firestore.FieldValue.serverTimestamp(),
      deleted:      false
    };
    try {
      await db.collection('photos').doc(fileId).set(meta);
    } catch (e) {
      console.error('Failed to save metadata', e);
    }

    // 10) Award upload points
    try {
      await updatePoints('upload');
    } catch (e) {
      console.error('Failed to update points', e);
    }

    // 11) Hide progress bar
    progressBar.style.display = 'none';

    // 12) Hook up showMedia on click
    const mediaData = { id: fileId, ...meta };
    if (!isVideo && imgEl) {
      imgEl.onclick = () => { if (!selectMode) showMedia(mediaData); };
    }
    if (isVideo) {
      // once your Cloud Function populates thumbnailUrl,
      // you can replace the playIcon with an <img> here
    }

    // 13) Like button (same logic, now using Firestore)
    const likeBtn = document.createElement('button');
    likeBtn.className = 'photo-like-btn';
    likeBtn.innerText = '♡';
    likeBtn.onclick = async () => {
      const likesCol = db.collection('photos').doc(fileId).collection('likes');
      if (likeBtn.dataset.liked === 'true') {
        await likesCol.doc(userPhone).delete();
        likeBtn.dataset.liked = 'false';
        updatePoints('like', -1);
      } else {
        await likesCol.doc(userPhone).set({ liked: true });
        likeBtn.dataset.liked = 'true';
        updatePoints('like', 1);
      }
      // update count display
      const snap = await likesCol.get();
      const count = snap.size;
      likeBtn.textContent = count > 0 ? `♥ ${count}` : '♥';
      likeBtn.classList.toggle('liked', likeBtn.dataset.liked === 'true');
    };
    // initialize count & state
    db.collection('photos').doc(fileId).collection('likes').get().then(snap => {
      const count = snap.size;
      const liked = snap.docs.some(doc => doc.id === userPhone);
      likeBtn.textContent = count > 0 ? `♥ ${count}` : '♥';
      likeBtn.dataset.liked = liked.toString();
      likeBtn.classList.toggle('liked', liked);
    });
    card.append(likeBtn);

    // 14) Delete button (Firestore flag instead of Drive move)
    if (canDeletePhoto(meta)) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'photo-delete-icon';
      // use × (times) rather than text
      delBtn.innerHTML = '&times;';

      // inline styles for quick positioning—feel free to move these into your CSS
      Object.assign(delBtn.style, {
        position:   'absolute',
        top:        '8px',
        right:      '8px',
        zIndex:     '100',
        background: 'transparent',
        border:     'none',
        fontSize:   '18px',
        lineHeight: '1',
        cursor:     'pointer',
      });

      delBtn.onclick = async () => {
        await db.collection('photos').doc(fileId).update({ deleted: true });
        card.style.display = 'none';
      };
      card.append(delBtn);
    }

    // 15) Multi-select checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'photo-checkbox';
    cb.onchange = e => {
      if (e.target.checked) {
        selectedItems.add(mediaData);
        card.classList.add('selected');
      } else {
        // remove by matching id
        for (let itm of selectedItems) {
          if (itm.id === fileId) selectedItems.delete(itm);
        }
        card.classList.remove('selected');
      }
      btnShare.disabled = selectedItems.size === 0;
      const canDelete = [...selectedItems].every(it => canDeletePhoto(it));
      btnDelete.disabled = !canDelete || selectedItems.size === 0;
    };
    card.prepend(cb);
  }
}


// --- 9) Fetch & show gallery via Firestore -------------------------------
async function loadGallery(append = false) {
  selectedItems.clear();
  selectMode = false;
  btnShare.disabled  = true;
  btnDelete.disabled = true;

  if (!append) {
    lastDoc = null;
    gallery.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--green);">Loading…</p>';
  }

  // Firestore query instead of Drive API
  let q = db
    .collection('photos')
    .where('deleted', '==', false)
    .orderBy('timestamp', 'desc')
    .limit(PAGE_SIZE);
  if (lastDoc) q = q.startAfter(lastDoc);

  const snap = await q.get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  lastDoc = snap.docs[snap.docs.length - 1] || lastDoc;

  // Show or hide “Load more”
  if (snap.size === PAGE_SIZE) {
    loadMoreContainer.style.display = 'block';
    btnLoadMore.disabled = false;
  } else {
    loadMoreContainer.style.display = 'none';
  }

  await renderGallery(items, append);
}

// renderGallery remains unchanged, but ensure it uses item.ownerPhone or item.appProperties.owner to check ownership, and looks up uploaderName via Firestore when creating captions.

// 10) renderGallery (full, filtering only visibility:false)
async function renderGallery(items, append = false) {
  // 1) filter out any items explicitly hidden
  items = items.filter(item => item.visibility !== false);

  // 2) clear gallery if this is not an append
  if (!append) {
    gallery.innerHTML = '';
  }

  // 3) if no items remain, show “No media yet” then exit
  if (items.length === 0) {
    if (!append) {
      gallery.innerHTML =
        '<p style="grid-column:1/-1;text-align:center;color:var(--green-light);">No media yet</p>';
    }
    return;
  }

  let lastWeekLabel = '';
  let startIndex     = 0;

  // 4) if appending, first fill up to a multiple of 3
  if (append) {
    const existingCount = gallery.querySelectorAll('.photo-card').length;
    const rem           = existingCount % 3;
    if (rem !== 0) {
      const fillCount = 3 - rem;
      if (items.length >= fillCount) {
        const slice      = items.slice(0, fillCount);
        for (const item of slice) {
          // --- week divider ---
          const date   = item.timestamp.toDate();
          const day    = date.getDay();
          const offset = day === 0 ? 6 : day - 1;
          const monday = new Date(date);
          monday.setDate(date.getDate() - offset);
          const weekOf     = monday.toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric'
          });
          const weekLabel = `Week of ${weekOf}`;
          if (weekLabel !== lastWeekLabel) {
            const divider = document.createElement('div');
            divider.className = 'week-divider';
            divider.innerText = weekLabel;
            gallery.append(divider);
            lastWeekLabel = weekLabel;
          }

          // --- build card ---
          const card = document.createElement('div');
          card.className = 'photo-card';
          if (selectMode) card.classList.add('select-mode');

          // checkbox
          const cb = document.createElement('input');
          cb.type      = 'checkbox';
          cb.className = 'photo-checkbox';
          cb.onchange  = e => {
            if (e.target.checked) {
              selectedItems.add(item);
              card.classList.add('selected');
            } else {
              selectedItems.delete(item);
              card.classList.remove('selected');
            }
            btnShare.disabled = selectedItems.size === 0;
            const canDel = Array.from(selectedItems)
              .every(it => canDeletePhoto(it));
            btnDelete.disabled = !canDel || selectedItems.size === 0;
          };
          card.append(cb);

          // detect video
          const isVideo = item.mimeType
            ? item.mimeType.startsWith('video/')
            : /\.(mp4|mov|avi|webm)$/i.test(item.name);
          if (isVideo) card.classList.add('video');

          // thumbnail
          const img = document.createElement('img');
          img.src      = item.thumbnailLink;
          img.decoding = 'async';
          img.alt      = item.name;
          img.onclick  = () => { if (!selectMode) showMedia(item); };
          card.append(img);

          // play icon for video
          if (isVideo) {
            const playIcon = document.createElement('div');
            playIcon.className = 'play-icon';
            playIcon.innerText = '▶';
            card.append(playIcon);
          }

          // caption
          const cap = document.createElement('div');
          cap.className = 'photo-caption';
          cap.appendChild(document.createElement('div'))
             .innerText = date.toLocaleDateString();
          {
            const whoDiv = document.createElement('div');
            whoDiv.innerText = `From ${(item.ownerName || '').trim() || '…'}`;
            cap.appendChild(whoDiv);
            // async resolve & update text if needed
            if (!item.ownerName) {
              resolveOwnerName(item).then(name => {
                whoDiv.innerText = `From ${name || 'Strangers'}`;
              });
            }
          }

          card.append(cap);

          // like button
          const likeBtn = document.createElement('button');
          likeBtn.className = 'photo-like-btn';
          likeBtn.innerText = '♡ 0';
          likeBtn.onclick = async () => {
            const likeRef = db.collection('photos')
                              .doc(item.id)
                              .collection('likes')
                              .doc(userPhone);
            if (likeBtn.dataset.liked === 'true') {
              await likeRef.delete();
              updatePoints('like', -1);
            } else {
              await likeRef.set({ liked: true });
              updatePoints('like', 1);
            }
            const snap = await db.collection('photos')
                                 .doc(item.id)
                                 .collection('likes')
                                 .get();
            const cnt = snap.size;
            likeBtn.textContent = cnt > 0 ? `♥ ${cnt}` : '♥';
            likeBtn.dataset.liked = likeBtn.dataset.liked === 'true' ? 'false' : 'true';
            likeBtn.classList.toggle('liked', likeBtn.dataset.liked === 'true');
          };
          db.collection('photos').doc(item.id)
            .collection('likes').get()
            .then(snap => {
              const cnt   = snap.size;
              const liked = snap.docs.some(d => d.id === userPhone);
              likeBtn.textContent   = cnt > 0 ? `♥ ${cnt}` : '♥';
              likeBtn.dataset.liked = liked ? 'true' : 'false';
              likeBtn.classList.toggle('liked', liked);
            });
          card.append(likeBtn);

          // delete button
          if (canDeletePhoto(item)) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'photo-delete-icon';
            delBtn.innerHTML = '&times;';
            Object.assign(delBtn.style, {
              position:   'absolute',
              top:        '8px',
              right:      '8px',
              zIndex:     '100',
              background: 'transparent',
              border:     'none',
              fontSize:   '18px',
              lineHeight: '1',
              cursor:     'pointer',
            });
            delBtn.onclick = async () => {
              await db.collection('photos').doc(item.id).update({ deleted: true });
              card.style.display = 'none';
            };
            card.append(delBtn);
          }

          // initial animation state
          card.style.transform  = 'scale(0.9)';
          card.style.opacity    = '0';
          card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';

          // wait for image then append & animate
          await new Promise(res => {
            if (img.complete) return res();
            img.onload  = res;
            img.onerror = res;
          });
          gallery.append(card);
          setTimeout(() => {
            card.style.opacity   = '1';
            card.style.transform = 'scale(1)';
          }, 100);
        }

        startIndex = fillCount;
      }
    }
  }

  // 5) main rows of 3
  for (let i = startIndex; i < items.length; i += 3) {
    const slice      = items.slice(i, i + 3);
    const groupCards = [];
    const loadPromises = [];

    for (const item of slice) {
      // week divider
      const date = item.timestamp.toDate();
      const day  = date.getDay();
      const offset = day === 0 ? 6 : day - 1;
      const monday = new Date(date);
      monday.setDate(date.getDate() - offset);
      const weekOf     = monday.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
      const weekLabel = `Week of ${weekOf}`;
      if (weekLabel !== lastWeekLabel) {
        const divider = document.createElement('div');
        divider.className = 'week-divider';
        divider.innerText = weekLabel;
        gallery.append(divider);
        lastWeekLabel = weekLabel;
      }

      // build card
      const card = document.createElement('div');
      card.className = 'photo-card';
      if (selectMode) card.classList.add('select-mode');

      // checkbox
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'photo-checkbox';
      cb.onchange = e => {
        if (e.target.checked) {
          selectedItems.add(item);
          card.classList.add('selected');
        } else {
          selectedItems.delete(item);
          card.classList.remove('selected');
        }
        btnShare.disabled = selectedItems.size === 0;
        const canDel = Array.from(selectedItems)
          .every(it => canDeletePhoto(it));
        btnDelete.disabled = !canDel || selectedItems.size === 0;
      };
      card.append(cb);

      // video detection
      const isVideo = item.mimeType
        ? item.mimeType.startsWith('video/')
        : /\.(mp4|mov|avi|webm)$/i.test(item.name);
      if (isVideo) card.classList.add('video');

      // thumbnail
      const img = document.createElement('img');
      img.src      = item.thumbnailLink;
      img.decoding = 'async';
      img.alt      = item.name;
      img.onclick  = () => { if (!selectMode) showMedia(item); };
      card.append(img);

      // play icon
      if (isVideo) {
        const playIcon = document.createElement('div');
        playIcon.className = 'play-icon';
        playIcon.innerText = '▶';
        card.append(playIcon);
      }

      // caption
      const cap = document.createElement('div');
      cap.className = 'photo-caption';
      cap.appendChild(document.createElement('div'))
         .innerText = date.toLocaleDateString();
      {
        const whoDiv = document.createElement('div');
        whoDiv.innerText = `From ${(item.ownerName || '').trim() || '…'}`;
        cap.appendChild(whoDiv);
        // async resolve & update text if needed
        if (!item.ownerName) {
          resolveOwnerName(item).then(name => {
            whoDiv.innerText = `From ${name || 'Strangers'}`;
          });
        }
      }

      card.append(cap);

      // like button
      const likeBtn = document.createElement('button');
      likeBtn.className = 'photo-like-btn';
      likeBtn.innerText = '♡ 0';
      likeBtn.onclick = async () => {
        const likeRef = db.collection('photos')
                          .doc(item.id)
                          .collection('likes')
                          .doc(userPhone);
        if (likeBtn.dataset.liked === 'true') {
          await likeRef.delete();
          updatePoints('like', -1);
        } else {
          await likeRef.set({ liked: true });
          updatePoints('like', 1);
        }
        const snap = await db.collection('photos')
                             .doc(item.id)
                             .collection('likes')
                             .get();
        const cnt = snap.size;
        likeBtn.textContent = cnt > 0 ? `♥ ${cnt}` : '♥';
        likeBtn.dataset.liked = likeBtn.dataset.liked === 'true' ? 'false' : 'true';
        likeBtn.classList.toggle('liked', likeBtn.dataset.liked === 'true');
      };
      db.collection('photos').doc(item.id)
        .collection('likes').get()
        .then(snap => {
          const cnt   = snap.size;
          const liked = snap.docs.some(d => d.id === userPhone);
          likeBtn.textContent   = cnt > 0 ? `♥ ${cnt}` : '♥';
          likeBtn.dataset.liked = liked ? 'true' : 'false';
          likeBtn.classList.toggle('liked', liked);
        });
      card.append(likeBtn);

      // delete button
      if (canDeletePhoto(item)) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'photo-delete-icon';
        delBtn.innerHTML = '&times;';
        Object.assign(delBtn.style, {
          position:   'absolute',
          top:        '8px',
          right:      '8px',
          zIndex:     '100',
          background: 'transparent',
          border:     'none',
          fontSize:   '18px',
          lineHeight: '1',
          cursor:     'pointer',
        });
        delBtn.onclick = async () => {
          await db.collection('photos').doc(item.id).update({ deleted: true });
          card.style.display = 'none';
        };
        card.append(delBtn);
      }

      // animation prep
      card.style.transform  = 'scale(0.9)';
      card.style.opacity    = '0';
      card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';

      groupCards.push(card);
      loadPromises.push(new Promise(res => {
        if (img.complete) return res();
        img.onload  = res;
        img.onerror = res;
      }));
    }

    await Promise.all(loadPromises);
    groupCards.forEach((card, idx) => {
      gallery.append(card);
      setTimeout(() => {
        card.style.opacity   = '1';
        card.style.transform = 'scale(1)';
      }, idx * 100);
    });
  }
}





// 11) Select-multiple toggle --------------------------------------------------
btnSelect.innerText = 'Select multiple';
btnSelect.onclick = () => {
  selectMode = !selectMode;
  btnSelect.innerText = selectMode ? 'Cancel' : 'Select multiple';

  document.querySelectorAll('.photo-card').forEach(card => {
    card.classList.toggle('select-mode', selectMode);
    if (!selectMode) {
      const cb = card.querySelector('input.photo-checkbox');
      if (cb) cb.checked = false;
    }
  });

  btnShare.style.display  = selectMode ? 'inline-block' : 'none';
  btnDelete.style.display = selectMode ? 'inline-block' : 'none';

  if (!selectMode) {
    selectedItems.clear();
    btnShare.disabled  = true;
    btnDelete.disabled = true;
  }
};

// 12) Share multiple (Web Share API) -----------------------------------------
async function shareSelected() {
  if (selectedItems.size === 0) return;
  if (navigator.share) {
    btnShare.disabled = true;
    btnShare.innerText = 'Sharing...';
    const itemsArray = Array.from(selectedItems);
    try {
      const filesToShare = [];
      for (const item of itemsArray) {
        const res = await fetch(item.webContentLink);
        if (!res.ok) {
          console.error('Failed to fetch file for sharing:', item.name);
          continue;
        }
        const blob = await res.blob();
        const fileName = item.name || (blob.type.startsWith('image/') ? 'photo.jpg' : 'video.mp4');
        filesToShare.push(new File([blob], fileName, { type: blob.type }));
      }
      if (filesToShare.length === 0) {
        alert('No files to share.');
      } else {
        await navigator.share({
          files: filesToShare,
          title: filesToShare.length === 1 ? filesToShare[0].name : `Shared ${filesToShare.length} files`
        });
      }
    } catch (err) {
      console.error('Share failed or was cancelled', err);
    }
    btnShare.disabled = false;
    btnShare.innerText = 'Share';
  } else {
    alert('Web Share API not supported in this browser.');
  }
}
btnShare.onclick = shareSelected;

// 13) Delete multiple --------------------------------------------------------
btnDelete.onclick = async () => {
  // only items the current user can delete (owner OR admin)
  const items = Array.from(selectedItems).filter(it => canDeletePhoto(it));
  if (items.length === 0) return;

  btnDelete.disabled = true;
  btnDelete.innerText = 'Deleting…';

  try {
    // Use a Firestore batch (faster, fewer round-trips)
    const batch = db.batch();
    items.forEach(it => {
      const ref = db.collection('photos').doc(it.id);
      batch.update(ref, { deleted: true });
    });
    await batch.commit();

    // Refresh UI (simplest) — or remove cards individually if you prefer
    await loadGallery();
  } catch (err) {
    console.error('Bulk delete failed:', err);
    alert('Could not delete selected items.');
  } finally {
    btnDelete.disabled = false;
    btnDelete.innerText = 'Delete';
    selectedItems.clear();
    btnShare.disabled = true;
    btnDelete.disabled = true;
    selectMode = false;
    btnSelect.innerText = 'Select multiple';
  }
};

// 14) Modal image/video overlay ------------------------------------------------
function showMedia(item) {
  modalOverlay.style.display = 'flex';
  modalLoading.style.display = 'flex';
  const isVideo = item.mimeType
    ? item.mimeType.startsWith('video/')
    : /\.(mp4|mov|avi|webm)$/i.test(item.name);
  if (isVideo) {
    modalImage.style.display = 'none';
    modalVideo.style.display = 'block';
    modalVideo.src = item.url;
    modalVideo.onloadeddata = () => { modalLoading.style.display = 'none'; };
  } else {
    modalVideo.style.display = 'none';
    modalImage.style.display = 'block';
    modalImage.src = item.url;
    modalImage.onload = () => { modalLoading.style.display = 'none'; };
  }
  modalDownload.href     = item.url;
  modalDownload.download = item.name || '';
}

modalOverlay.onclick = (e) => {
  if (e.target === modalOverlay) {
    modalOverlay.style.display = 'none';
    modalLoading.style.display = 'none';
    modalVideo.pause?.();
  }
};
modalContent.onclick = (e) => {
  e.stopPropagation();
};

// 15) Persistent likes & sPoints ---------------------------------------------
async function updatePoints(type, delta = 0) {
  const todayStr = new Date().toISOString().slice(0, 10);
  let changed = false;
  if (type === 'upload') {
    if (lastUploadDate !== todayStr) {
      lastUploadDate = todayStr;
      uploadPointsToday = 0;
    }
    if (uploadPointsToday < 70) {
      const add = Math.min(7, 70 - uploadPointsToday);
      if (add > 0) {
        uploadPointsToday += add;
        userPoints += add;
        changed = true;
      }
    }
  } else if (type === 'like') {
    userPoints += delta;
    changed = true;
  } else if (type === 'comment') {
    if (lastCommentDate !== todayStr) {
      lastCommentDate = todayStr;
      commentPointsToday = 0;
    }
    if (commentPointsToday < 25) {
      const add = Math.min(3, 25 - commentPointsToday);
      if (add > 0) {
        commentPointsToday += add;
        userPoints += add;
        changed = true;
      }
    }
  }
  if (changed) {
    const updateData = { sPoints: userPoints };
    if (type === 'upload') {
      updateData.uploadPointsToday = uploadPointsToday;
      updateData.lastUploadPointsDate = lastUploadDate;
    }
    if (type === 'comment') {
      updateData.commentPointsToday = commentPointsToday;
      updateData.lastCommentPointsDate = lastCommentDate;
    }
    try {
      await db.collection('members').doc(userPhone).update(updateData);
    } catch (e) {
      console.error('Failed to update sPoints:', e);
    }
    const pointsValEl = document.getElementById('points-value');
    if (pointsValEl) pointsValEl.innerText = userPoints;
  }
}
pointsClose.onclick = () => {
  pointsOverlay.style.display = 'none';
};

const uploaderNameCache = new Map(); // phone -> name

async function resolveOwnerName(item) {
  if (item.ownerName && item.ownerName.trim()) return item.ownerName;
  if (!item.ownerPhone) return '';

  if (uploaderNameCache.has(item.ownerPhone)) {
    return uploaderNameCache.get(item.ownerPhone);
  }
  const snap = await db.collection('members').doc(item.ownerPhone).get();
  const name = (snap.exists ? (snap.data().name || snap.data().Name || '') : '').trim();
  uploaderNameCache.set(item.ownerPhone, name || '');
  // opportunistically backfill Firestore so future loads are instant
  if (name) {
    db.collection('photos').doc(item.id).update({ ownerName: name }).catch(()=>{});
  }
  return name;
}


// 16) Load more (pagination) ------------------------------------------------
async function loadMore() {
  btnLoadMore.disabled = true;
  btnLoadMore.innerText = 'Loading...';
  try {
    // build Firestore query with pagination
    let q = db
      .collection('photos')
      .where('deleted', '==', false)
      .orderBy('timestamp', 'desc')
      .limit(PAGE_SIZE);
    if (lastDoc) {
      q = q.startAfter(lastDoc);
    }

    const snap = await q.get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // update lastDoc for next page
    lastDoc = snap.docs[snap.docs.length - 1] || lastDoc;

    await renderGallery(items, true);

    // hide "Load more" if fewer than PAGE_SIZE items
    if (snap.size < PAGE_SIZE) {
      loadMoreContainer.style.display = 'none';
    }
  } catch (err) {
    console.error(err);
    btnLoadMore.style.display = 'none';
  }
  btnLoadMore.disabled = false;
  btnLoadMore.innerText = 'Load more';
}

btnLoadMore.onclick = () => {
  autoTriggered = true;
  loadMore();
};

const observer = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting && loadMoreContainer.style.display !== 'none' && autoTriggered) {
    observer.unobserve(loadMoreContainer);
    loadMore().then(() => {
      if (loadMoreContainer.style.display !== 'none') {
        observer.observe(loadMoreContainer);
      }
    });
  }
}, { root: null, threshold: 0 });
