// --- Firebase init ---
(function initFirebase() {
  if (!window.firebaseConfig) {
    console.error('Missing firebaseConfig.js');
    return;
  }
  try {
    if (firebase.apps && firebase.apps.length === 0) {
      firebase.initializeApp(window.firebaseConfig);
    } else if (!firebase.apps) {
      firebase.initializeApp(window.firebaseConfig);
    }
  } catch (_) {}
})();

const auth = firebase.auth();
const db   = firebase.firestore();

// --- State ---
let currentPhone = '';
let currentName  = '';

const FEED_PAGE_SIZE = 12;
let feedCursor = { lastEventDoc: null, lastPhotoDoc: null };
let loading = false;

// --- Utilities ---
function ordinal(n) {
  const j = n % 10, k = n % 100;
  if (k >= 11 && k <= 13) return `${n}th`;
  if (j === 1) return `${n}st`;
  if (j === 2) return `${n}nd`;
  if (j === 3) return `${n}rd`;
  return `${n}th`;
}

// Escape user-provided strings before inserting via innerHTML
function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (m) => (
    m === '&' ? '&amp;' :
    m === '<' ? '&lt;'  :
    m === '>' ? '&gt;'  :
    m === '"' ? '&quot;':
               '&#39;'
  ));
}

// Group consecutive photos by the SAME owner within 3 minutes into a single "carousel" item
const THREE_MIN_MS = 3 * 60 * 1000;

/**
 * Input: array of photo docs in *descending* time order (your current query does this).
 * Each item must have: { id, ownerPhone, ownerName, url, name, mimeType?, ts }
 * Output: array where consecutive items from the same owner within 3min are merged:
 *   - { type:'photo-group', ids:[...], ownerPhone, ownerName, ts, media:[{url,name,mimeType,ts}, ...] }
 *   - or single photo stays: { type:'photo', id, ownerPhone, ownerName, url, name, mimeType, ts }
 */
function groupPhotosWithinThreeMinutes(photosDesc) {
  const out = [];
  let i = 0;
  while (i < photosDesc.length) {
    const first = photosDesc[i];
    const bucket = [first];
    let j = i + 1;
    while (
      j < photosDesc.length &&
      photosDesc[j].ownerPhone === first.ownerPhone &&
      Math.abs(photosDesc[j].ts - first.ts) <= THREE_MIN_MS
    ) {
      bucket.push(photosDesc[j]);
      j++;
    }

    if (bucket.length === 1) {
      out.push({ type: 'photo', ...first });
    } else {
      // keep the earliest timestamp of the group to preserve ordering (use first.ts)
      out.push({
        type: 'photo-group',
        ids: bucket.map(b => b.id),
        ownerPhone: first.ownerPhone,
        ownerName: first.ownerName,
        ts: first.ts,
        media: bucket.map(b => ({
          url: b.url,
          name: b.name,
          mimeType: b.mimeType,
          ts: b.ts
        }))
      });
    }
    i = j;
  }
  return out;
}


/** From (YYYY-MM-DD, "HH:MM" or "H:MM AM/PM") -> "Friday, October 24th, 2025 @ 7:00 PM" */
function formatEventDate12h(isoDateStr = '', timeStr = '') {
  let Y, M, D;
  try { [Y, M, D] = isoDateStr.split('-').map(Number); } catch { return ''; }
  const dt = new Date(Y, M - 1, D);
  let hh = 0, mm = 0;

  const m12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  const m24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (m12) {
    hh = parseInt(m12[1], 10);
    mm = parseInt(m12[2], 10);
    const suf = m12[3].toUpperCase();
    if (suf === 'PM' && hh < 12) hh += 12;
    if (suf === 'AM' && hh === 12) hh = 0;
  } else if (m24) {
    hh = parseInt(m24[1], 10);
    mm = parseInt(m24[2], 10);
  }

  const dt2 = new Date(Y, M - 1, D, hh, mm);
  const weekday = dt2.toLocaleDateString('en-US', { weekday: 'long' });
  const month   = dt2.toLocaleDateString('en-US', { month: 'long' });
  const day     = ordinal(dt2.getDate());
  let H = dt2.getHours();
  const ampm = H >= 12 ? 'PM' : 'AM';
  H = H % 12; if (H === 0) H = 12;
  const MM = String(dt2.getMinutes()).padStart(2, '0');
  return `${weekday}, ${month} ${day}, ${dt2.getFullYear()} @ ${H}:${MM} ${ampm}`;
}

