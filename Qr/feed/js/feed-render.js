// feed/js/feed-render.js


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

function profileLinkHtml(name, phone) {
  const safe = window.FEED_UTILS.esc(name || 'Unknown');
  return `<a href="https://portal.fromstrangers.social/profile?id=${encodeURIComponent(phone)}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
}

function formatEventDate12h(iso='', time='') {
  const ordinal = (n)=>{ const j=n%10,k=n%100;if(k>=11&&k<=13)return n+'th'; if(j===1)return n+'st'; if(j===2)return n+'nd'; if(j===3)return n+'rd'; return n+'th';};
  let Y,M,D; try { [Y,M,D] = iso.split('-').map(Number);} catch { return ''; }
  const base = new Date(Y, M-1, D);
  let h=0,m=0;
  const m12 = (time||'').match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  const m24 = (time||'').match(/^(\d{1,2}):(\d{2})$/);
  if (m12){ h=+m12[1]; m=+m12[2]; const suf=m12[3].toUpperCase(); if(suf==='PM'&&h<12)h+=12; if(suf==='AM'&&h===12)h=0; }
  else if (m24){ h=+m24[1]; m=+m24[2]; }
  const dt = new Date(Y, M-1, D, h, m);
  const w = dt.toLocaleDateString('en-US',{weekday:'long'});
  const mo= dt.toLocaleDateString('en-US',{month:'long'});
  let hh=dt.getHours(); const ampm = hh>=12?'PM':'AM'; hh=hh%12; if(hh===0)hh=12;
  const mm= String(dt.getMinutes()).padStart(2,'0');
  return `${w}, ${mo} ${ordinal(dt.getDate())}, ${dt.getFullYear()} @ ${hh}:${mm} ${ampm}`;
}

// ---------- Event ----------
async function renderEventPost(e) {
  const feed = document.getElementById('feed');
  const when = formatEventDate12h(e.date||'', e.time||'');
  const host = e.host || '';

  const post = document.createElement('article');
  post.className = 'post event';

  post.innerHTML = `
    <div class="post-header">
      <div class="avatar"></div>
      <div class="post-user">${window.FEED_UTILS.esc(host || 'Event')}</div>
      <div class="post-date">${window.FEED_UTILS.esc(when + (e.location ? ` • ${e.location}` : ''))}</div>
    </div>
    ${ e.imageUrl ? `
      <div class="post-media">
        ${/\.(mp4|webm|ogg)$/i.test(e.imageUrl)
          ? `<video class="auto-video" muted playsinline preload="metadata" src="${e.imageUrl}"></video>`
          : `<img src="${e.imageUrl}" alt="${window.FEED_UTILS.esc(e.title || 'Event')}" />`
        }
      </div>` : '' }
    ${ (e.title||e.description) ? `
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
      <a class="comment-link" href="/Qr/eventid.html?e=${encodeURIComponent(e.id)}#comments-section">View comments</a>
    </div>
    <div class="post-comments"></div>
  `;

  feed.appendChild(post);

  // Wire RSVP preselect, summary and clicks
  await preselectRSVP(e.id, post.querySelector('.rsvp-container'));
  await renderGoingSummary(e.id, post.querySelector('.rsvp-summary'));
  wireRSVPClicks(e.id, post.querySelector('.rsvp-container'), post.querySelector('.rsvp-summary'));

  // Load comment preview (filter out name === "User")
  await renderEventComments(e.id, post.querySelector('.post-comments'), 3);
}

async function preselectRSVP(eventId, wrap) {
  const phone = window.FEED_STATE.currentPhone;
  if (!phone) return;
  try {
    const snap = await db.collection('events').doc(eventId).collection('rsvps').doc(phone).get();
    if (!snap.exists) return;
    const st = snap.data().status; // Going | Maybe | NotGoing
    wrap.querySelectorAll('.rsvp-button').forEach(b=>b.classList.remove('active'));
    const sel = st==='Going'?'.going': st==='Maybe'?'.maybe': st==='NotGoing'?'.notgoing': null;
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
    const status = btn.classList.contains('going')?'Going'
                 : btn.classList.contains('maybe')?'Maybe'
                 : 'NotGoing';
    try {
      await db.collection('events').doc(eventId).collection('rsvps').doc(window.FEED_STATE.currentPhone)
        .set({ status, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      wrap.querySelectorAll('.rsvp-button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      await renderGoingSummary(eventId, summaryEl);
    } catch (e) { console.error(e); }
  });
}

async function renderGoingSummary(eventId, mount) {
  try {
    const snap = await db.collection('events').doc(eventId).collection('rsvps')
      .where('status','in',['Going','Maybe']).get();
    const ids = snap.docs.map(d=>d.id);
    const total = ids.length;
    if (!total) { mount.textContent = 'Be the first to RSVP'; return; }
    const pick = ids[Math.floor(Math.random()*ids.length)];
    const mem  = await db.collection('members').doc(pick).get();
    const nm   = (mem.exists && (mem.data().name || mem.data().Name)) || 'Someone';
    mount.innerHTML = total===1
      ? `${profileLinkHtml(nm, pick)} is going`
      : `${profileLinkHtml(nm, pick)} and ${total-1} others going`;
  } catch { mount.textContent = ''; }
}

async function renderEventComments(eventId, mount, limit=3) {
  try {
    const snap = await db.collection('events').doc(eventId)
      .collection('comments').orderBy('timestamp','desc').limit(20).get();
    const filtered = snap.docs.map(d=>({id:d.id, ...d.data()}))
      .filter(c => (c.name||'').trim()!=='User' && !c.system)
      .slice(0, limit).reverse();
    mount.innerHTML = '';
    if (!filtered.length) { mount.innerHTML = `<div class="comment empty">No comments yet</div>`; return; }
    for (const c of filtered) {
      const row = document.createElement('div');
      row.className = 'comment';
      row.innerHTML = `<b>${window.FEED_UTILS.esc(c.name||'Unknown')}:</b> ${window.FEED_UTILS.esc(c.text||'')}`;
      mount.appendChild(row);
    }
  } catch { mount.innerHTML = `<div class="comment empty">No comments yet</div>`; }
}

// ---------- Photo / Video ----------
async function renderPhotoPost(p) {
  const feed = document.getElementById('feed');
  const isVideo = p.mimeType ? p.mimeType.startsWith('video/') : /\.(mp4|mov|webm|ogg)$/i.test(p.name||'');

  // Carousel group?
  if (p.type === 'photo-group') {
    const photosOnly = p.media.filter(m => !(m.mimeType?.startsWith('video/') || /\.(mp4|mov|webm|ogg)$/i.test(m.name||'')));
    if (!photosOnly.length) {
      // fallback: render first item as a single post
      return renderPhotoPost({ type:'photo', id:p.ids[0], ownerPhone:p.ownerPhone, ownerName:p.ownerName, url:p.media[0]?.url, name:p.media[0]?.name, mimeType:p.media[0]?.mimeType, ts:p.ts });
    }

    const card = document.createElement('article');
    card.className = 'post photo';
    const dots = photosOnly.map((_,i)=>`<span class="${i===0?'active':''}"></span>`).join('');
    const slides = photosOnly.map(m=>`<img src="${m.url}" alt="${window.FEED_UTILS.esc(m.name||'Photo')}" />`).join('');

    card.innerHTML = `
      <div class="post-header">
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
    `;
    feed.appendChild(card);
    await renderPhotoLikes(p.ids[0], card.querySelector('.likes-count')); // count by first photo id
    initCarousels(card);
    return;
  }

  // Single photo or video
  const card = document.createElement('article');
  card.className = 'post photo';
  card.innerHTML = `
    <div class="post-header">
      <div class="post-user">${window.FEED_UTILS.esc(p.ownerName || 'Strangers')}</div>
      <div class="post-sub">${p.ts ? new Date(p.ts).toLocaleString() : ''}</div>
    </div>
    <div class="post-media">
      ${ isVideo
        ? `<video class="auto-video" muted playsinline preload="metadata" src="${p.url}"></video>`
        : `<img src="${p.url}" alt="${window.FEED_UTILS.esc(p.name || 'Photo')}" />`
      }
    </div>
    <div class="post-actions"><div class="likes-count">0 likes</div></div>
    <div class="post-comments"><div class="comment empty">No comments yet</div></div>
  `;
  document.getElementById('feed').appendChild(card);

  await renderPhotoLikes(p.id, card.querySelector('.likes-count'));

  // Tap to toggle sound on videos
  const v = card.querySelector('video.auto-video');
  if (v) v.addEventListener('click', () => { v.muted = !v.muted; if (!v.paused) v.play().catch(()=>{}); });
}

async function renderPhotoLikes(photoId, mount) {
  try {
    const snap = await db.collection('photos').doc(photoId).collection('likes').get();
    const count = snap.size;
    mount.textContent = count ? `${count} like${count>1?'s':''}` : '0 likes';
    mount.style.cursor = count ? 'pointer' : 'default';
    mount.onclick = async () => {
      if (!count) return;
      const again = await db.collection('photos').doc(photoId).collection('likes').get();
      const ids = again.docs.map(d=>d.id);
      const members = await Promise.all(ids.map(id => db.collection('members').doc(id).get()));
      const html = members.map(s => {
        const nm = (s.exists && (s.data().name || s.data().Name)) || 'Unknown';
        return `<li>${profileLinkHtml(nm, s.id)}</li>`;
      }).join('');
      showSimpleModal(`<h3>People who liked</h3><ul class="likes-list">${html}</ul>`);
    };
  } catch { mount.textContent = '0 likes'; }
}

// Basic carousel setup (click prev/next/dots)
function initCarousels(root=document) {
  root.querySelectorAll('.carousel-container').forEach(c => {
    const strip = c.querySelector('.carousel-images');
    const slides= Array.from(c.querySelectorAll('.carousel-images > *'));
    const dots  = Array.from(c.querySelectorAll('.carousel-indicators span'));
    const prev  = c.querySelector('.carousel-prev');
    const next  = c.querySelector('.carousel-next');
    let idx=0;
    function show(k){ if(!slides.length) return; idx=(k+slides.length)%slides.length;
      strip.style.transform=`translateX(-${idx*100}%)`;
      dots.forEach((d,i)=>d.classList.toggle('active', i===idx));
    }
    prev?.addEventListener('click', ()=>show(idx-1));
    next?.addEventListener('click', ()=>show(idx+1));
    dots.forEach((d,i)=>d.addEventListener('click', ()=>show(i)));
    show(0);
  });
}

// Autoplay/pause videos in view
let videoObserver;
function setupVideoAutoplayObservers() {
  if (!videoObserver) {
    videoObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const v = entry.target;
        if (entry.isIntersecting) v.play().catch(()=>{});
        else v.pause();
      });
    }, { threshold: 0.5, rootMargin: '150px 0px' });
  }
  document.querySelectorAll('video.auto-video').forEach(v => {
    if (!v.dataset._io) { videoObserver.observe(v); v.dataset._io='1'; }
  });
}

// Render a mixed queue
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
