// js/photos.js

// 1) Initialize Firebase -----------------------------------------------------
if (!window.firebaseConfig) throw new Error("Missing firebaseConfig.js");
firebase.initializeApp(window.firebaseConfig);
const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();

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

let userPhone            = localStorage.getItem('userPhone') || '';
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
  if (userPhone) {
    // Attempt to fetch user data and show the app
    await fetchUserNameAndShow(userPhone);
  } else {
    overlay.style.display = 'flex';
    otpEntryDiv.style.display = 'none';
  }

  btnShare.style.display  = 'none';
  btnDelete.style.display = 'none';

  window.addEventListener('scroll', () => { autoTriggered = true; });
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
    localStorage.setItem('userPhone', userPhone);

    // Fetch Firestore membership
    const snap = await db.collection('members').doc(userPhone).get();
    if (!snap.exists) {
      alert('No membership record found. Please sign up first.');
      return;
    }
    const data = snap.data();
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

    loadGallery();
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

  loadGallery();
}

// 8) Upload logic -----------------------------------------------------------
btnUpload.onclick = () => fileInput.click();
fileInput.onchange = () => uploadFiles(fileInput.files);

async function uploadFiles(files) {
  for (const file of files) {
    // Create placeholder card for the new file
    const card = document.createElement('div');
    card.className = 'photo-card new-upload';
    if (selectMode) card.classList.add('select-mode');

    const isVideo = file.type.startsWith('video/');
    if (isVideo) card.classList.add('video');

    // Thumbnail or preview
    let imgEl = null;
    if (!isVideo) {
      imgEl = document.createElement('img');
      imgEl.src = URL.createObjectURL(file);
      imgEl.alt = file.name;
      card.append(imgEl);
    }
    if (isVideo) {
      const playIcon = document.createElement('div');
      playIcon.className = 'play-icon';
      playIcon.innerText = '▶';
      card.append(playIcon);
    }

    // Caption overlay
    const cap = document.createElement('div');
    cap.className = 'photo-caption';
    cap.appendChild(document.createElement('div')).innerText = new Date().toLocaleDateString();
    cap.appendChild(document.createElement('div')).innerText = `From ${userName}`;
    card.append(cap);

    // Progress bar
    const progressBar = document.createElement('div');
    progressBar.className = 'upload-progress';
    card.append(progressBar);

    // Insert card at top of gallery
    gallery.prepend(card);
    requestAnimationFrame(() => {
      card.classList.add('slide-in');
    });

    // Upload file via XHR
    await new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/drive/upload');
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          progressBar.style.width = percent + '%';
        }
      };
      xhr.onload = async () => {
        if (xhr.status !== 200) {
          console.error('Upload failed', xhr.responseText);
          alert('Upload failed for file: ' + file.name);
          card.remove();
          return resolve();
        }
        let data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch (err) {
          console.error('Upload response parse error', err);
          alert('Upload failed for file: ' + file.name);
          card.remove();
          return resolve();
        }
        // Record metadata in Firestore
        try {
          await db.collection('photos').doc(data.id).set({
            name:          data.name,
            url:           data.webContentLink,
            thumbnailLink: data.thumbnailLink,
            ownerPhone:    userPhone,
            ownerName:     userName,
            uploaderPhone: userPhone,
            timestamp:     firebase.firestore.Timestamp.fromDate(new Date(data.createdTime)),
            deleted:       false
          });
        } catch (e) {
          console.error('Failed to save file metadata:', e);
        }
        // Award upload points
        try {
          await updatePoints('upload');
        } catch (e) {
          console.error('Failed to update points after upload:', e);
        }

        progressBar.style.display = 'none';

        // For video, set thumbnail image
        if (isVideo && data.thumbnailLink) {
          const thumbImg = document.createElement('img');
          thumbImg.src = data.thumbnailLink;
          thumbImg.alt = data.name;
          thumbImg.onclick = () => {
            if (selectMode) return;
            showMedia(data);
          };
          const firstCaption = card.querySelector('.photo-caption');
          card.insertBefore(thumbImg, firstCaption);
        }

        // Enable click on image to open modal
        if (!isVideo && imgEl) {
          imgEl.onclick = () => {
            if (selectMode) return;
            showMedia(data);
          };
        }

        // Like button
        const likeBtn = document.createElement('button');
        likeBtn.className = 'photo-like-btn';
        likeBtn.innerText = '♡';
        likeBtn.onclick = async () => {
          if (likeBtn.dataset.liked === 'true') {
            await db.collection('photos').doc(data.id).collection('likes').doc(userPhone).delete();
            likeBtn.dataset.liked = 'false';
            let count = parseInt(likeBtn.innerText.split(' ')[1]) || 0;
            count = Math.max(0, count - 1);
            likeBtn.innerText = count > 0 ? `♥ ${count}` : '♥';
            likeBtn.classList.remove('liked');
            updatePoints('like', -1);
          } else {
            await db.collection('photos').doc(data.id).collection('likes').doc(userPhone).set({ liked: true });
            likeBtn.dataset.liked = 'true';
            let count = parseInt(likeBtn.innerText.split(' ')[1]) || 0;
            count = count + 1;
            likeBtn.innerText = `♥ ${count}`;
            likeBtn.classList.add('liked');
            updatePoints('like', 1);
          }
        };
        // Fetch initial like status/count
        db.collection('photos').doc(data.id).collection('likes').get().then(snap => {
          const count = snap.size;
          const liked = snap.docs.some(doc => doc.id === userPhone);
          likeBtn.textContent = count > 0 ? `♥ ${count}` : '♥';
          likeBtn.dataset.liked = liked ? 'true' : 'false';
          likeBtn.classList.toggle('liked', liked);
        });
        card.append(likeBtn);

        // Delete button if owner
        if (userPhone) {
          const delBtn = document.createElement('button');
          delBtn.className = 'photo-delete';
          delBtn.innerText = 'Request Delete';
          delBtn.onclick = async () => {
            await fetch('/api/drive/move', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId: data.id })
            });
            card.style.display = 'none';
          };
          card.append(delBtn);
        }

        // Add checkbox for multi-select
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'photo-checkbox';
        cb.onchange = e => {
          if (e.target.checked) {
            selectedItems.add(data);
            card.classList.add('selected');
          } else {
            selectedItems.delete(data);
            card.classList.remove('selected');
          }
          btnShare.disabled = selectedItems.size === 0;
          const canDelete = Array.from(selectedItems).every(it => it.ownerPhone === userPhone);
          btnDelete.disabled = !canDelete || selectedItems.size === 0;
        };
        card.prepend(cb);

        resolve();
      };
      xhr.onerror = () => {
        console.error('Upload XHR error');
        alert('Upload failed for file: ' + file.name);
        card.remove();
        resolve();
      };
      const formData = new FormData();
      formData.append('owner', userPhone);
      formData.append('ownerName', userName);
      formData.append('file', file);
      xhr.send(formData);
    });
  }
}