function profileLinkHtml(name, phone) {
  const safe = name || 'Unknown';
  return `<a href="https://portal.fromstrangers.social/profile?id=${encodeURIComponent(phone)}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
}

const qs  = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// --- Auth UI ---
auth.onAuthStateChanged(async (user) => {
  const signedIn = qs('#signed-in');
  if (user) {
    currentPhone = user.phoneNumber.replace('+1', '');
    try {
      const snap = await db.collection('members').doc(currentPhone).get();
      currentName = snap.exists ? (snap.data().name || snap.data().Name || '') : '';
    } catch {}
    if (signedIn) {
      signedIn.textContent = currentName ? `Signed in as ${currentName}` : 'Signed in';
    }
  } else {
    currentPhone = '';
    currentName  = '';
    if (signedIn) {
      signedIn.innerHTML = '';
      const btn = document.createElement('button');
      btn.className = 'btn-header-signin';
      btn.textContent = 'Sign In';
      btn.onclick = () => { qs('#phone-entry').style.display = 'flex'; };
      signedIn.appendChild(btn);
    }
  }

  // Initial load + infinite scroll + fallback
  await loadNextFeedPage();
  ensureInfiniteScroll();
  const more = qs('#load-more');
  if (more) more.onclick = loadNextFeedPage;
});

// --- Fetch a mixed page of events + photos ---
async function fetchFeedPage() {
  // Photos (recent)
    let photoQ = db.collection('photos')
    .where('deleted', '==', false)
    .orderBy('timestamp','desc')
    .limit(24);
    if (feedCursor.lastPhotoDoc) photoQ = photoQ.startAfter(feedCursor.lastPhotoDoc);
    const photoSnap = await photoQ.get();
    if (!photoSnap.empty) feedCursor.lastPhotoDoc = photoSnap.docs[photoSnap.docs.length-1];

    // Map raw photos
    const rawPhotos = photoSnap.docs.map(d => {
    const x = d.data();
    return {
        type: 'photo',
        id: d.id,
        ownerPhone: x.ownerPhone || '',
        ownerName:  x.ownerName  || 'Strangers',
        url:        x.url,
        name:       x.name || '',
        mimeType:   x.mimeType || '',
        ts:         x.timestamp?.toMillis?.() || 0
    };
    });

    // Group consecutive photos by same owner within 3 minutes
    const photos = groupPhotosWithinThreeMinutes(rawPhotos);

  // Events (sort by event start if available, fallback to createdAt)
  let eventQ = db.collection('events').orderBy('createdAt', 'desc').limit(24);
  if (feedCursor.lastEventDoc) eventQ = eventQ.startAfter(feedCursor.lastEventDoc);
  const evSnap = await eventQ.get();
  if (!evSnap.empty) feedCursor.lastEventDoc = evSnap.docs[evSnap.docs.length - 1];

  const events = evSnap.docs.map(d => {
    const e = d.data();
    const [Y, M, D] = (e.date || '').split('-').map(Number);
    let ms = e.createdAt?.toMillis?.() || 0;
    if (Y && M && D) {
      let hh = 0, mm = 0;
      const m12 = (e.time || '').match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
      const m24 = (e.time || '').match(/^(\d{1,2}):(\d{2})$/);
      if (m12) {
        hh = parseInt(m12[1], 10); mm = parseInt(m12[2], 10);
        const suf = m12[3].toUpperCase();
        if (suf === 'PM' && hh < 12) hh += 12;
        if (suf === 'AM' && hh === 12) hh = 0;
      } else if (m24) {
        hh = parseInt(m24[1], 10); mm = parseInt(m24[2], 10);
      }
      ms = new Date(Y, M - 1, D, hh, mm).getTime();
    }
    return { type: 'event', id: d.id, ts: ms || 0, ...e };
  });

  // Merge & pick top slice
  return [...events, ...photos].sort((a, b) => b.ts - a.ts).slice(0, FEED_PAGE_SIZE);
}

// --- Load & render page ---
async function loadNextFeedPage() {
  if (loading) return;
  loading = true;
  const items = await fetchFeedPage();
  for (const item of items) {
    if (item.type === 'event') {
      await renderEventPost(item);
    } else {
      await renderPhotoPost(item);
    }
  }
  setupVideoAutoplayObservers();
  loading = false;
}

// --- Render: Event post (uses your CSS classes/IDs) ---
async function renderEventPost(e) {
  const feed = qs('#feed');
  const when = formatEventDate12h(e.date || '', e.time || '');
  const host = e.host || '';

  const post = document.createElement('article');
  post.className = 'post event';

  // Header
  const header = document.createElement('div');
  header.className = 'post-header';

  const avatar = document.createElement('div');
  avatar.className = 'avatar'; // left as plain circle unless you wire profile pics here
  header.appendChild(avatar);

  const userEl = document.createElement('div');
  userEl.className = 'post-user';
  userEl.textContent = host || 'Event';
  header.appendChild(userEl);

  const dateEl = document.createElement('div');
  dateEl.className = 'post-date';
  dateEl.textContent = when + (e.location ? ` • ${e.location}` : '');
  header.appendChild(dateEl);

  post.appendChild(header);

  // Media
  if (e.imageUrl) {
    const media = document.createElement('div');
    media.className = 'post-media';
    if (/\.(mp4|webm|ogg)$/i.test(e.imageUrl)) {
      const v = document.createElement('video');
      v.className = 'auto-video';
      v.muted = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.src = e.imageUrl;
      media.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = e.imageUrl;
      img.alt = e.title || 'Event';
      img.loading = 'lazy';
      media.appendChild(img);
    }
    post.appendChild(media);
  }

  // Caption
  if (e.title || e.description) {
    const cap = document.createElement('div');
    cap.className = 'post-caption';
    cap.innerHTML = `
      ${e.title ? `<div class="title"><b>${esc(e.title)}</b></div>` : ''}
      ${e.description ? `<div class="desc">${esc(e.description)}</div>` : ''}
    `;
    post.appendChild(cap);
  }

  // Actions (RSVP row)
  const actions = document.createElement('div');
  actions.className = 'post-actions';

  const rsvpWrap = document.createElement('div');
  rsvpWrap.className = 'rsvp-container';
  rsvpWrap.setAttribute('data-eventid', e.id);
  rsvpWrap.innerHTML = `
    <div class="rsvp-button going">
      <div class="rsvp-circle">✅</div>
      <div class="rsvp-label">Going</div>
    </div>
    <div class="rsvp-button maybe">
      <div class="rsvp-circle">❓</div>
      <div class="rsvp-label">Maybe</div>
    </div>
    <div class="rsvp-button notgoing">
      <div class="rsvp-circle">❌</div>
      <div class="rsvp-label">Not Going</div>
    </div>
  `;
  actions.appendChild(rsvpWrap);

  const summary = document.createElement('div');
  summary.className = 'rsvp-summary';
  actions.appendChild(summary);

  const viewLink = document.createElement('a');
  viewLink.className = 'comment-link';
  viewLink.href = `/Qr/eventid.html?e=${encodeURIComponent(e.id)}#comments-section`;
  viewLink.textContent = 'View comments';
  actions.appendChild(viewLink);

  post.appendChild(actions);

  // Comments preview
  const comments = document.createElement('div');
  comments.className = 'post-comments';
  post.appendChild(comments);

  // Append to feed
  feed.appendChild(post);

  // Wire RSVP preselect + summary + click
  await preselectRSVP(e.id, rsvpWrap);
  await renderGoingSummary(e.id, summary);
  wireRSVPClicks(e.id, rsvpWrap, summary);

  // Comments (filter out name === "User")
  await renderEventComments(e.id, comments, 3);
}

