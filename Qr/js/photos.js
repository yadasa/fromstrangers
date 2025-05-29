// js/photos.js

// 1) Init Firebase ----------------------------------------------------------
if (!window.firebaseConfig) throw new Error("Missing firebaseConfig.js");
firebase.initializeApp(window.firebaseConfig);
const db      = firebase.firestore();
const storage = firebase.storage();

// 2) DOM refs ---------------------------------------------------------------
const overlay       = document.getElementById('phone-entry');
const inpPhone      = document.getElementById('phone-input');
const btnPhone      = document.getElementById('phone-submit');
const appDiv        = document.getElementById('photos-app');
const userInfoEl    = document.getElementById('user-info-photos');

const btnUpload     = document.getElementById('btn-upload');
const btnSelect     = document.getElementById('btn-select');       // select multiple
const btnShare      = document.getElementById('btn-share');        // share multiple
const btnDelete     = document.getElementById('btn-delete-multi'); // delete multiple

const fileInput     = document.getElementById('file-input');
const gallery       = document.getElementById('gallery');

const controlsDiv   = document.getElementById('controls-photos');
const btnLoadMore   = document.getElementById('btn-load-more');
const loadMoreContainer = document.getElementById('load-more-container');
const modalOverlay  = document.getElementById('modal-overlay');
const modalContent  = document.getElementById('modal-content');
const modalImage    = document.getElementById('modal-image');
const modalVideo    = document.getElementById('modal-video');
const modalClose    = document.getElementById('modal-close');
const modalDownload = document.getElementById('modal-download');
const pointsOverlay = document.getElementById('points-overlay');
const pointsClose   = document.getElementById('points-close');

let userPhone       = localStorage.getItem('userPhone') || '';
let userName        = '';
let userPoints      = 0;
let uploadPointsToday = 0, lastUploadDate = '';
let commentPointsToday = 0, lastCommentDate = '';
let nextPageToken   = null;
let autoTriggered   = false;

let selectMode      = false;
let selectedItems   = new Set();

// 3) On load ----------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  if (userPhone) fetchUserNameAndShow(userPhone);
  else overlay.style.display = 'flex';

  btnShare.style.display = 'none';
  btnDelete.style.display = 'none';

  window.addEventListener('scroll', () => { autoTriggered = true; });
});

// 4) Phone submission -------------------------------------------------------
btnPhone.onclick = async () => {
  let raw = inpPhone.value.replace(/\D/g, '');
  if (raw.length === 11 && raw.startsWith('1')) raw = raw.slice(1);
  if (raw.length !== 10) return alert('Enter a valid 10-digit phone.');
  const snap = await db.collection('members').doc(raw).get();
  if (!snap.exists) return alert('Phone not found in members.');
  userPhone = raw;
  localStorage.setItem('userPhone', userPhone);
  fetchUserNameAndShow(userPhone);
};

async function fetchUserNameAndShow(phone) {
  const snap = await db.collection('members').doc(phone).get();
  const data = snap.data() || {};
  userName = data.name || data.Name || 'No Name';
  userPoints = data.sPoints || 0;
  uploadPointsToday = data.uploadPointsToday || 0;
  lastUploadDate = data.lastUploadPointsDate || '';
  commentPointsToday = data.commentPointsToday || 0;
  lastCommentDate = data.lastCommentPointsDate || '';
  userInfoEl.innerText = `Logged in as ${userName}`;
  // Show points total and info link
  const pointsInfoEl = document.getElementById('points-info');
  pointsInfoEl.innerHTML = `<span id="points-value">${userPoints}</span> sPoints – <a id="points-info-link" href="#">info</a>`;
  pointsInfoEl.style.display = 'block';
  document.getElementById('points-info-link').onclick = e => {
    e.preventDefault();
    pointsOverlay.style.display = 'flex';
  };
  overlay.style.display = 'none';
  appDiv.style.display  = 'block';
  loadGallery();
}

// 5) Upload logic -----------------------------------------------------------
btnUpload.onclick = () => fileInput.click();
fileInput.onchange = () => uploadFiles(fileInput.files);