// 9) Load & render gallery --------------------------------------------------
async function loadGallery() {
  selectedItems.clear();
  selectMode = false;
  btnShare.disabled  = true;
  btnDelete.disabled = true;
  nextPageToken = null;

  gallery.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--green);">Loading…</p>';

  try {
    const res = await fetch(`/api/drive/list?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      gallery.innerHTML = '<p style="grid-column:1/-1;color:red;">Error loading gallery</p>';
      return;
    }
    const data = await res.json();
    const items = data.files || data;
    nextPageToken = data.nextPageToken || null;
    await renderGallery(items, false);
    if (nextPageToken) {
      loadMoreContainer.style.display = 'block';
      btnLoadMore.disabled = false;
      btnLoadMore.innerText = 'Load more';
      observer.observe(loadMoreContainer);
    } else {
      loadMoreContainer.style.display = 'none';
    }
  } catch (err) {
    console.error(err);
    gallery.innerHTML = '<p style="grid-column:1/-1;color:red;">Error loading gallery</p>';
  }
}

// renderGallery remains unchanged, but ensure it uses item.ownerPhone or item.appProperties.owner to check ownership, and looks up uploaderName via Firestore when creating captions.

// 10) renderGallery (unchanged except uploaderName lookup) -----------------
async function renderGallery(items, append = false) {
  if (!append) {
    gallery.innerHTML = '';
  }
  if (!items.length) {
    if (!append) {
      gallery.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--green-light);">No media yet</p>';
    }
    return;
  }

  let lastWeekLabel = '';
  let startIndex = 0;
  if (append) {
    const existingCards = gallery.querySelectorAll('.photo-card').length;
    const remainder = existingCards % 3;
    if (remainder !== 0) {
      const fillCount = 3 - remainder;
      if (items.length >= fillCount) {
        const groupItems = items.slice(0, fillCount);
        const groupCards = [];
        const loadPromises = [];
        for (const item of groupItems) {
          const createdDate = new Date(item.createdTime);
          const day = createdDate.getDay();
          const offset = day === 0 ? 6 : day - 1;
          const monday = new Date(createdDate);
          monday.setDate(createdDate.getDate() - offset);
          const weekOf = monday.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
          const weekLabel = `Week of ${weekOf}`;
          if (weekLabel !== lastWeekLabel) {
            const divider = document.createElement('div');
            divider.className = 'week-divider';
            divider.innerText = weekLabel;
            gallery.append(divider);
            lastWeekLabel = weekLabel;
          }
          const card = document.createElement('div');
          card.className = 'photo-card';
          if (selectMode) card.classList.add('select-mode');
          const isVideo = item.mimeType ? item.mimeType.startsWith('video/') : /\.(mp4|mov|avi|webm)$/i.test(item.name);
          if (isVideo) card.classList.add('video');
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
            const canDelete = Array.from(selectedItems).every(it => it.ownerPhone === userPhone);
            btnDelete.disabled = !canDelete || selectedItems.size === 0;
          };
          card.append(cb);
          const img = document.createElement('img');
          if (isVideo) {
            img.src = item.thumbnailLink;
          } else {
            img.src = `/api/drive/thumb?id=${item.id}`;
          }
          img.decoding = 'async';
          img.alt = item.name;
          img.onclick = () => {
            if (selectMode) return;
            showMedia(item);
          };
          card.append(img);
          if (isVideo) {
            const playIcon = document.createElement('div');
            playIcon.className = 'play-icon';
            playIcon.innerText = '▶';
            card.append(playIcon);
          }
          const cap = document.createElement('div');
          cap.className = 'photo-caption';
          cap.appendChild(document.createElement('div')).innerText = new Date(item.createdTime).toLocaleDateString();
          let uploaderName = 'Strangers';
          try {
            const itemSnap = await db.collection('photos').doc(item.id).get();
            if (itemSnap.exists) {
              uploaderName = itemSnap.data().ownerName || uploaderName;
            }
          } catch (e) {
            console.error('Failed to fetch ownerName', e);
          }
          cap.appendChild(document.createElement('div')).innerText = `From ${uploaderName}`;
          card.append(cap);
          const likeBtn = document.createElement('button');
          likeBtn.className = 'photo-like-btn';
          likeBtn.innerText = '♡ 0';
          likeBtn.onclick = async () => {
            if (likeBtn.dataset.liked === 'true') {
              await db.collection('photos').doc(item.id).collection('likes').doc(userPhone).delete();
              likeBtn.dataset.liked = 'false';
              let count = parseInt(likeBtn.innerText.split(' ')[1]) || 0;
              count = Math.max(0, count - 1);
              likeBtn.innerText = count > 0 ? `♥ ${count}` : '♥';
              likeBtn.classList.remove('liked');
              updatePoints('like', -1);
            } else {
              await db.collection('photos').doc(item.id).collection('likes').doc(userPhone).set({ liked: true });
              likeBtn.dataset.liked = 'true';
              let count = parseInt(likeBtn.innerText.split(' ')[1]) || 0;
              count = count + 1;
              likeBtn.innerText = `♥ ${count}`;
              likeBtn.classList.add('liked');
              updatePoints('like', 1);
            }
          };
          db.collection('photos').doc(item.id).collection('likes').get().then(snap => {
            const count = snap.size;
            const liked = snap.docs.some(doc => doc.id === userPhone);
            likeBtn.textContent = count > 0 ? `♥ ${count}` : '♥';
            likeBtn.dataset.liked = liked ? 'true' : 'false';
            likeBtn.classList.toggle('liked', liked);
          });
          card.append(likeBtn);
          if (item.ownerPhone === userPhone) {
            const delBtn = document.createElement('button');
            delBtn.className = 'photo-delete';
            delBtn.innerText = 'Request Delete';
            delBtn.onclick = async () => {
              await fetch('/api/drive/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: item.id })
              });
              card.style.display = 'none';
            };
            card.append(delBtn);
          }
          card.style.transform = 'scale(0.9)';
          card.style.opacity = '0';
          card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
          groupCards.push(card);
          loadPromises.push(new Promise(res => {
            if (img.complete) {
              return res();
            }
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
        startIndex = fillCount;
      }
    }
  }
  for (let index = startIndex; index < items.length; index += 3) {
    const groupItems = items.slice(index, index + 3);
    const groupCards = [];
    const loadPromises = [];
    for (const item of groupItems) {
      const createdDate = new Date(item.createdTime);
      const day = createdDate.getDay();
      const offset = day === 0 ? 6 : day - 1;
      const monday = new Date(createdDate);
      monday.setDate(createdDate.getDate() - offset);
      const weekOf = monday.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      const weekLabel = `Week of ${weekOf}`;
      if (weekLabel !== lastWeekLabel) {
        const divider = document.createElement('div');
        divider.className = 'week-divider';
        divider.innerText = weekLabel;
        gallery.append(divider);
        lastWeekLabel = weekLabel;
      }
      const card = document.createElement('div');
      card.className = 'photo-card';
      if (selectMode) card.classList.add('select-mode');
      const isVideo = item.mimeType ? item.mimeType.startsWith('video/') : /\.(mp4|mov|avi|webm)$/i.test(item.name);
      if (isVideo) card.classList.add('video');
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
        const canDelete = Array.from(selectedItems).every(it => it.ownerPhone === userPhone);
        btnDelete.disabled = !canDelete || selectedItems.size === 0;
      };
      card.append(cb);
      const img = document.createElement('img');
      if (isVideo) {
        img.src = item.thumbnailLink;
      } else {
        img.src = `/api/drive/thumb?id=${item.id}`;
      }
      img.decoding = 'async';
      img.alt = item.name;
      img.onclick = () => {
        if (selectMode) return;
        showMedia(item);
      };
      card.append(img);
      if (isVideo) {
        const playIcon = document.createElement('div');
        playIcon.className = 'play-icon';
        playIcon.innerText = '▶';
        card.append(playIcon);
      }
      const cap = document.createElement('div');
      cap.className = 'photo-caption';
      cap.appendChild(document.createElement('div')).innerText = new Date(item.createdTime).toLocaleDateString();
      let uploaderName = 'Strangers';
      try {
        const itemSnap = await db.collection('photos').doc(item.id).get();
        if (itemSnap.exists) {
          uploaderName = itemSnap.data().ownerName || uploaderName;
        }
      } catch (e) {
        console.error('Failed to fetch ownerName', e);
      }
      cap.appendChild(document.createElement('div')).innerText = `From ${uploaderName}`;
      card.append(cap);
      const likeBtn = document.createElement('button');
      likeBtn.className = 'photo-like-btn';
      likeBtn.innerText = '♡ 0';
      likeBtn.onclick = async () => {
        if (likeBtn.dataset.liked === 'true') {
          await db.collection('photos').doc(item.id).collection('likes').doc(userPhone).delete();
          likeBtn.dataset.liked = 'false';
          let count = parseInt(likeBtn.innerText.split(' ')[1]) || 0;
          count = Math.max(0, count - 1);
          likeBtn.innerText = count > 0 ? `♥ ${count}` : '♥';
          likeBtn.classList.remove('liked');
          updatePoints('like', -1);
        } else {
          await db.collection('photos').doc(item.id).collection('likes').doc(userPhone).set({ liked: true });
          likeBtn.dataset.liked = 'true';
          let count = parseInt(likeBtn.innerText.split(' ')[1]) || 0;
          count = count + 1;
          likeBtn.innerText = `♥ ${count}`;
          likeBtn.classList.add('liked');
          updatePoints('like', 1);
        }
      };
      db.collection('photos').doc(item.id).collection('likes').get().then(snap => {
        const count = snap.size;
        const liked = snap.docs.some(doc => doc.id === userPhone);
        likeBtn.textContent = count > 0 ? `♥ ${count}` : '♥';
        likeBtn.dataset.liked = liked ? 'true' : 'false';
        likeBtn.classList.toggle('liked', liked);
      });
      card.append(likeBtn);
      if (item.ownerPhone === userPhone) {
        const delBtn = document.createElement('button');
        delBtn.className = 'photo-delete';
        delBtn.innerText = 'Request Delete';
        delBtn.onclick = async () => {
          await fetch('/api/drive/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: item.id })
          });
          card.style.display = 'none';
        };
        card.append(delBtn);
      }
      card.style.transform = 'scale(0.9)';
      card.style.opacity = '0';
      card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      groupCards.push(card);
      loadPromises.push(new Promise(res => {
        if (img.complete) {
          return res();
        }
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
  const tasks = Array.from(selectedItems)
    .filter(it => it.ownerPhone === userPhone)
    .map(it => fetch('/api/drive/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: it.id })
    }));
  await Promise.all(tasks);
  loadGallery();
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
    modalVideo.src = `/api/drive/thumb?id=${item.id}&sz=1600`;
    modalVideo.onloadeddata = () => { modalLoading.style.display = 'none'; };
  } else {
    modalVideo.style.display = 'none';
    modalImage.style.display = 'block';
    modalImage.src = `/api/drive/thumb?id=${item.id}&sz=1600`;
    modalImage.onload = () => { modalLoading.style.display = 'none'; };
  }
  modalDownload.href     = `/api/drive/thumb?id=${item.id}&sz=1600`;
  modalDownload.download = item.name || '';
}
modalClose.onclick = () => {
  modalOverlay.style.display = 'none';
  modalLoading.style.display = 'none';
  modalVideo.pause?.();
};
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

// 16) Load more (pagination) ------------------------------------------------
async function loadMore() {
  if (!nextPageToken) return;
  btnLoadMore.disabled = true;
  btnLoadMore.innerText = 'Loading...';
  try {
    const res = await fetch(`/api/drive/list?pageToken=${encodeURIComponent(nextPageToken)}&t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load more');
    const data = await res.json();
    const items = data.files || data;
    nextPageToken = data.nextPageToken || null;
    await renderGallery(items, true);
    if (!nextPageToken) {
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
  if (entries[0].isIntersecting && nextPageToken && autoTriggered) {
    observer.unobserve(loadMoreContainer);
    loadMore().then(() => {
      if (nextPageToken) {
        observer.observe(loadMoreContainer);
      }
    });
  }
}, { root: null, threshold: 0 });
