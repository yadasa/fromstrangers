// Qr/feed/js/feed-data.js

(function initFirebase() {
  if (!window.firebaseConfig) return;
  try {
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(window.firebaseConfig);
    }
  } catch (_) {}
})();

const auth = firebase.auth();
const db   = firebase.firestore();

// ----- Public state -----
window.FEED_STATE = {
  currentPhone: '',
  currentName:  '',
  cursors: { events: null, photos: null },
  pool: { futureEvents: [], videos: [], photos: [] },
  viewCounts: {},
  lastRenderedType: null
};

// Load viewed posts count from localStorage (to avoid showing >3 times)
try {
  const storedCounts = JSON.parse(localStorage.getItem('postViews') || '{}');
  window.FEED_STATE.viewCounts = storedCounts;
} catch {
  window.FEED_STATE.viewCounts = {};
}

// ----- Utilities -----
// How many items to return per "page" to the renderer
const CYCLE_PAGE_SIZE = 12;
// Track event spacing across pages:
window.FEED_STATE.sinceLastEvent = 999;

function now() { return Date.now(); }
function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
}
function isVideoName(name='') { return /\.(mp4|mov|webm|ogg)$/i.test(name); }
function isVideoMime(mt='')  { return mt.startsWith('video/'); }
function esc(s='') {
  return String(s).replace(/[&<>"']/g, m => (
    m === '&' ? '&amp;' :
    m === '<' ? '&lt;'  :
    m === '>' ? '&gt;'  :
    m === '"' ? '&quot;': '&#39;'
  ));
}
window.FEED_UTILS = { esc };

// Weighted random helpers...
function weightByRecency(ms, halfLifeDays = 10) {
  const ageDays = Math.max(0, (now() - ms) / (1000*60*60*24));
  const lambda  = Math.log(2) / halfLifeDays;
  return Math.exp(-lambda * ageDays);
}
function pickNWeighted(items, n, getWeight = x => 1) {
  const pool = [...items];
  const picked = [];
  for (let i = 0; i < n && pool.length; i++) {
    const acc = [];
    let sum = 0;
    for (const it of pool) {
      const w = Math.max(0.00001, getWeight(it));
      sum += w;
      acc.push({ it, w, sum });
    }
    const r = Math.random() * sum;
    const hit = acc.find(a => r <= a.sum).it;
    picked.push(hit);
    const idx = pool.indexOf(hit);
    pool.splice(idx, 1);
  }
  return picked;
}

// ----- Auth state -----
window.FEED_AUTH_READY = new Promise(resolve => {
  auth.onAuthStateChanged(async user => {
    const st = window.FEED_STATE;
    const signedInEl = document.getElementById('signed-in');
    if (user) {
      st.currentPhone = user.phoneNumber.replace('+1', '');
      try {
        const snap = await db.collection('members').doc(st.currentPhone).get();
        st.currentName = snap.exists ? (snap.data().name || snap.data().Name || '') : '';
      } catch {}
      if (signedInEl) {
        signedInEl.textContent = st.currentName ? `Signed in as ${st.currentName}` : 'Signed in';
        signedInEl.classList.add('signed-mini');
      }
    } else {
      st.currentPhone = '';
      st.currentName  = '';
      if (signedInEl) {
        signedInEl.innerHTML = '';
        const btn = document.createElement('button');
        btn.textContent = 'Sign In';
        btn.className   = 'btn-header-signin';
        btn.onclick     = () => { document.getElementById('phone-entry').style.display = 'flex'; };
        signedInEl.appendChild(btn);
      }
    }
    resolve();
  });
});

// ----- Prefetch & build feed data -----

// Prefetch recent media (photos/videos)
async function prefetchRecentMedia(limit = 30) {
  const st = window.FEED_STATE;
  let q = db.collection('photos').where('deleted','==',false).orderBy('timestamp','desc').limit(limit);
  if (st.cursors.photos) q = q.startAfter(st.cursors.photos);
  const snap = await q.get();
  if (!snap.empty) st.cursors.photos = snap.docs[snap.docs.length - 1];

  const cutoff = now() - (69 * 24 * 60 * 60 * 1000);  // 49 days
  const raw = snap.docs.map(d => {
    const x = d.data();
    const t = toMillis(x.timestamp);
    return {
      id: d.id,
      ownerPhone: x.ownerPhone || '',
      ownerName:  x.ownerName  || 'Strangers',
      url:        x.url,
      name:       x.name || '',
      mimeType:   x.mimeType || '',
      ts:         t
    };
  }).filter(m => {
    // Only include if within cutoff and not viewed 3+ times by user
    const viewedCount = st.viewCounts[m.id] || 0;
    return (m.ts >= cutoff) && (viewedCount < 3);
  });

  // Separate videos vs images
  const videos = raw.filter(m => isVideoMime(m.mimeType) || isVideoName(m.name))
                    .map(v => ({ type:'photo', ...v }));
  const images = raw.filter(m => !(isVideoMime(m.mimeType) || isVideoName(m.name)))
                    .sort((a, b) => b.ts - a.ts);
  const groupedImages = groupPhotosWithinThreeMinutes(images);

  st.pool.videos.push(...videos);
  st.pool.photos.push(...groupedImages);
}