async function uploadFiles(files) {
  for (const file of files) {
    const form = new FormData();
    form.append('owner', userPhone);
    form.append('ownerName', userName);
    form.append('file', file);

    const res = await fetch('/api/drive/upload', { method: 'POST', body: form });
    if (!res.ok) {
      console.error('Upload failed', await res.text());
      continue;
    }
    const data = await res.json();

    // record metadata in Firestore (optional)
    await db.collection('photos').doc(data.id).set({
      name:          data.name,
      url:           data.webContentLink,
      thumbnailLink: data.thumbnailLink,
      owner:         data.appProperties.owner,
      ownerName:     data.appProperties.ownerName,
      timestamp:     firebase.firestore.Timestamp.fromDate(new Date(data.createdTime)),
      deleted: false
    });
    // award sPoints for upload
    await updatePoints('upload');
  }
  prependCard(data);
}

// 6) Load & render gallery --------------------------------------------------
async function loadGallery() {
  selectedItems.clear();
  selectMode = false;
  btnShare.disabled = true;
  btnDelete.disabled = true;
  nextPageToken = null;

  gallery.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--green);">Loading…</p>';

  const res = await fetch('/api/drive/list');
  if (!res.ok) {
    gallery.innerHTML = '<p style="grid-column:1/-1;color:red;">Error loading gallery</p>';
    return;
  }
  const data = await res.json();
  const items = data.files || data;
  nextPageToken = data.nextPageToken || null;
  renderGallery(items, false);
  if (nextPageToken) {
    loadMoreContainer.style.display = 'block';
    btnLoadMore.disabled = false;
    btnLoadMore.innerText = 'Load more';
    observer.observe(loadMoreContainer);
  } else {
    loadMoreContainer.style.display = 'none';
  }
}

function prependCard(item) {
  const temp = document.createElement('div');
  temp.innerHTML = cardHTML(item);           // same markup as renderGallery
  const card = temp.firstElementChild;
  card.classList.add('new-upload');
  gallery.prepend(card);

  // animate slide‐in
  requestAnimationFrame(() => {
    card.classList.add('slide-in');
  });
}


