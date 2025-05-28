// js/photos.js

// 1) Init Firebase ----------------------------------------------------------
if (!window.firebaseConfig) throw new Error("Missing firebaseConfig.js");
firebase.initializeApp(window.firebaseConfig);
const db      = firebase.firestore();
const storage = firebase.storage();

// 2) DOM refs ---------------------------------------------------------------
const overlay     = document.getElementById('phone-entry');
const inpPhone    = document.getElementById('phone-input');
const btnPhone    = document.getElementById('phone-submit');
const appDiv      = document.getElementById('photos-app');
const userInfoEl  = document.getElementById('user-info-photos');

const btnUpload   = document.getElementById('btn-upload');
const btnSelect   = document.getElementById('btn-select');       // select multiple
const btnDownload = document.getElementById('btn-download');     // download multiple
const btnDelete   = document.getElementById('btn-delete-multi'); // delete multiple

const fileInput   = document.getElementById('file-input');
const gallery     = document.getElementById('gallery');

let userPhone     = localStorage.getItem('userPhone') || '';
let userName      = '';

let selectMode    = false;
let selectedItems = new Set();


// 3) On load ----------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  if (userPhone) fetchUserNameAndShow(userPhone);
  else overlay.style.display = 'flex';

  btnDownload.style.display = 'none';
  btnDelete.style.display   = 'none';
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
  userInfoEl.innerText = `Logged in as ${userName}`;
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

    // record metadata in Firestore in case you need it later (optional)
    await db.collection('photos').doc(data.id).set({
      name:          data.name,
      url:           data.webContentLink,
      thumbnailLink: data.thumbnailLink,
      owner:         data.appProperties.owner,
      ownerName:     data.appProperties.ownerName,
      timestamp:     firebase.firestore.Timestamp.fromDate(
                       new Date(data.createdTime)
                     ),
      deleted: false
    });
  }
  loadGallery();
}


// 6) Load & render gallery --------------------------------------------------
async function loadGallery() {
  selectedItems.clear();
  btnDownload.disabled = true;
  btnDelete.disabled   = true;

  gallery.innerHTML =
    '<p style="grid-column:1/-1;text-align:center;color:var(--green);">Loading…</p>';

  const res = await fetch('/api/drive/list');
  if (!res.ok) {
    gallery.innerHTML =
      '<p style="grid-column:1/-1;color:red">Error loading gallery</p>';
    return;
  }
  // items: { id, name, thumbnailLink, webContentLink, createdTime, appProperties }
  const items = await res.json();
  renderGallery(items);
}


// 7) Render gallery ---------------------------------------------------------
function renderGallery(items) {
  gallery.innerHTML = '';

  if (!items.length) {
    gallery.innerHTML =
      '<p style="grid-column:1/-1;text-align:center;color:var(--green-light)">No media yet</p>';
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'photo-card';
    if (selectMode) card.classList.add('select-mode');

    // checkbox for multi-select
    const cb = document.createElement('input');
    cb.type  = 'checkbox';
    cb.className = 'photo-checkbox';
    cb.onchange = e => {
      if (e.target.checked) selectedItems.add(item);
      else                  selectedItems.delete(item);

      btnDownload.disabled = selectedItems.size === 0;

      const canDelete = Array.from(selectedItems)
        .every(it => it.appProperties?.owner === userPhone);
      btnDelete.disabled = !canDelete || selectedItems.size === 0;
    };
    card.append(cb);

    // thumbnail
    const img = document.createElement('img');
    img.src = `https://drive.google.com/thumbnail?id=${item.id}&sz=w320`;
    img.alt = item.name;
    img.onclick = () => window.open(item.webContentLink, '_blank');
    card.append(img);

    // caption
    const cap = document.createElement('div');
    cap.className = 'photo-caption';
    const dateStr = new Date(item.createdTime).toLocaleString();
    const byStr   = item.appProperties?.ownerName
                      ? `By ${item.appProperties.ownerName} • `
                      : '';
    cap.innerText = `${byStr}${dateStr}`;
    card.append(cap);

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

  document.querySelectorAll('.photo-card').forEach(card => {
    card.classList.toggle('select-mode', selectMode);
    if (!selectMode) {
      const cb = card.querySelector('input.photo-checkbox');
      if (cb) cb.checked = false;
    }
  });

  btnDownload.style.display = selectMode ? 'inline-block' : 'none';
  btnDelete.style.display   = selectMode ? 'inline-block' : 'none';

  if (!selectMode) {
    selectedItems.clear();
    btnDownload.disabled = true;
    btnDelete.disabled   = true;
  }
};


// 9) Download multiple ------------------------------------------------------
async function downloadSelected() {
  if (selectedItems.size === 0) return;

  const zip       = new JSZip();
  const promises  = [];

  selectedItems.forEach(item => {
    const p = fetch(item.webContentLink)
      .then(r => r.blob())
      .then(blob => zip.file(item.name, blob));
    promises.push(p);
  });

  await Promise.all(promises);
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'our-pics.zip');
}
btnDownload.onclick = downloadSelected;


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
