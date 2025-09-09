// /Qr/feed/js/feed-render.js

(function wireModal() {
  const modal = document.getElementById('simple-modal');
  const close = document.getElementById('simple-modal-close');
  if (close) close.onclick = () => modal.style.display = 'none';
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
})();

function showSimpleModal(innerHtml) {
  const modal = document.getElementById('simple-modal');
  const body  = document.getElementById('simple-modal-body');
  body.innerHTML = innerHtml;
  modal.style.display = 'flex';
}

// Profile link helper (now uses profileId if available)
function profileLinkHtml(name, phone) {
  const safeName = window.FEED_UTILS.esc(name || 'Unknown');
  // Not used directly in likes list anymore – see renderPhotoLikes for custom logic using profileId
  return `<a href="https://portal.fromstrangers.social/profile?id=${encodeURIComponent(phone)}" target="_blank" rel="noopener noreferrer">${safeName}</a>`;
}

function formatEventDate12h(iso='', time='') {
  const ordinal = (n) => { 
    const j=n%10, k=n%100;
    if(k>=11 && k<=13) return n+'th';
    if(j===1) return n+'st'; if(j===2) return n+'nd'; if(j===3) return n+'rd';
    return n+'th';
  };
  let Y,M,D; try { [Y,M,D] = iso.split('-').map(Number); } catch { return ''; }
  const base = new Date(Y, M-1, D);
  let h=0, m=0;
  const m12 = (time||'').match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  const m24 = (time||'').match(/^(\d{1,2}):(\d{2})$/);
  if (m12) {
    h = +m12[1]; m = +m12[2];
    const suf = m12[3].toUpperCase();
    if(suf==='PM' && h<12) h += 12;
    if(suf==='AM' && h===12) h = 0;
  } else if (m24) {
    h = +m24[1]; m = +m24[2];
  }
  const dt = new Date(Y, M-1, D, h, m);
  const w = dt.toLocaleDateString('en-US', { weekday:'long' });
  const mo= dt.toLocaleDateString('en-US', { month:'long' });
  let hh = dt.getHours(); const ampm = hh>=12?'PM':'AM'; hh = hh%12; if(hh===0) hh=12;
  const mm = String(dt.getMinutes()).padStart(2,'0');
  return `${w}, ${mo} ${ordinal(dt.getDate())}, ${dt.getFullYear()} @ ${hh}:${mm} ${ampm}`;
}