// --- Render: Photo post (uses your CSS classes/IDs) ---
async function renderPhotoPost(p) {
  const feed = qs('#feed');

  // Normal single photo (possibly a video)
  if (p.type === 'photo') {
    const isVideo = p.mimeType
      ? p.mimeType.startsWith('video/')
      : /\.(mp4|mov|webm|ogg)$/i.test(p.name || '');

    const card = document.createElement('article');
    card.className = 'post photo';

    card.innerHTML = `
      <header class="post-header">
        <div class="post-user">${p.ownerName || 'Strangers'}</div>
        <div class="post-sub">${p.ts ? new Date(p.ts).toLocaleString() : ''}</div>
      </header>

      <div class="post-media">
        ${
          isVideo
            ? `<video class="auto-video" muted playsinline preload="metadata" src="${p.url}"></video>`
            : `<img src="${p.url}" alt="${(p.name || 'Photo')}" />`
        }
      </div>

      <div class="post-actions">
        <div class="likes-count">0 likes</div>
      </div>

      <div class="post-comments"><div class="comment empty">No comments yet</div></div>
    `;

    feed.appendChild(card);

    // Likes + modal
    await renderPhotoLikes(p.id, qs('.likes-count', card));

    // Allow tapping video to toggle sound
    const v = card.querySelector('video.auto-video');
    if (v) {
      v.addEventListener('click', () => {
        v.muted = !v.muted;
        if (!v.paused) v.play().catch(()=>{});
      });
    }
    return;
  }

  // Grouped carousel of photos (and ignore videos for carousel)
  if (p.type === 'photo-group') {
    const mediaItems = p.media.filter(m => {
      const isVid = m.mimeType ? m.mimeType.startsWith('video/') :
        /\.(mp4|mov|webm|ogg)$/i.test(m.name || '');
      return !isVid; // only photos in carousel; videos render as single posts elsewhere
    });

    // if (somehow) only videos, fallback to single style for first:
    if (!mediaItems.length) {
      return renderPhotoPost({
        type: 'photo',
        id: p.ids[0],
        ownerPhone: p.ownerPhone,
        ownerName: p.ownerName,
        url: p.media[0]?.url,
        name: p.media[0]?.name,
        mimeType: p.media[0]?.mimeType,
        ts: p.ts
      });
    }

    const card = document.createElement('article');
    card.className = 'post photo';

    const dots = mediaItems.map((_, i) =>
      `<span class="${i === 0 ? 'active' : ''}"></span>`
    ).join('');

    const slides = mediaItems.map(m =>
      `<img src="${m.url}" alt="${m.name || 'Photo'}" />`
    ).join('');

    card.innerHTML = `
      <header class="post-header">
        <div class="post-user">${p.ownerName || 'Strangers'}</div>
        <div class="post-sub">${p.ts ? new Date(p.ts).toLocaleString() : ''}</div>
      </header>

      <div class="post-media">
        <div class="carousel-container">
          <div class="carousel-images">
            ${slides}
          </div>
          <button class="carousel-prev" aria-label="Previous">&#10094;</button>
          <button class="carousel-next" aria-label="Next">&#10095;</button>
          <div class="carousel-indicators">${dots}</div>
        </div>
      </div>

      <div class="post-actions">
        <div class="likes-count">0 likes</div>
      </div>

      <div class="post-comments"><div class="comment empty">No comments yet</div></div>
    `;

    feed.appendChild(card);

    // You can count likes using the first photo id in the group (simplest)
    await renderPhotoLikes(p.ids[0], qs('.likes-count', card));

    // Initialize this carousel
    initCarousels(card);
  }
}


