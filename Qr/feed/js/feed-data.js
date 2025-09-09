// feed/js/feed-data.js

// --- Firebase init (safe if already initialized elsewhere) ---
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

// ----- Public state (read by core & render) -----
window.FEED_STATE = {
  currentPhone: '',
  currentName:  '',
  cursors: {
    events: null,   // last visible event doc
    photos: null    // last visible photo doc
  },
  // in-memory pools to sample from
  pool: {
    futureEvents: [], // future events
    videos: [],       // recent videos
    photos: []        // recent images (grouped carousel-ready)
  }
};

// ----- Constants -----
const THRESHOLD_49_DAYS_MS = 49 * 24 * 60 * 60 * 1000;
const THREE_MIN_MS         = 3 * 60 * 1000;
const PAGE_BATCH_SIZE      = 30;   // prefetch size from each source
const CYCLE_PAGE_SIZE      = 12;   // how many items you render per "page"

// ----- Utils -----
function now() { return Date.now(); }

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
}

function isVideoName(name='') {
  return /\.(mp4|mov|webm|ogg)$/i.test(name);
}

function isVideoMime(mt='') {
  return mt.startsWith('video/');
}

function esc(s='') {
  return String(s).replace(/[&<>"']/g, m => (
    m === '&' ? '&amp;' :
    m === '<' ? '&lt;'  :
    m === '>' ? '&gt;'  :
    m === '"' ? '&quot;': '&#39;'
  ));
}

window.FEED_UTILS = { esc };

// Weighted pick helper: newer items get higher weight (exponential decay)
function weightByRecency(ms, halfLifeDays = 10) {
  const ageDays = Math.max(0, (now() - ms) / (1000*60*60*24));
  const lambda = Math.log(2) / halfLifeDays;
  return Math.exp(-lambda * ageDays);
}

function pickNWeighted(items, n, getWeight=(x)=>1) {
  const pool = [...items];
  const picked = [];
  for (let i=0; i<n && pool.length; i++) {
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
    pool.splice(idx,1);
  }
  return picked;
}

// Group consecutive photos by same owner within 3 minutes into a carousel-ready item
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
      out.push({
        type: 'photo-group',
        ids: bucket.map(b => b.id),
        ownerPhone: first.ownerPhone,
        ownerName: first.ownerName,
        ts: first.ts,
        media: bucket.map(b => ({
          url: b.url, name: b.name, mimeType: b.mimeType, ts: b.ts
        }))
      });
    }
    i = j;
  }
  return out;
}

// ----- Auth bootstrap -----
window.FEED_AUTH_READY = new Promise((resolve) => {
  auth.onAuthStateChanged(async (user) => {
    const st = window.FEED_STATE;
    const signedInEl = document.getElementById('signed-in');
    if (user) {
      st.currentPhone = user.phoneNumber.replace('+1','');
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
        const signInBtn = document.createElement('button');
        signInBtn.textContent = 'Sign In';
        signInBtn.className   = 'btn-header-signin';
        signInBtn.onclick     = () => { document.getElementById('phone-entry').style.display = 'flex'; };
        signedInEl.appendChild(signInBtn);
      }
    }
    resolve();
  });
});

// ----- Fetchers & Pools -----

// Prefetch FUTURE events (by start time if available; fallback createdAt)
async function prefetchFutureEvents(limit = PAGE_BATCH_SIZE) {
  const st = window.FEED_STATE;

  // We’ll fetch by createdAt desc, then filter to future by (date,time).
  let q = db.collection('events').orderBy('createdAt', 'desc').limit(limit);
  if (st.cursors.events) q = q.startAfter(st.cursors.events);
  const snap = await q.get();
  if (!snap.empty) st.cursors.events = snap.docs[snap.docs.length - 1];

  const items = snap.docs.map(d => {
    const e = d.data(); const id = d.id;
    const [Y,M,D] = (e.date||'').split('-').map(Number);
    let ms = toMillis(e.createdAt) || 0;
    if (Y && M && D) {
      let hh=0, mm=0;
      const m12 = (e.time||'').match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
      const m24 = (e.time||'').match(/^(\d{1,2}):(\d{2})$/);
      if (m12) {
        hh = parseInt(m12[1],10); mm = parseInt(m12[2],10);
        const suf = m12[3].toUpperCase(); if (suf==='PM' && hh<12) hh+=12; if (suf==='AM' && hh===12) hh=0;
      } else if (m24) { hh = parseInt(m24[1],10); mm = parseInt(m24[2],10); }
      ms = new Date(Y, M-1, D, hh, mm).getTime();
    }
    return { type:'event', id, ts: ms, ...e };
  }).filter(e => e.ts > now()); // future only

  // push to pool
  window.FEED_STATE.pool.futureEvents.push(...items);
}

// Prefetch recent PHOTOS/VIDEOS (49 days) then split into videos & images; group images for carousel
async function prefetchRecentMedia(limit = PAGE_BATCH_SIZE) {
  const st = window.FEED_STATE;

  let q = db.collection('photos')
    .where('deleted','==',false)
    .orderBy('timestamp','desc')
    .limit(limit);
  if (st.cursors.photos) q = q.startAfter(st.cursors.photos);
  const snap = await q.get();
  if (!snap.empty) st.cursors.photos = snap.docs[snap.docs.length-1];

  const cutoff = now() - THRESHOLD_49_DAYS_MS;
  const raw = snap.docs.map(d => {
    const x = d.data(); const t = toMillis(x.timestamp);
    return {
      id: d.id,
      ownerPhone: x.ownerPhone || '',
      ownerName:  x.ownerName  || 'Strangers',
      url:        x.url,
      name:       x.name || '',
      mimeType:   x.mimeType || '',
      ts:         t
    };
  }).filter(m => m.ts >= cutoff);

  const videos = raw.filter(m => isVideoMime(m.mimeType) || isVideoName(m.name))
                    .map(v => ({ type:'photo', ...v })); // render as "photo" post with <video>

  const images = raw.filter(m => !(isVideoMime(m.mimeType) || isVideoName(m.name)))
                    .sort((a,b)=> b.ts - a.ts);

  const groupedImages = groupPhotosWithinThreeMinutes(images);

  window.FEED_STATE.pool.videos.push(...videos);
  window.FEED_STATE.pool.photos.push(...groupedImages);
}

