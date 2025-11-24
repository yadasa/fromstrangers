// Qr/feed/js/feed-render.js

(function wireModal() {
  const modal = document.getElementById('simple-modal');
  const close = document.getElementById('simple-modal-close');
  if (close) close.onclick = () => (modal.style.display = 'none');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
})();

function showSimpleModal(innerHtml) {
  const modal = document.getElementById('simple-modal');
  const body = document.getElementById('simple-modal-body');
  body.innerHTML = innerHtml;
  modal.style.display = 'flex';
}

// Show timestamp on non-event posts (photos/videos)?
const SHOW_MEDIA_TIMESTAMP = false;


// (Kept as-is; likes list builds profile links using profileId inside renderPhotoLikes)
function profileLinkHtml(name, phone) {
  const safeName = window.FEED_UTILS.esc(name || 'Unknown');
  return `<a href="https://portal.fromstrangers.social/profile?id=${encodeURIComponent(
    phone
  )}" target="_blank" rel="noopener noreferrer">${safeName}</a>`;
}

function formatEventDate12h(iso = '', time = '') {
  const ordinal = (n) => {
    const j = n % 10,
      k = n % 100;
    if (k >= 11 && k <= 13) return n + 'th';
    if (j === 1) return n + 'st';
    if (j === 2) return n + 'nd';
    if (j === 3) return n + 'rd';
    return n + 'th';
  };
  let Y, M, D;
  try {
    [Y, M, D] = iso.split('-').map(Number);
  } catch {
    return '';
  }
  let h = 0,
    m = 0;
  const m12 = (time || '').match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  const m24 = (time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (m12) {
    h = +m12[1];
    m = +m12[2];
    const suf = m12[3].toUpperCase();
    if (suf === 'PM' && h < 12) h += 12;
    if (suf === 'AM' && h === 12) h = 0;
  } else if (m24) {
    h = +m24[1];
    m = +m24[2];
  }
  const dt = new Date(Y, M - 1, D, h, m);
  const w = dt.toLocaleDateString('en-US', { weekday: 'long' });
  const mo = dt.toLocaleDateString('en-US', { month: 'long' });
  let hh = dt.getHours();
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${w}, ${mo} ${ordinal(dt.getDate())}, ${dt.getFullYear()} @ ${hh}:${mm} ${ampm}`;
}


/* =========================
   EVENT POSTS
   ========================= */
async function renderEventPost(e) {
  const feed = document.getElementById('feed');
  const when = formatEventDate12h(e.date || '', e.time || '');
  const host = e.host || '';

  const post = document.createElement('article');
  post.className = 'post event';

  post.innerHTML = `
    <div class="post-header">
      <!-- No avatar for events -->
      <div class="post-user">${window.FEED_UTILS.esc(host || 'Event')}</div>
      <div class="post-date">${window.FEED_UTILS.esc(
        when + (e.location ? ` • ${e.location}` : '')
      )}</div>
    </div>
    ${
      e.imageUrl
        ? `
      <div class="post-media">
        ${
          /\.(mp4|webm|ogg)$/i.test(e.imageUrl)
            ? `<video class="auto-video" muted playsinline loop preload="metadata" src="${e.imageUrl}"></video>`
            : `<img src="${e.imageUrl}" alt="${window.FEED_UTILS.esc(e.title || 'Event')}" />`
        }
      </div>`
        : ''
    }
    ${
      e.title || e.description
        ? `
      <div class="post-caption" style="margin-top:8px;">
        ${e.title ? `<div class="title"><b>${window.FEED_UTILS.esc(e.title)}</b></div>` : ''}
        ${e.description ? `<div class="desc">${window.FEED_UTILS.esc(e.description)}</div>` : ''}
      </div>`
        : ''
    }
    <div class="post-actions">
      <div class="rsvp-container" data-eventid="${e.id}">
        <div class="rsvp-button going"><div class="rsvp-circle">✅</div><div class="rsvp-label">Going</div></div>
        <div class="rsvp-button maybe"><div class="rsvp-circle">❓</div><div class="rsvp-label">Maybe</div></div>
        <div class="rsvp-button notgoing"><div class="rsvp-circle">❌</div><div class="rsvp-label">Not Going</div></div>
      </div>
      <div class="rsvp-summary"></div>
      <a class="comment-link" href="/events/eventid.html?e=${encodeURIComponent(e.id)}">View event details</a>
    </div>
    <div class="post-comments"></div>
    <div class="add-comment">
      <input type="text" placeholder="Add a comment..." />
      <button>Post</button>
    </div>
  `;

  feed.appendChild(post);

  // RSVP + going summary
  await preselectRSVP(e.id, post.querySelector('.rsvp-container'));
  await renderGoingSummary(e.id, post.querySelector('.rsvp-summary'));
  wireRSVPClicks(e.id, post.querySelector('.rsvp-container'), post.querySelector('.rsvp-summary'));

  // Comments preview
  await renderEventComments(e.id, post.querySelector('.post-comments'), 3);

  // Add comment
  const commentInput = post.querySelector('.add-comment input');
  const commentBtn = post.querySelector('.add-comment button');
  commentBtn.addEventListener('click', async () => {
    if (!window.FEED_STATE.currentPhone) {
      document.getElementById('phone-entry').style.display = 'flex';
      return;
    }
    const text = commentInput.value.trim();
    if (!text) return;
    try {
      await db
        .collection('events')
        .doc(e.id)
        .collection('comments')
        .add({
          text,
          name: window.FEED_STATE.currentName
            ? window.FEED_UTILS.esc(window.FEED_STATE.currentName)
            : 'User',
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        });
      commentInput.value = '';
      await renderEventComments(e.id, post.querySelector('.post-comments'), 3);
    } catch (err) {
      console.error('Failed to post comment', err);
    }
  });
}

async function preselectRSVP(eventId, wrap) {
  const phone = window.FEED_STATE.currentPhone;
  if (!phone) return;
  try {
    const snap = await db.collection('events').doc(eventId).collection('rsvps').doc(phone).get();
    if (!snap.exists) return;
    const st = snap.data().status; // Going | Maybe | NotGoing
    wrap.querySelectorAll('.rsvp-button').forEach((b) => b.classList.remove('active'));
    const sel =
      st === 'Going' ? '.going' : st === 'Maybe' ? '.maybe' : st === 'NotGoing' ? '.notgoing' : null;
    if (sel) wrap.querySelector(sel)?.classList.add('active');
  } catch {}
}

function wireRSVPClicks(eventId, wrap, summaryEl) {
  wrap.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.rsvp-button');
    if (!btn) return;
    if (!window.FEED_STATE.currentPhone) {
      document.getElementById('phone-entry').style.display = 'flex';
      return;
    }
    const status = btn.classList.contains('going')
      ? 'Going'
      : btn.classList.contains('maybe')
      ? 'Maybe'
      : 'NotGoing';
    try {
      await db
        .collection('events')
        .doc(eventId)
        .collection('rsvps')
        .doc(window.FEED_STATE.currentPhone)
        .set({ status, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      wrap.querySelectorAll('.rsvp-button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      await renderGoingSummary(eventId, summaryEl);
    } catch (e) {
      console.error(e);
    }
  });
}

async function renderGoingSummary(eventId, mount) {
  try {
    const snap = await db
      .collection('events')
      .doc(eventId)
      .collection('rsvps')
      .where('status', 'in', ['Going', 'Maybe'])
      .get();
    const ids = snap.docs.map((d) => d.id);
    const total = ids.length;
    if (!total) {
      mount.textContent = 'Be the first to RSVP';
      return;
    }
    const pick = ids[Math.floor(Math.random() * ids.length)];
    const mem = await db.collection('members').doc(pick).get();
    const nm = (mem.exists && (mem.data().name || mem.data().Name)) || 'Someone';

    // Prefer profileId for URL if available (kept behavior elsewhere in likes list too)
    const profileId = mem.exists ? (mem.data().profileId || '') : '';
    const href = profileId ? `/profile?id=${profileId}` : `/profile?id=${pick}`;
    const safe = window.FEED_UTILS.esc(nm);

    mount.innerHTML =
      total === 1
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${safe}</a> is going`
        : `<a href="${href}" target="_blank" rel="noopener noreferrer">${safe}</a> and ${
            total - 1
          } others going`;
  } catch {
    mount.textContent = '';
  }
}

