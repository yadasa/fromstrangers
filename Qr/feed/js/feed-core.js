// feed/js/feed-core.js

// ---------- Theme helpers ----------
function getSavedTheme() {
  try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; }
}
function saveTheme(theme) {
  try { localStorage.setItem('theme', theme); } catch {}
}
function applyTheme(theme) {
  const root = document.documentElement; // <html>
  if (theme === 'dark') root.classList.add('theme-dark');
  else root.classList.remove('theme-dark');
}
// Apply ASAP
applyTheme(getSavedTheme());

// ---------- Header dropdown ("Signed in as", Profile, Theme toggle) ----------
function renderSignedInMenu(container, { name }) {
  container.innerHTML = `
    <div class="user-menu">
      <button class="user-menu__button" aria-haspopup="true" aria-expanded="false">☰</button>
      <div class="user-menu__dropdown" role="menu" hidden>
        <div class="user-menu__item user-menu__item--label" aria-disabled="true">
          <em>Signed in as ${String(name || 'User').replace(/</g,'&lt;')}</em>
        </div>
        <a class="user-menu__item" href="/profile" role="menuitem">Profile</a>
        <button class="user-menu__item" id="theme-toggle" role="menuitem">Toggle Dark Mode</button>
      </div>
    </div>
  `;

  const btn = container.querySelector('.user-menu__button');
  const dd  = container.querySelector('.user-menu__dropdown');
  const toggle = container.querySelector('#theme-toggle');

  // open/close
  btn.addEventListener('click', () => {
    const open = !dd.hasAttribute('hidden');
    if (open) {
      dd.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', 'false');
    } else {
      dd.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
    }
  });

  // outside click closes
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      dd.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  // theme toggle
  toggle.addEventListener('click', () => {
    const next = (getSavedTheme() === 'dark') ? 'light' : 'dark';
    saveTheme(next);
    applyTheme(next);
  });
}

// ---------- Core boot ----------
(async function main() {
  // Wait for auth so we can prefer “not-RSVP’d” future event
  await window.FEED_AUTH_READY;

  // If signed in, swap header text for dropdown menu
  const st = window.FEED_STATE || {};
  if (st.currentPhone) {
    const mount = document.getElementById('signed-in');
    if (mount) renderSignedInMenu(mount, { name: st.currentName || 'User' });
  }

  // First prefetch to warm pools
  await Promise.all([
    window.FEED_DATA.prefetchFutureEvents(),
    window.FEED_DATA.prefetchRecentMedia()
  ]);

  // Page 1 (starts w/ future un-RSVP’d event, then videos/images, plus slot 3 & 7 injections)
  await loadNextFeedPage();

  // Infinite scroll sentinel
  ensureInfiniteScroll();

  // Fallback button
  const more = document.getElementById('load-more');
  if (more) {
    more.style.display = 'block';
    more.onclick = loadNextFeedPage;
  }
})();

// Storage helper (compat SDK already loaded on page)
const storage = firebase.storage();

// Wire Share Media
(function wireShareMedia() {
  const btn  = document.getElementById('feed-share-btn');
  const file = document.getElementById('feed-file-input');
  if (!btn || !file) return;

  btn.addEventListener('click', () => {
    if (!window.FEED_STATE.currentPhone) {
      document.getElementById('phone-entry').style.display = 'flex';
      return;
    }
    file.value = '';
    file.click();
  });

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;

    // simple caption prompt for now
    const caption = (prompt('Add a caption (optional):') || '').trim();

    try {
      // 1) Create Firestore doc ID first
      const docRef = db.collection('photos').doc();
      const objectPath = `photos/${docRef.id}_${encodeURIComponent(f.name)}`;
      const storageRef = storage.ref().child(objectPath);

      // 2) Upload file
      await storageRef.put(f);
      const downloadURL = await storageRef.getDownloadURL();

      // 3) Write Firestore doc
      await docRef.set({
        url: downloadURL,
        name: f.name,
        mimeType: f.type || '',
        ownerPhone: window.FEED_STATE.currentPhone || '',
        ownerName:  window.FEED_STATE.currentName  || 'Strangers',
        caption: caption || '',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        deleted: false
      });

      // 4) Optimistically show at top (optional) or just allow it to appear in next page
      alert('Uploaded! It will appear in the feed shortly.');
    } catch (e) {
      console.error('Upload failed', e);
      alert('Upload failed. Please try again.');
    }
  });
})();


let isLoading = false;
async function loadNextFeedPage() {
  if (isLoading) return;
  isLoading = true;
  try {
    const queue = await window.FEED_DATA.buildNextRenderQueuePage();
    if (!queue || queue.length === 0) {
      // Nothing to render right now (e.g. no media to accompany the next event)
      // Gently back off; more media will be fetched on next scroll or manual 'Load More'
      return;
    }
    await window.FEED_RENDER.renderQueue(queue);
  } catch (e) {
    console.error('Feed page load failed', e);
  } finally {
    isLoading = false;
  }
}

function ensureInfiniteScroll() {
  let sentinel = document.getElementById('feed-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'feed-sentinel';
    sentinel.style.height = '1px';
    document.body.appendChild(sentinel);
  }
  const io = new IntersectionObserver(async (entries) => {
    if (entries[0].isIntersecting) await loadNextFeedPage();
  }, { root: null, threshold: 0.1, rootMargin: '300px 0px' });
  io.observe(sentinel);
}