// ---------- Event Post Renderer ----------
async function renderEventPost(e) {
  const feed = document.getElementById('feed');
  const when = formatEventDate12h(e.date||'', e.time||'');
  const host = e.host || '';

  const post = document.createElement('article');
  post.className = 'post event';

  // Build inner HTML for event post (no profile picture avatar per design)
  post.innerHTML = `
    <div class="post-header">
      <!-- No avatar for events -->
      <div class="post-user">${window.FEED_UTILS.esc(host || 'Event')}</div>
      <div class="post-date">${window.FEED_UTILS.esc(when + (e.location ? ` • ${e.location}` : ''))}</div>
    </div>
    ${ e.imageUrl ? `
      <div class="post-media">
        ${/\.(mp4|webm|ogg)$/i.test(e.imageUrl)
          ? `<video class="auto-video" muted playsinline loop preload="metadata" src="${e.imageUrl}"></video>`
          : `<img src="${e.imageUrl}" alt="${window.FEED_UTILS.esc(e.title || 'Event')}" />`
        }
      </div>` : '' }
    ${(e.title || e.description) ? `
      <div class="post-caption" style="margin-top:8px;">
        ${e.title ? `<div class="title"><b>${window.FEED_UTILS.esc(e.title)}</b></div>` : ''}
        ${e.description ? `<div class="desc">${window.FEED_UTILS.esc(e.description)}</div>` : ''}
      </div>` : '' }
    <div class="post-actions">
      <div class="rsvp-container" data-eventid="${e.id}">
        <div class="rsvp-button going"><div class="rsvp-circle">✅</div><div class="rsvp-label">Going</div></div>
        <div class="rsvp-button maybe"><div class="rsvp-circle">❓</div><div class="rsvp-label">Maybe</div></div>
        <div class="rsvp-button notgoing"><div class="rsvp-circle">❌</div><div class="rsvp-label">Not Going</div></div>
      </div>
      <div class="rsvp-summary"></div>
      <a class="comment-link" href="/Qr/eventid.html?e=${encodeURIComponent(e.id)}">View event details</a>
    </div>
    <div class="post-comments"></div>
    <div class="add-comment">
      <input type="text" placeholder="Add a comment..." />
      <button>Post</button>
    </div>
  `;

  feed.appendChild(post);

  // Preselect RSVP status and load summary
  await preselectRSVP(e.id, post.querySelector('.rsvp-container'));
  await renderGoingSummary(e.id, post.querySelector('.rsvp-summary'));
  wireRSVPClicks(e.id, post.querySelector('.rsvp-container'), post.querySelector('.rsvp-summary'));

  // Load initial comments preview (latest 3 comments)
  await renderEventComments(e.id, post.querySelector('.post-comments'), 3);

  // Wire up "Add comment" functionality
  const commentInput = post.querySelector('.add-comment input');
  const commentBtn   = post.querySelector('.add-comment button');
  commentBtn.addEventListener('click', async () => {
    if (!window.FEED_STATE.currentPhone) {
      // Not signed in: prompt login
      document.getElementById('phone-entry').style.display = 'flex';
      return;
    }
    const text = commentInput.value.trim();
    if (!text) return;
    try {
      await db.collection('events').doc(e.id).collection('comments').add({
        text: text,
        name: window.FEED_STATE.currentName ? window.FEED_UTILS.esc(window.FEED_STATE.currentName) : 'User',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
      commentInput.value = '';
      // Refresh the comments preview to include the new comment
      await renderEventComments(e.id, post.querySelector('.post-comments'), 3);
    } catch (err) {
      console.error('Failed to post comment', err);
    }
  });
}

// ---------- Photo/Video Post Renderer ----------
async function renderPhotoPost(p) {
  const feed = document.getElementById('feed');
  const isVideo = p.mimeType ? p.mimeType.startsWith('video/') : /\.(mp4|mov|webm|ogg)$/i.test(p.name||'');

  // Carousel of multiple photos (group)
  if (p.type === 'photo-group') {
    const photosOnly = p.media.filter(m => !(m.mimeType?.startsWith('video/') || /\.(mp4|mov|webm|ogg)$/i.test(m.name||'')));
    if (!photosOnly.length) {
      // If group only contains videos, fallback to rendering first video as single post
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

    // Create carousel card
    const card = document.createElement('article');
    card.className = 'post photo';

    const dots   = photosOnly.map((_, i) => `<span class="${i===0?'active':''}"></span>`).join('');
    const slides = photosOnly.map(m => `<img src="${m.url}" alt="${window.FEED_UTILS.esc(m.name || 'Photo')}" />`).join('');

    card.innerHTML = `
      <div class="post-header">
        <img class="avatar" src="../assets/defaultpfp.png" alt="User">
        <div class="post-user">${window.FEED_UTILS.esc(p.ownerName || 'Strangers')}</div>
        <div class="post-sub">${p.ts ? new Date(p.ts).toLocaleString() : ''}</div>
      </div>
      <div class="post-media">
        <div class="carousel-container">
          <div class="carousel-images">${slides}</div>
          <button class="carousel-prev" aria-label="Previous">&#10094;</button>
          <button class="carousel-next" aria-label="Next">&#10095;</button>
          <div class="carousel-indicators">${dots}</div>
        </div>
      </div>
      <div class="post-actions"><div class="likes-count">0 likes</div></div>
      <div class="post-comments"><div class="comment empty">No comments yet</div></div>
      <div class="add-comment">
        <input type="text" placeholder="Add a comment..." />
        <button>Post</button>
      </div>
    `;

    feed.appendChild(card);

    // Populate likes count and open likes modal on click
    await renderPhotoLikes(p.ids[0], card.querySelector('.likes-count'));
    // Initialize carousel controls and indicators
    initCarousels(card);

    // Attach "Add comment" handler
    const input = card.querySelector('.add-comment input');
    const btn   = card.querySelector('.add-comment button');
    btn.addEventListener('click', async () => {
      if (!window.FEED_STATE.currentPhone) {
        document.getElementById('phone-entry').style.display = 'flex';
        return;
      }
      const text = input.value.trim();
      if (!text) return;
      try {
        await db.collection('photos').doc(p.ids[0]).collection('comments').add({
          text: text,
          name: window.FEED_STATE.currentName ? window.FEED_UTILS.esc(window.FEED_STATE.currentName) : 'User',
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        input.value = '';
        // Refresh comments preview on this post (show latest 3)
        await renderPhotoComments(p.ids[0], card.querySelector('.post-comments'), 3);
      } catch (err) {
        console.error('Failed to post comment', err);
      }
    });

    // Fetch profile picture for avatar (if available) and update
    if (p.ownerPhone) {
      try {
        const userSnap = await db.collection('members').doc(p.ownerPhone).get();
        if (userSnap.exists) {
          const data = userSnap.data();
          const avatarImg = card.querySelector('.avatar');
          if (data.profilePic && avatarImg) {
            const pic = data.profilePic;
            // Set avatar image; if `pic` is an URL or base64, use directly, else use thumbnail API
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

    // Mark as viewed and update view count
    const trackId = p.ids[0];
    try {
      const counts = JSON.parse(localStorage.getItem('postViews') || '{}');
      counts[trackId] = (counts[trackId] || 0) + 1;
      localStorage.setItem('postViews', JSON.stringify(counts));
      window.FEED_STATE.viewCounts[trackId] = counts[trackId];
    } catch {}

    return;
  }

  // Single photo or video post
  const card = document.createElement('article');
  card.className = 'post photo';

  card.innerHTML = `
    <div class="post-header">
      <img class="avatar" src="../assets/defaultpfp.png" alt="User">
      <div class="post-user">${window.FEED_UTILS.esc(p.ownerName || 'Strangers')}</div>
      <div class="post-sub">${p.ts ? new Date(p.ts).toLocaleString() : ''}</div>
    </div>
    <div class="post-media">
      ${ isVideo
          ? `<video class="auto-video" muted playsinline loop preload="metadata" src="${p.url}"></video>`
          : `<img src="${p.url}" alt="${window.FEED_UTILS.esc(p.name || 'Photo')}" />`
      }
    </div>
    <div class="post-actions"><div class="likes-count">0 likes</div></div>
    <div class="post-comments"><div class="comment empty">No comments yet</div></div>
    <div class="add-comment">
      <input type="text" placeholder="Add a comment..." />
      <button>Post</button>
    </div>
  `;

  feed.appendChild(card);

  // Load likes count and wire modal open on click
  await renderPhotoLikes(p.id, card.querySelector('.likes-count'));

  // Toggle video sound on tap/click
  const videoEl = card.querySelector('video.auto-video');
  if (videoEl) {
    videoEl.addEventListener('click', () => {
      videoEl.muted = !videoEl.muted;
      if (!videoEl.paused) videoEl.play().catch(()=>{});
    });
  }

  // Attach comment posting behavior
  const input = card.querySelector('.add-comment input');
  const btn   = card.querySelector('.add-comment button');
  btn.addEventListener('click', async () => {
    if (!window.FEED_STATE.currentPhone) {
      document.getElementById('phone-entry').style.display = 'flex';
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    try {
      await db.collection('photos').doc(p.id).collection('comments').add({
        text: text,
        name: window.FEED_STATE.currentName ? window.FEED_UTILS.esc(window.FEED_STATE.currentName) : 'User',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
      input.value = '';
      await renderPhotoComments(p.id, card.querySelector('.post-comments'), 3);
    } catch (err) {
      console.error('Failed to post comment', err);
    }
  });

  // Load and set profile avatar for this post's owner
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

  // Mark this post as viewed and update the view count tracking
  const trackId = p.id;
  try {
    const counts = JSON.parse(localStorage.getItem('postViews') || '{}');
    counts[trackId] = (counts[trackId] || 0) + 1;
    localStorage.setItem('postViews', JSON.stringify(counts));
    window.FEED_STATE.viewCounts[trackId] = counts[trackId];
  } catch {}
}

// ---------- Likes (modal list) ----------
async function renderPhotoLikes(photoId, mount) {
  try {
    const snap = await db.collection('photos').doc(photoId).collection('likes').get();
    const count = snap.size;
    mount.textContent = count ? `${count} like${count > 1 ? 's' : ''}` : '0 likes';
    mount.style.cursor = count ? 'pointer' : 'default';
    mount.onclick = async () => {
      if (!count) return;
      // Re-fetch to get latest likes and user info
      const again = await db.collection('photos').doc(photoId).collection('likes').get();
      const ids   = again.docs.map(d => d.id);
      const members = await Promise.all(ids.map(uid => db.collection('members').doc(uid).get()));
      const listItems = members.map(s => {
        const nm = (s.exists && (s.data().name || s.data().Name)) || 'Unknown';
        const pid = s.exists ? (s.data().profileId || '') : '';
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
        return `<li><a href="${profileHref}" target="_blank" rel="noopener noreferrer"><img src="${avatarUrl}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;margin-right:8px;vertical-align:middle;">${window.FEED_UTILS.esc(nm)}</a></li>`;
      }).join('');
      showSimpleModal(`<h3>People who liked this</h3><ul class="likes-list">${listItems}</ul>`);
    };
  } catch {
    mount.textContent = '0 likes';
  }
}

// ---------- Carousel Setup (with swipe gestures) ----------
function initCarousels(root = document) {
  root.querySelectorAll('.carousel-container').forEach(c => {
    const strip  = c.querySelector('.carousel-images');
    const slides = Array.from(c.querySelectorAll('.carousel-images > *'));
    const dots   = Array.from(c.querySelectorAll('.carousel-indicators span'));
    const prev   = c.querySelector('.carousel-prev');
    const next   = c.querySelector('.carousel-next');
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
    // Touch swipe gestures
    let startX = 0, currentX = 0;
    strip.addEventListener('touchstart', e => { startX = e.touches[0].clientX; currentX = startX; });
    strip.addEventListener('touchmove', e => { currentX = e.touches[0].clientX; });
    strip.addEventListener('touchend', () => {
      if (!startX || !currentX) return;
      const dx = currentX - startX;
      if (Math.abs(dx) > 50) {
        if (dx < 0) show(idx + 1);
        if (dx > 0) show(idx - 1);
      }
      startX = 0; currentX = 0;
    });
    show(0);
  });
}

// ---------- Autoplay/Pause Videos in View (only one at a time) ----------
let videoObserver;
function setupVideoAutoplayObservers() {
  if (!videoObserver) {
    videoObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const video = entry.target;
        if (entry.isIntersecting) {
          // Pause any other videos that might be playing
          document.querySelectorAll('video.auto-video').forEach(v => {
            if (v !== video) v.pause();
          });
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.5, rootMargin: '150px 0px' });
  }
  document.querySelectorAll('video.auto-video').forEach(v => {
    if (!v.dataset._io) {
      videoObserver.observe(v);
      v.dataset._io = '1';
    }
  });
}

// ---------- Render Comments (Event & Photo) ----------
async function renderEventComments(eventId, mountEl, limit = 3) {
  try {
    const snap = await db.collection('events').doc(eventId)
                        .collection('comments')
                        .orderBy('timestamp', 'desc')
                        .limit(20).get();
    const filtered = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => (c.name || '').trim() !== 'User' && !c.system)
      .slice(0, limit)
      .reverse(); // show oldest first among the recent subset
    mountEl.innerHTML = '';
    if (filtered.length === 0) {
      mountEl.innerHTML = `<div class="comment empty">No comments yet</div>`;
      return;
    }
    for (const c of filtered) {
      const commentDiv = document.createElement('div');
      commentDiv.className = 'comment';
      commentDiv.innerHTML = `<b>${window.FEED_UTILS.esc(c.name || 'Unknown')}:</b> ${window.FEED_UTILS.esc(c.text || '')}`;
      mountEl.appendChild(commentDiv);
    }
  } catch {
    mountEl.innerHTML = `<div class="comment empty">No comments yet</div>`;
  }
}

async function renderPhotoComments(photoId, mountEl, limit = 3) {
  try {
    const snap = await db.collection('photos').doc(photoId)
                        .collection('comments')
                        .orderBy('timestamp', 'desc')
                        .limit(20).get();
    const filtered = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => (c.name || '').trim() !== 'User')
      .slice(0, limit)
      .reverse();
    mountEl.innerHTML = '';
    if (filtered.length === 0) {
      mountEl.innerHTML = `<div class="comment empty">No comments yet</div>`;
      return;
    }
    for (const c of filtered) {
      const commentDiv = document.createElement('div');
      commentDiv.className = 'comment';
      commentDiv.innerHTML = `<b>${window.FEED_UTILS.esc(c.name || 'Unknown')}:</b> ${window.FEED_UTILS.esc(c.text || '')}`;
      mountEl.appendChild(commentDiv);
    }
  } catch {
    mountEl.innerHTML = `<div class="comment empty">No comments yet</div>`;
  }
}

// Export renderQueue for feed-core to use
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