async function renderEventComments(eventId, mount, limit = 3) {
  try {
    const snap = await db
      .collection('events')
      .doc(eventId)
      .collection('comments')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();
    const filtered = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => (c.name || '').trim() !== 'User' && !c.system)
      .slice(0, limit)
      .reverse();
    mount.innerHTML = '';
    if (!filtered.length) {
      mount.innerHTML = `<div class="comment empty">No comments yet</div>`;
      return;
    }
    for (const c of filtered) {
      const row = document.createElement('div');
      row.className = 'comment';
      row.innerHTML = `<b>${window.FEED_UTILS.esc(c.name || 'Unknown')}:</b> ${window.FEED_UTILS.esc(
        c.text || ''
      )}`;
      mount.appendChild(row);
    }
  } catch {
    mount.innerHTML = `<div class="comment empty">No comments yet</div>`;
  }
}

/* =========================
   PHOTO / VIDEO POSTS
   ========================= */
async function renderPhotoPost(p) {
  const feed = document.getElementById('feed');
  const isVideo = p.mimeType
    ? p.mimeType.startsWith('video/')
    : /\.(mp4|mov|webm|ogg)$/i.test(p.name || '');

  // GROUP (carousel)
  if (p.type === 'photo-group') {
    const photosOnly = p.media.filter(
      (m) => !(m.mimeType?.startsWith('video/') || /\.(mp4|mov|webm|ogg)$/i.test(m.name || ''))
    );
    if (!photosOnly.length) {
      // fallback to first item as single
      return renderPhotoPost({
        type: 'photo',
        id: p.ids[0],
        ownerPhone: p.ownerPhone,
        ownerName: p.ownerName,
        url: p.media[0]?.url,
        name: p.media[0]?.name,
        mimeType: p.media[0]?.mimeType,
        ts: p.ts,
        caption: p.caption || '',
      });
    }

    const card = document.createElement('article');
    card.className = 'post photo';

    const dots = photosOnly.map((_, i) => `<span class="${i === 0 ? 'active' : ''}"></span>`).join('');
    const slides = photosOnly
      .map((m) => `<img src="${m.url}" alt="${window.FEED_UTILS.esc(m.name || 'Photo')}" />`)
      .join('');

    card.innerHTML = `
      <div class="post-header">
        <img class="avatar" src="../assets/defaultpfp.png" alt="User">
        <div class="post-user">${window.FEED_UTILS.esc(p.ownerName || 'Strangers')}</div>
        ${SHOW_MEDIA_TIMESTAMP ? `<div class="post-sub">${p.ts ? new Date(p.ts).toLocaleString() : ''}</div>` : ''}

      </div>
      <div class="post-media">
        <div class="carousel-container">
          <div class="carousel-images">${slides}</div>
          <button class="carousel-prev" aria-label="Previous">&#10094;</button>
          <button class="carousel-next" aria-label="Next">&#10095;</button>
          <div class="carousel-indicators">${dots}</div>
        </div>
      </div>
      ${
        p.caption
          ? `<div class="post-caption"><b>${window.FEED_UTILS.esc(
              p.ownerName || 'Strangers'
            )}:</b> ${window.FEED_UTILS.esc(p.caption)}</div>`
          : ''
      }
      <div class="post-actions">
        <button class="photo-like-btn" data-liked="false" aria-label="Like">♡</button>
        <div class="likes-count">0 likes</div>
      </div>
      <div class="post-comments"><div class="comment empty">No comments yet</div></div>
      <div class="add-comment">
        <input type="text" placeholder="Add a comment..." />
        <button>Post</button>
      </div>
    `;
    feed.appendChild(card);

    // Likes count & open list
    await renderPhotoLikes(p.ids[0], card.querySelector('.likes-count'));
    // Carousel (with repeat swipes)
    initCarousels(card);

    // Add comment
    const input = card.querySelector('.add-comment input');
    const btn = card.querySelector('.add-comment button');
    btn.addEventListener('click', async () => {
      if (!window.FEED_STATE.currentPhone) {
        document.getElementById('phone-entry').style.display = 'flex';
        return;
      }
      const text = input.value.trim();
      if (!text) return;
      try {
        await db
          .collection('photos')
          .doc(p.ids[0])
          .collection('comments')
          .add({
            text,
            name: window.FEED_STATE.currentName
              ? window.FEED_UTILS.esc(window.FEED_STATE.currentName)
              : 'User',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          });
        input.value = '';
        await renderPhotoComments(p.ids[0], card.querySelector('.post-comments'), 3);
      } catch (err) {
        console.error('Failed to post comment', err);
      }
    });

    // Avatar (profile pic) load
    if (p.ownerPhone) {
      try {
        const userSnap = await db.collection('members').doc(p.ownerPhone).get();
        if (userSnap.exists) {
          const data = userSnap.data();
          const avatarImg = card.querySelector('.avatar');
          if (data.profilePic && avatarImg) {
            const pic = data.profilePic;
            avatarImg.src = pic;
            avatarImg.onerror = () => {
              avatarImg.onerror = null;
              avatarImg.src = `/api/drive/thumb?id=${encodeURIComponent(pic)}&sz=40`;
            };
          }
        }
      } catch (err) {
        console.warn('Could not load profile pic for', p.ownerPhone, err);
      }
    }

    // Like button + dbltap
    await wireLikeControls(card, p.ids[0]);

    // mark viewed count (so feed can avoid >3)
    trackViewed(p.ids[0]);
    return;
  }

  // SINGLE photo or video
  const card = document.createElement('article');
  card.className = 'post photo';

  card.innerHTML = `
    <div class="post-header">
      <img class="avatar" src="../assets/defaultpfp.png" alt="User">
      <div class="post-user">${window.FEED_UTILS.esc(p.ownerName || 'Strangers')}</div>
      ${SHOW_MEDIA_TIMESTAMP ? `<div class="post-sub">${p.ts ? new Date(p.ts).toLocaleString() : ''}</div>` : ''}

    </div>
    <div class="post-media">
      ${
        isVideo
          ? `<video class="auto-video" muted playsinline loop preload="metadata" src="${p.url}"></video>`
          : `<img src="${p.url}" alt="${window.FEED_UTILS.esc(p.name || 'Photo')}" />`
      }
    </div>
    ${
      p.caption
        ? `<div class="post-caption"><b>${window.FEED_UTILS.esc(
            p.ownerName || 'Strangers'
          )}:</b> ${window.FEED_UTILS.esc(p.caption)}</div>`
        : ''
    }
    <div class="post-actions">
      <button class="photo-like-btn" data-liked="false" aria-label="Like">♡</button>
      <div class="likes-count">0 likes</div>
    </div>
    <div class="post-comments"><div class="comment empty">No comments yet</div></div>
    <div class="add-comment">
      <input type="text" placeholder="Add a comment..." />
      <button>Post</button>
    </div>
  `;
  feed.appendChild(card);

  // Likes count
  await renderPhotoLikes(p.id, card.querySelector('.likes-count'));

  // Toggle sound on click for videos
  const videoEl = card.querySelector('video.auto-video');
  if (videoEl) {
    videoEl.addEventListener('click', () => {
      videoEl.muted = !videoEl.muted;
      if (!videoEl.paused) videoEl.play().catch(() => {});
    });
  }

  // Add comment
  const input = card.querySelector('.add-comment input');
  const btn = card.querySelector('.add-comment button');
  btn.addEventListener('click', async () => {
    if (!window.FEED_STATE.currentPhone) {
      document.getElementById('phone-entry').style.display = 'flex';
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    try {
      await db
        .collection('photos')
        .doc(p.id)
        .collection('comments')
        .add({
          text,
          name: window.FEED_STATE.currentName
            ? window.FEED_UTILS.esc(window.FEED_STATE.currentName)
            : 'User',
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        });
      input.value = '';
      await renderPhotoComments(p.id, card.querySelector('.post-comments'), 3);
    } catch (err) {
      console.error('Failed to post comment', err);
    }
  });

  // Avatar (profile pic)
  if (p.ownerPhone) {
    try {
      const userSnap = await db.collection('members').doc(p.ownerPhone).get();
      if (userSnap.exists) {
        const data = userSnap.data();
        const avatarImg = card.querySelector('.avatar');
        if (data.profilePic && avatarImg) {
          const pic = data.profilePic;
          avatarImg.src = pic;
          avatarImg.onerror = () => {
            avatarImg.onerror = null;
            avatarImg.src = `/api/drive/thumb?id=${encodeURIComponent(pic)}&sz=40`;
          };
        }
      }
    } catch (err) {
      console.warn('Could not load profile pic for', p.ownerPhone, err);
    }
  }

  // Like button + dbltap
  await wireLikeControls(card, p.id);

  // viewed count
  trackViewed(p.id);
}

// like button wiring extracted so we can await inside async functions safely
async function wireLikeControls(card, postId) {
  const likeBtn = card.querySelector('.photo-like-btn');
  const likesCountEl = card.querySelector('.likes-count');
  const mediaEl = card.querySelector('.post-media');

  // initialize liked state
  try {
    if (window.FEED_STATE.currentPhone) {
      const you = await db
        .collection('photos')
        .doc(postId)
        .collection('likes')
        .doc(window.FEED_STATE.currentPhone)
        .get();
      if (you.exists) {
        likeBtn.dataset.liked = 'true';
        likeBtn.textContent = '♥';
        likeBtn.classList.add('liked');
      }
    }
  } catch {}

  likeBtn.addEventListener('click', async () => {
    if (!window.FEED_STATE.currentPhone) {
      document.getElementById('phone-entry').style.display = 'flex';
      return;
    }
    const likesRef = db.collection('photos').doc(postId).collection('likes');
    const me = window.FEED_STATE.currentPhone;
    const isLiked = likeBtn.dataset.liked === 'true';
    try {
      if (isLiked) {
        await likesRef.doc(me).delete();
        likeBtn.dataset.liked = 'false';
        likeBtn.textContent = '♡';
        likeBtn.classList.remove('liked');
      } else {
        await likesRef
          .doc(me)
          .set({ liked: true, ts: firebase.firestore.FieldValue.serverTimestamp() });
        likeBtn.dataset.liked = 'true';
        likeBtn.textContent = '♥';
        likeBtn.classList.add('liked');
      }
      const again = await likesRef.get();
      const count = again.size;
      likesCountEl.textContent = count ? `${count} like${count > 1 ? 's' : ''}` : '0 likes';
    } catch (e) {
      console.error(e);
    }
  });

  // Double-tap/ double-click like (only sets like, does not unlike)
  mediaEl.addEventListener('dblclick', () => {
    if (likeBtn.dataset.liked !== 'true') likeBtn.click();
  });
}

/* =========================
   LIKES LIST MODAL
   ========================= */
async function renderPhotoLikes(photoId, mount) {
  try {
    const snap = await db.collection('photos').doc(photoId).collection('likes').get();
    const count = snap.size;
    mount.textContent = count ? `${count} like${count > 1 ? 's' : ''}` : '0 likes';
    mount.style.cursor = count ? 'pointer' : 'default';
    mount.onclick = async () => {
      if (!count) return;
      const again = await db.collection('photos').doc(photoId).collection('likes').get();
      const ids = again.docs.map((d) => d.id);
      const members = await Promise.all(ids.map((uid) => db.collection('members').doc(uid).get()));
      const listItems = members
        .map((s) => {
          const nm = (s.exists && (s.data().name || s.data().Name)) || 'Unknown';
          const pid = s.exists ? s.data().profileId || '' : '';
          const profileHref = pid ? `/profile?id=${pid}` : `/profile?id=${s.id}`;
          let avatarUrl = '../assets/defaultpfp.png';
          if (s.exists) {
            const pic = s.data().profilePic || '';
            if (pic) {
              if (pic.startsWith('http') || pic.startsWith('data:')) {
                avatarUrl = pic;
              } else {
                avatarUrl = `/api/drive/thumb?id=${encodeURIComponent(pic)}&sz=32`;
              }
            }
          }
          return `<li style="display:flex;align-items:center;gap:10px;margin:.4rem 0;">
            <img src="${avatarUrl}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
            <a href="${profileHref}" target="_blank" rel="noopener noreferrer">${window.FEED_UTILS.esc(
              nm
            )}</a>
          </li>`;
        })
        .join('');
      showSimpleModal(
        `<div style="min-width:260px">
          <h3 style="margin:0 0 8px;font-size:1.05rem;">People who liked this</h3>
          <ul class="likes-list" style="list-style:none;padding:0;margin:0;">${listItems}</ul>
        </div>`
      );
    };
  } catch {
    mount.textContent = '0 likes';
  }
}

/* =========================
   CAROUSEL (with repeated swipes)
   ========================= */
function initCarousels(root = document) {
  root.querySelectorAll('.carousel-container').forEach((c) => {
    const strip = c.querySelector('.carousel-images');
    const slides = Array.from(c.querySelectorAll('.carousel-images > *'));
    const dots = Array.from(c.querySelectorAll('.carousel-indicators span'));
    const prev = c.querySelector('.carousel-prev');
    const next = c.querySelector('.carousel-next');

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

    // touch gestures — support repeated swipes
    let startX = 0,
      currentX = 0,
      dragging = false;
    strip.addEventListener(
      'touchstart',
      (e) => {
        if (!e.touches?.length) return;
        dragging = true;
        startX = e.touches[0].clientX;
        currentX = startX;
      },
      { passive: true }
    );
    strip.addEventListener(
      'touchmove',
      (e) => {
        if (!dragging) return;
        if (!e.touches?.length) return;
        currentX = e.touches[0].clientX;
        // allow multiple swipes
        e.preventDefault();
      },
      { passive: false }
    );
    strip.addEventListener('touchend', () => {
      if (!dragging) return;
      const dx = currentX - startX;
      if (Math.abs(dx) > 50) {
        if (dx < 0) show(idx + 1);
        else show(idx - 1);
      }
      dragging = false;
      startX = 0;
      currentX = 0;
    });

    show(0);
  });
}

/* =========================
   VIDEO AUTOPLAY (only one at a time)
   ========================= */
let videoObserver;
function setupVideoAutoplayObservers() {
  if (!videoObserver) {
    videoObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target;
          if (entry.isIntersecting) {
            // pause others
            document.querySelectorAll('video.auto-video').forEach((v) => {
              if (v !== video) v.pause();
            });
            video.play().catch(() => {});
          } else {
            video.pause();
          }
        });
      },
      { threshold: 0.5, rootMargin: '150px 0px' }
    );
  }
  document.querySelectorAll('video.auto-video').forEach((v) => {
    if (!v.dataset._io) {
      videoObserver.observe(v);
      v.dataset._io = '1';
    }
  });
}