// --- RSVP helpers ---
async function preselectRSVP(eventId, wrapEl) {
  if (!currentPhone) return;
  try {
    const r = await db.collection('events').doc(eventId)
      .collection('rsvps').doc(currentPhone).get();
    if (!r.exists) return;
    const st = r.data().status; // "Going" | "Maybe" | "NotGoing"
    qsa('.rsvp-button', wrapEl).forEach(b => b.classList.remove('active'));
    const sel =
      st === 'Going'    ? '.going' :
      st === 'Maybe'    ? '.maybe' :
      st === 'NotGoing' ? '.notgoing' : null;
    if (sel) qs(sel, wrapEl)?.classList.add('active');
  } catch {}
}

function wireRSVPClicks(eventId, wrapEl, summaryEl) {
  wrapEl.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.rsvp-button');
    if (!btn) return;
    if (!currentPhone) { qs('#phone-entry').style.display = 'flex'; return; }

    const status =
      btn.classList.contains('going')    ? 'Going' :
      btn.classList.contains('maybe')    ? 'Maybe' :
      btn.classList.contains('notgoing') ? 'NotGoing' : null;
    if (!status) return;

    try {
      await db.collection('events').doc(eventId)
        .collection('rsvps').doc(currentPhone)
        .set({ status, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });

      qsa('.rsvp-button', wrapEl).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      await renderGoingSummary(eventId, summaryEl);
    } catch (e) {
      console.error('RSVP failed', e);
    }
  });
}

async function renderGoingSummary(eventId, mountEl) {
  try {
    const snap = await db.collection('events').doc(eventId)
      .collection('rsvps').where('status', 'in', ['Going', 'Maybe']).get();
    const ids = snap.docs.map(d => d.id);
    const total = ids.length;
    if (total === 0) { mountEl.textContent = 'Be the first to RSVP'; return; }

    const pick = ids[Math.floor(Math.random() * ids.length)];
    const mem  = await db.collection('members').doc(pick).get();
    const nm   = (mem.exists && (mem.data().name || mem.data().Name)) || 'Someone';
    mountEl.innerHTML = total === 1
      ? `${profileLinkHtml(nm, pick)} is going`
      : `${profileLinkHtml(nm, pick)} and ${total - 1} others going`;
  } catch {
    mountEl.textContent = '';
  }
}