// Prefetch future events (used for the first feed item)
async function prefetchFutureEvents(limit = 30) {
  const st = window.FEED_STATE;
  let q = db.collection('events').orderBy('createdAt', 'desc').limit(limit);
  if (st.cursors.events) q = q.startAfter(st.cursors.events);
  const snap = await q.get();
  if (!snap.empty) st.cursors.events = snap.docs[snap.docs.length - 1];

  const items = snap.docs.map(d => {
    const e = d.data(); const id = d.id;
    const [Y, M, D] = (e.date || '').split('-').map(Number);
    let ms = toMillis(e.createdAt) || 0;
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
      ms = new Date(Y, M-1, D, hh, mm).getTime();
    }
    return { type: 'event', id, ts: ms || 0, ...e };
  });

  // Only include future events (date/time >= now) or if no date/time provided, include by default
  const nowMs = Date.now();
  const futureEvents = items.filter(ev => {
    if (!ev.date) return true;
    const [Y,M,D] = ev.date.split('-').map(Number);
    const eventTime = ev.time || '';
    let hh=0, mm=0;
    const m12 = eventTime.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    const m24 = eventTime.match(/^(\d{1,2}):(\d{2})$/);
    if (m12) {
      hh = +m12[1]; mm = +m12[2];
      const suf = m12[3].toUpperCase();
      if (suf === 'PM' && hh < 12) hh += 12;
      if (suf === 'AM' && hh === 12) hh = 0;
    } else if (m24) {
      hh = +m24[1]; mm = +m24[2];
    }
    const eventDate = new Date(Y, M-1, D, hh, mm).getTime();
    return eventDate >= nowMs;
  });
  st.pool.futureEvents.push(...futureEvents);
}

// Pick a future event that the user hasn't RSVP'd to (if possible)
async function pickFutureEventStart() {
  const st = window.FEED_STATE;
  if (st.pool.futureEvents.length < 5) {
    await prefetchFutureEvents();
  }
  if (!st.pool.futureEvents.length) return null;

  let notRSVPd = [];
  if (st.currentPhone) {
    // Check up to 20 future events for no RSVP by current user
    const sample = st.pool.futureEvents.slice(0, 20);
    const checks = await Promise.all(sample.map(e =>
      db.collection('events').doc(e.id).collection('rsvps').doc(st.currentPhone).get()
    ));
    for (let i = 0; i < sample.length; i++) {
      if (!checks[i].exists) notRSVPd.push(sample[i]);
    }
  }
  const candidates = notRSVPd.length ? notRSVPd : st.pool.futureEvents;
  const pick = pickNWeighted(candidates, 1, e => weightByRecency(e.ts))[0] || candidates[0];
  // Remove chosen event from pool to avoid immediate reuse
  const idx = st.pool.futureEvents.findIndex(x => x.id === pick.id);
  if (idx >= 0) st.pool.futureEvents.splice(idx, 1);
  return pick;
}

// Pick videos and images for feed page 
async function pickVideosAndImages() {
  const st = window.FEED_STATE;
  // Ensure we have enough in pools
  if (st.pool.videos.length < 6 || st.pool.photos.length < 12) {
    await prefetchRecentMedia();
  }
  // 1–3 videos
  const nVid = Math.max(1, Math.min(3, 1 + Math.floor(Math.random() * 3)));
  const vids = pickNWeighted(st.pool.videos, nVid, v => weightByRecency(v.ts));
  vids.forEach(v => {
    const i = st.pool.videos.findIndex(x => x.id === v.id);
    if (i >= 0) st.pool.videos.splice(i, 1);
  });
  // 0–9 images
  const nImg = Math.floor(Math.random() * 10);
  const imgs = pickNWeighted(st.pool.photos, nImg, p => weightByRecency(p.ts));
  imgs.forEach(p => {
    if (p.type === 'photo') {
      const i = st.pool.photos.findIndex(x => x.id === p.id);
      if (i >= 0) st.pool.photos.splice(i, 1);
    } else if (p.type === 'photo-group') {
      const i = st.pool.photos.findIndex(x => x.ids?.[0] === p.ids?.[0]);
      if (i >= 0) st.pool.photos.splice(i, 1);
    }
  });
  return { vids, imgs };
}