/* =========================
   PHOTO & EVENT COMMENTS (reuse)
   ========================= */
async function renderPhotoComments(photoId, mountEl, limit = 3) {
  try {
    const snap = await db
      .collection('photos')
      .doc(photoId)
      .collection('comments')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();
    const filtered = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => (c.name || '').trim() !== 'User')
      .slice(0, limit)
      .reverse();
    mountEl.innerHTML = '';
    if (!filtered.length) {
      mountEl.innerHTML = `<div class="comment empty">No comments yet</div>`;
      return;
    }
    for (const c of filtered) {
      const commentDiv = document.createElement('div');
      commentDiv.className = 'comment';
      commentDiv.innerHTML = `<b>${window.FEED_UTILS.esc(c.name || 'Unknown')}:</b> ${window.FEED_UTILS.esc(
        c.text || ''
      )}`;
      mountEl.appendChild(commentDiv);
    }
  } catch {
    mountEl.innerHTML = `<div class="comment empty">No comments yet</div>`;
  }
}

/* =========================
   VIEW TRACKING (hide after 3)
   ========================= */
function trackViewed(postId) {
  try {
    const counts = JSON.parse(localStorage.getItem('postViews') || '{}');
    counts[postId] = (counts[postId] || 0) + 1;
    localStorage.setItem('postViews', JSON.stringify(counts));
    window.FEED_STATE.viewCounts[postId] = counts[postId];
  } catch {}
}