// --- Event comments preview (filters out name === "User") ---
async function renderEventComments(eventId, mountEl, limit = 3) {
  try {
    const snap = await db.collection('events').doc(eventId)
      .collection('comments').orderBy('timestamp', 'desc').limit(20).get(); // overfetch to allow filtering
    const filtered = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => (c.name || '').trim() !== 'User' && !c.system)
      .slice(0, limit)
      .reverse(); // oldest first in preview

    mountEl.innerHTML = '';
    if (filtered.length === 0) {
      mountEl.innerHTML = `<div class="comment empty">No comments yet</div>`;
      return;
    }
    for (const c of filtered) {
      const row = document.createElement('div');
      row.className = 'comment';
      row.innerHTML = `<b>${(c.name || 'Unknown')}:</b> ${(c.text || '').replace(/</g, '&lt;')}`;
      mountEl.appendChild(row);
    }
  } catch {
    mountEl.innerHTML = `<div class="comment empty">No comments yet</div>`;
  }
}

// --- Photo likes (modal list) ---
async function renderPhotoLikes(photoId, mountEl) {
  try {
    const snap = await db.collection('photos').doc(photoId).collection('likes').get();
    const count = snap.size;
    mountEl.textContent = count > 0 ? `${count} like${count > 1 ? 's' : ''}` : '0 likes';
    mountEl.style.cursor = count ? 'pointer' : 'default';

    mountEl.onclick = async () => {
      if (count === 0) return;
      const again = await db.collection('photos').doc(photoId).collection('likes').get();
      const ids = again.docs.map(d => d.id);
      const members = await Promise.all(ids.map(id => db.collection('members').doc(id).get()));
      const html = members.map(s => {
        const nm = (s.exists && (s.data().name || s.data().Name)) || 'Unknown';
        return `<li>${profileLinkHtml(nm, s.id)}</li>`;
      }).join('');
      showSimpleModal(`<h3>People who liked</h3><ul class="likes-list">${html}</ul>`);
    };
  } catch {
    mountEl.textContent = '0 likes';
  }
}

// --- Simple modal ---
function showSimpleModal(innerHtml) {
  const modal = qs('#simple-modal');
  const body  = qs('#simple-modal-body');
  body.innerHTML = innerHtml;
  modal.style.display = 'flex';
}
(function wireSimpleModal() {
  const modal = qs('#simple-modal');
  const close = qs('#simple-modal-close');
  if (close) close.onclick = () => modal.style.display = 'none';
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
})();

// --- Video autoplay in viewport ---
let videoObserver;
function setupVideoAutoplayObservers() {
  if (!videoObserver) {
    videoObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const v = entry.target;
        if (entry.isIntersecting) {
          v.play().catch(()=>{});
        } else {
          v.pause();
        }
      });
    }, { threshold: 0.5, rootMargin: '150px 0px' }); // begin just before fully visible
  }
  qsa('video.auto-video').forEach(v => {
    if (!v.dataset._io) {
        videoObserver.observe(v);
        v.dataset._io = '1';
    }
  });
}

function initCarousels(root = document) {
  const carousels = root.querySelectorAll('.carousel-container');
  carousels.forEach(carousel => {
    const strip = carousel.querySelector('.carousel-images');
    const slides = Array.from(carousel.querySelectorAll('.carousel-images > *'));
    const dots = Array.from(carousel.querySelectorAll('.carousel-indicators span'));
    const prev = carousel.querySelector('.carousel-prev');
    const next = carousel.querySelector('.carousel-next');
    let idx = 0;

    function show(k) {
      if (!slides.length) return;
      idx = (k + slides.length) % slides.length;
      strip.style.transform = `translateX(-${idx * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    }

    prev?.addEventListener('click', () => show(idx - 1));
    next?.addEventListener('click', () => show(idx + 1));
    dots.forEach((d, i) => d.addEventListener('click', () => show(i)));

    show(0);
  });
}


// --- Infinite scroll + fallback button ---
function ensureInfiniteScroll() {
  let sentinel = document.getElementById('feed-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'feed-sentinel';
    sentinel.style.height = '1px';
    document.body.appendChild(sentinel);
  }
  const io = new IntersectionObserver(async (entries) => {
    if (entries[0].isIntersecting) {
      await loadNextFeedPage();
    }
  }, { root: null, threshold: 0.1, rootMargin: '300px 0px' });
  io.observe(sentinel);

  // Show fallback button
  const more = qs('#load-more');
  more.style.display = 'block';
}