// Group consecutive photos by same owner within 3 minutes (carousel grouping)
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
      Math.abs(photosDesc[j].ts - first.ts) <= 3 * 60 * 1000
    ) {
      bucket.push(photosDesc[j]);
      j++;
    }
    if (bucket.length === 1) {
      out.push({ type: 'photo', ...first });
    } else {
      out.push({
        type: 'photo-group',
        ids: bucket.map(b => b.id),
        ownerPhone: first.ownerPhone,
        ownerName: first.ownerName,
        ts: first.ts,
        media: bucket.map(b => ({ url: b.url, name: b.name, mimeType: b.mimeType, ts: b.ts }))
      });
    }
    i = j;
  }
  return out;
}

// --- ADD this small helper somewhere above buildNextRenderQueuePage (near other helpers) ---
async function ensureSomeMedia(minVideos = 1, minPhotos = 0, maxRetries = 2) {
  const st = window.FEED_STATE;
  let tries = 0;

  while (tries <= maxRetries) {
    const haveVids  = st.pool.videos.length >= minVideos;
    const haveImgs  = st.pool.photos.length >= minPhotos;
    const haveAny   = (st.pool.videos.length + st.pool.photos.length) > 0;

    if ((minVideos === 0 && haveImgs) || (minPhotos === 0 && haveVids) || haveAny) {
      return true;
    }

    // Try to fetch more media
    await prefetchRecentMedia();
    tries++;
  }
  // Still nothing usable
  return (st.pool.videos.length + st.pool.photos.length) > 0;
}

// --- REPLACE your buildNextRenderQueuePage with this version ---
// Build one “page” queue respecting the pattern and injections,
// while preventing back-to-back events across page boundaries.
async function buildNextRenderQueuePage() {
  const st = window.FEED_STATE;
  const queue = [];

  // We require >=7 items between events across page boundaries.
  // If sinceLastEvent < 7, we CANNOT place an event at the top of this page.
  const canPlaceEventNow = st.sinceLastEvent >= 7;

  // 1) Optional event first (only if spacing allows)
  let placedEvent = false;
  if (canPlaceEventNow) {
    const evt = await pickFutureEventStart();
    if (evt) {
      queue.push(evt);
      placedEvent = true;
      st.sinceLastEvent = 0; // just placed one
    }
  }

  // 2) Always add 1–3 videos, then 0–9 images
  const { vids, imgs } = await pickVideosAndImages();
  queue.push(...vids);

  // 3) Inject random media into slot #3 (index 2)
  if (queue.length >= 2) {
    if (st.pool.videos.length < 3 && st.pool.photos.length < 3) {
      await prefetchRecentMedia();
    }
    const choices = [
      ...(st.pool.videos.slice(0, 6)),
      ...(st.pool.photos.slice(0, 6))
    ];
    if (choices.length) {
      const inject = pickNWeighted(choices, 1, m => weightByRecency(m.ts))[0];
      if (inject) {
        // remove from its pool
        if (inject.type === 'photo' && inject.id) {
          const iVid = st.pool.videos.findIndex(x => x.id === inject.id);
          if (iVid >= 0) st.pool.videos.splice(iVid, 1);
          const iImg = st.pool.photos.findIndex(x => x.id === inject.id);
          if (iImg >= 0) st.pool.photos.splice(iImg, 1);
        } else if (inject.type === 'photo-group' && inject.ids?.length) {
          const iGrp = st.pool.photos.findIndex(x => x.ids?.[0] === inject.ids[0]);
          if (iGrp >= 0) st.pool.photos.splice(iGrp, 1);
        }
        queue.splice(2, 0, inject);
      }
    }
  }

  // 4) Then images
  queue.push(...imgs);

  // 5) Vibes slider at slot #7 (index 6)
  if (typeof window.VIBES_pickRandomUnanswered === 'function') {
    const vibe = await window.VIBES_pickRandomUnanswered({ db, phone: st.currentPhone });
    if (vibe) {
      if (queue.length >= 6) queue.splice(6, 0, { type: 'vibe-question', ...vibe });
      else queue.push({ type: 'vibe-question', ...vibe });
    }
  }

  // Enforce that we never add more than one event on this page
  // (we only placed 0 or 1 above), and update spacing tracker for next page.
  const page = queue.slice(0, CYCLE_PAGE_SIZE);

  // Update sinceLastEvent based on what this page contains
  for (const it of page) {
    if (it.type === 'event') {
      st.sinceLastEvent = 0;
    } else {
      st.sinceLastEvent++;
    }
  }

  return page;
}




window.FEED_DATA = {
  prefetchFutureEvents,
  prefetchRecentMedia,
  buildNextRenderQueuePage
};