/* =========================
   PUBLIC RENDER QUEUE
   ========================= */

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchRandomFallbackPhotos(n = 5) {
  try {
    const base = db.collection('photos').where('deleted', '==', false);
    const [descSnap, ascSnap] = await Promise.all([
      base.orderBy('timestamp', 'desc').limit(50).get(),
      base.orderBy('timestamp', 'asc').limit(50).get()
    ]);

    const take = (snap) => snap.docs.map((d) => {
      const x = d.data();
      const ts = x.timestamp && (x.timestamp.toMillis?.() || (x.timestamp.seconds * 1000)) || 0;
      return {
        type: 'photo',
        id: d.id,
        ownerPhone: x.ownerPhone || '',
        ownerName:  x.ownerName  || 'Strangers',
        url:        x.url,
        name:       x.name || '',
        mimeType:   x.mimeType || '',
        ts,
        caption:    x.caption || ''
      };
    });

    const pool = [...take(descSnap), ...take(ascSnap)];
    shuffleInPlace(pool);
    return pool.slice(0, Math.min(n, pool.length));
  } catch {
    return [];
  }
}

async function renderQueue(items) {
  for (const it of items) {
    if (it.type === 'event') {
      await renderEventPost(it);
    } else if (it.type === 'photo' || it.type === 'photo-group') {
      await renderPhotoPost(it);
    } else if (it.type === 'vibe-question') {
      await window.VIBES_renderCard(it);
    }
  }
  setupVideoAutoplayObservers();
}

window.FEED_RENDER = { renderQueue };