// Find a “future event the user hasn’t RSVP’d to yet”. Fallback to any future event.
async function pickFutureEventStart() {
  const st = window.FEED_STATE;
  // ensure we have some events prefetched
  if (st.pool.futureEvents.length < 5) {
    await prefetchFutureEvents();
  }
  if (!st.pool.futureEvents.length) return null;

  // Fetch RSVPs for current user (only if logged-in)
  let notRSVPd = [];
  if (st.currentPhone) {
    // Check a handful to avoid many reads
    const sample = st.pool.futureEvents.slice(0, 20);
    const checks = await Promise.all(sample.map(e =>
      db.collection('events').doc(e.id).collection('rsvps').doc(st.currentPhone).get()
    ));
    for (let i=0;i<sample.length;i++){
      if (!checks[i].exists) notRSVPd.push(sample[i]);
    }
  }

  const candidates = (notRSVPd.length ? notRSVPd : st.pool.futureEvents);
  // recency-weighted pick
  const pick = pickNWeighted(candidates, 1, e => weightByRecency(e.ts))[0] || candidates[0];
  // remove from pool so we don’t re-use immediately
  const idx = st.pool.futureEvents.findIndex(x => x.id === pick.id);
  if (idx >= 0) st.pool.futureEvents.splice(idx,1);
  return pick;
}

// Pick 1–3 videos (weighted) and 0–9 images (weighted)
async function pickVideosAndImages() {
  const st = window.FEED_STATE;
  if (st.pool.videos.length < 6 || st.pool.photos.length < 12) {
    await prefetchRecentMedia();
  }

  // 1–3 videos
  const nVid = Math.max(1, Math.min(3, 1 + Math.floor(Math.random()*3))); // 1..3
  const vids = pickNWeighted(st.pool.videos, nVid, v => weightByRecency(v.ts));
  // Remove picks from pool
  vids.forEach(v => {
    const i = st.pool.videos.findIndex(x => x.id === v.id);
    if (i>=0) st.pool.videos.splice(i,1);
  });

  // 0–9 images (carousel items are single picks)
  const nImg = Math.floor(Math.random()*10); // 0..9
  const imgs = pickNWeighted(st.pool.photos, nImg, p => weightByRecency(p.ts));
  imgs.forEach(p => {
    if (p.type === 'photo') {
      const i = st.pool.photos.findIndex(x => x.id === p.id);
      if (i>=0) st.pool.photos.splice(i,1);
    } else if (p.type === 'photo-group') {
      const i = st.pool.photos.findIndex(x => x.ids?.[0] === p.ids?.[0]);
      if (i>=0) st.pool.photos.splice(i,1);
    }
  });

  return { vids, imgs };
}

// Build one “page” queue respecting the pattern and injections
async function buildNextRenderQueuePage() {
  const queue = [];
  // 1) Start with a future event (prefer not-RSVP’d)
  const firstEvent = await pickFutureEventStart();
  if (firstEvent) queue.push(firstEvent);

  // 2) After each event: 1–3 videos then 0–9 images
  const { vids, imgs } = await pickVideosAndImages();
  queue.push(...vids, ...imgs);

  // 3) Inject random media into slot #3 (index 2)
  //   Try to grab a single random video or photo from pools
  const st = window.FEED_STATE;
  if (queue.length >= 2) {
    // make sure we have media to inject
    if (st.pool.videos.length < 3 && st.pool.photos.length < 3) {
      await prefetchRecentMedia();
    }
    const choices = [
      ...(st.pool.videos.slice(0,6)),
      ...(st.pool.photos.slice(0,6))
    ];
    if (choices.length) {
      const inject = pickNWeighted(choices, 1, m => weightByRecency(m.ts))[0];
      // remove from its pool
      if (inject.type === 'photo' && inject.id) {
        const i = st.pool.videos.findIndex(x=>x.id===inject.id);
        if (i>=0) st.pool.videos.splice(i,1);
      } else {
        const idx = st.pool.photos.findIndex(x => (x.id && inject.id && x.id===inject.id) || (x.ids && inject.ids && x.ids[0]===inject.ids[0]));
        if (idx>=0) st.pool.photos.splice(idx,1);
      }
      queue.splice(2, 0, inject); // slot 3
    }
  }

  // 4) Inject vibes slider at slot #7 (index 6)
  const vibe = await window.VIBES_pickRandomUnanswered();
  if (vibe) {
    if (queue.length >= 6) {
      queue.splice(6, 0, { type:'vibe-question', ...vibe });
    } else {
      queue.push({ type:'vibe-question', ...vibe });
    }
  }

  // Only return up to CYCLE_PAGE_SIZE items
  return queue.slice(0, CYCLE_PAGE_SIZE);
}

// ----- Export API -----
window.FEED_DATA = {
  prefetchFutureEvents,
  prefetchRecentMedia,
  buildNextRenderQueuePage
};