// 7) Render gallery ---------------------------------------------------------
function renderGallery(items, append = false) {
  if (!append) gallery.innerHTML = '';

  if (!items.length) {
    if (!append) {
      gallery.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--green-light);">No media yet</p>';
    }
    return;
  }

  let lastWeekLabel = '';
  items.forEach(item => {
    // insert week divider if needed
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

    // photo card
    const card = document.createElement('div');
    card.className = 'photo-card';
    if (selectMode) card.classList.add('select-mode');

    // checkbox for multi-select
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
      const canDelete = Array.from(selectedItems)
        .every(it => it.appProperties?.owner === userPhone);
      btnDelete.disabled = !canDelete || selectedItems.size === 0;
    };
    card.append(cb);

    // thumbnail
    const img = document.createElement('img');
    img.src = `/api/drive/thumb?id=${item.id}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = item.name;
    img.onclick = () => {
      if (selectMode) return;
      showMedia(item);
    };
    card.append(img);

    // caption overlay (date + uploader)
    const cap = document.createElement('div');
    cap.className = 'photo-caption';

    // line 1: just the date
    const dateOnly = new Date(item.createdTime).toLocaleDateString();
    cap.appendChild(document.createElement('div')).innerText = dateOnly;

    // line 2: uploader name (fallback to “Strangers”)
    const uploaderName = item.appProperties?.ownerName || 'Strangers';
    cap.appendChild(document.createElement('div')).innerText = `From ${uploaderName}`;

    card.append(cap);


    // like button & count
    const likeBtn = document.createElement('button');
    likeBtn.className = 'photo-like-btn';
    likeBtn.innerText = '♡ 0';
    likeBtn.onclick = async () => {
      if (likeBtn.dataset.liked === 'true') {
        // Unlike
        await db.collection('photos').doc(item.id).collection('likes').doc(userPhone).delete();
        likeBtn.dataset.liked = 'false';
        let count = parseInt(likeBtn.innerText.split(' ')[1]) || 0;
        count = Math.max(0, count - 1);
        likeBtn.innerText = count > 0 ? `♥ ${count}` : '♥';
        likeBtn.classList.remove('liked');
        updatePoints('like', -1);
      } else {
        // Like
        await db.collection('photos').doc(item.id).collection('likes').doc(userPhone).set({ liked: true });
        likeBtn.dataset.liked = 'true';
        let count = parseInt(likeBtn.innerText.split(' ')[1]) || 0;
        count = count + 1;
        likeBtn.innerText = `♥ ${count}`;
        likeBtn.classList.add('liked');
        updatePoints('like', 1);
      }
    };
    // fetch initial like status and count
    db.collection('photos').doc(item.id).collection('likes').get().then(snap => {
      const count = snap.size;
      const liked = snap.docs.some(doc => doc.id === userPhone);

      // always use the same glyph
      likeBtn.textContent = count > 0 ? `♥ ${count}` : '♥';
      likeBtn.dataset.liked = liked ? 'true' : 'false';
      likeBtn.classList.toggle('liked', liked);
    });
    card.append(likeBtn);
    // single-delete (owner only)
    if (item.appProperties?.owner === userPhone) {
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

    gallery.append(card);
  });
}

// 8) Select-multiple toggle --------------------------------------------------
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

  btnShare.style.display = selectMode ? 'inline-block' : 'none';
  btnDelete.style.display = selectMode ? 'inline-block' : 'none';

  if (!selectMode) {
    selectedItems.clear();
    btnShare.disabled = true;
    btnDelete.disabled = true;
  }
};

// 9) Share multiple (Web Share API) ------------------------------------------
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

// 10) Delete multiple -------------------------------------------------------
btnDelete.onclick = async () => {
  const tasks = Array.from(selectedItems)
    .filter(it => it.appProperties?.owner === userPhone)
    .map(it => fetch('/api/drive/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: it.id })
    }));
  await Promise.all(tasks);
  loadGallery();
};

// 11) Modal image/video overlay ---------------------------------------------
function showMedia(item) {
  modalOverlay.style.display = 'flex';

  // decide if it’s video by looking at mimeType or extension
  const isVideo = item.mimeType
    ? item.mimeType.startsWith('video/')
    : /\.(mp4|mov|avi|webm)$/i.test(item.name);

  if (isVideo) {
    modalImage.style.display = 'none';
    modalVideo.style.display = 'block';
    modalVideo.src = `/api/drive/thumb?id=${item.id}&sz=1600`;
  } else {
    modalVideo.style.display = 'none';
    modalImage.style.display = 'block';
    // use your thumb endpoint at high resolution for the full view
    modalImage.src = `/api/drive/thumb?id=${item.id}&sz=1600`;
  }

  // everything else stays the same
  modalDownload.href    = `/api/drive/thumb?id=${item.id}&sz=1600`;
  modalDownload.download = item.name || '';
};

// 1) Close button
modalClose.onclick = () => {
  modalOverlay.style.display = 'none';
  modalVideo.pause?.();
};

// 2) Clickoutside to close
modalOverlay.onclick = (e) => {
  if (e.target === modalOverlay) {
    modalOverlay.style.display = 'none';
    modalVideo.pause?.();
  }
};

// 3) Prevent clicks inside the content from closing
modalContent.onclick = (e) => {
  e.stopPropagation();
};

// 12) Persistent likes & sPoints --------------------------------------------
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

// 13) Load more (pagination) ------------------------------------------------
async function loadMore() {
  if (!nextPageToken) return;
  btnLoadMore.disabled = true;
  btnLoadMore.innerText = 'Loading...';
  try {
    const res = await fetch('/api/drive/list?pageToken=' + encodeURIComponent(nextPageToken));
    if (!res.ok) throw new Error('Failed to load more');
    const data = await res.json();
    const items = data.files || data;
    nextPageToken = data.nextPageToken || null;
    renderGallery(items, true);
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
