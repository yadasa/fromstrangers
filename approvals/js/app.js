// js/app.js

// 1. Initialize Firebase
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig!");
}
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

// 2. DOM refs & state
const listEl      = document.getElementById('user-list');
const searchBar   = document.getElementById('searchBar');
const filtersDiv  = document.getElementById('filtersDiv');
const sortSelect  = document.getElementById('sortSelect');
const tabButtons  = document.querySelectorAll('.tab-controls button');

let allUsers    = [];
let currentSort = 'time_desc';
let activeTab   = 'all';

// 3. Firestore listener
db.collection('members').onSnapshot(snap => {
  allUsers = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id:           doc.id,
      name:         d.name ?? d.Name ?? 'No Name',
      status:       (d.status || '').toLowerCase() || (d.onList ? 'approved' : 'pending'),
      timestamp:    d.timestamp?.toMillis() || 0,
      phone:        d.phoneNumber ?? d.phone ?? '',
      age:          d.age ?? null,
      instagram:    d.instagramHandle ?? d.instagram ?? '',
      gender:       d.gender ?? '',
      neighborhood: d.neighborhood ?? '',
      employment:   d.employment ?? '',
      sPoints:      d.sPoints ?? 0
    };
  });
  populateFilterOptions();
  applySearchAndFilters();
}, err => {
  console.error(err);
  listEl.innerHTML = '<li class="user-item denied">Error loading users</li>';
});

// 4. Populate filter‐checkbox lists
function populateFilterOptions() {
  // Gender & Employment: all unique
  const genders     = new Set(),
        employments = new Set(),
        // Neighborhood: we need top 7
        nbhdCounts  = {};

  allUsers.forEach(u => {
    if (u.gender)     genders.add(u.gender);
    if (u.employment) employments.add(u.employment);
    if (u.neighborhood) {
      nbhdCounts[u.neighborhood] = (nbhdCounts[u.neighborhood]||0) + 1;
    }
  });

  fillCheckboxOptions('genderOptions',     'gender',     Array.from(genders));
  fillCheckboxOptions('employmentOptions', 'employment', Array.from(employments));

  // top-7 neighborhoods by count
  const top7 = Object.entries(nbhdCounts)
    .sort((a,b)=> b[1] - a[1])
    .slice(0,7)
    .map(e=> e[0]);
  fillCheckboxOptions('neighborhoodOptions', 'neighborhood', top7);
}

function fillCheckboxOptions(containerId, name, values) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  values.forEach(v => {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" name="${name}" value="${v}"> ${v}`;
    const input = lbl.querySelector('input');
    // toggle .selected on label
    input.addEventListener('change', () => {
      lbl.classList.toggle('selected', input.checked);
      applySearchAndFilters();
    });
    c.appendChild(lbl);
  });
}

// 5. Wire up controls
searchBar.addEventListener('input', applySearchAndFilters);
filtersDiv.addEventListener('change', applySearchAndFilters);
sortSelect.addEventListener('change', e => {
  currentSort = e.target.value;
  applySearchAndFilters();
});

// Tab buttons
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    applySearchAndFilters();
  });
});

// 6. Filter → Search → Sort → Render
function applySearchAndFilters() {
  let list = [...allUsers];

  // Tab filter
  if (activeTab !== 'all') {
    list = list.filter(u => u.status === activeTab);
  }

  // Checkbox filters
  const getChecked = sel =>
    Array.from(document.querySelectorAll(sel))
      .filter(i => i.checked)
      .map(i => i.value);

  const genderSel       = new Set(getChecked('#genderOptions input'));
  const employmentSel   = new Set(getChecked('#employmentOptions input'));
  const neighborhoodSel = new Set(getChecked('#neighborhoodOptions input'));

  if (genderSel.size)
    list = list.filter(u => genderSel.has(u.gender));
  if (employmentSel.size)
    list = list.filter(u => employmentSel.has(u.employment));
  if (neighborhoodSel.size)
    list = list.filter(u => neighborhoodSel.has(u.neighborhood));

  // Multi‐token search
  const q = searchBar.value.trim().toLowerCase();
  if (q) {
    const tokens = q.split(/\s+/);
    list = list.filter(u => tokens.every(tok => matchesUser(u, tok)));
    list.sort((a,b) => computeRelevance(b, tokens) - computeRelevance(a, tokens));
  }

  // Sort
  list = sortListByOption(list, currentSort);

  // Render
  listEl.innerHTML = '';
  list.forEach(renderItem);
}

// 7. Helpers: search + relevance
function matchesUser(u, tok) {
  return [u.name, u.instagram, u.gender, u.neighborhood, u.employment, String(u.age), u.id]
    .some(f => f?.toLowerCase().includes(tok));
}
function computeRelevance(u, toks) {
  let score = 0, n = u.name.toLowerCase();
  toks.forEach(tok => {
    if (n.startsWith(tok)) score += 3;
    else if (n.includes(tok)) score += 2;
    if (u.instagram.toLowerCase().includes(tok)) score += 2;
    if (String(u.age) === tok) score += 2;
    if (u.employment.toLowerCase().includes(tok)) score += 1;
    if (u.gender.toLowerCase().includes(tok))     score += 1;
    if (u.neighborhood.toLowerCase().includes(tok)) score += 1;
    if (u.id.includes(tok))                       score += 1;
  });
  return score;
}

// 8. Sort helper (now includes status)
function sortListByOption(list, opt) {
  switch(opt) {
    case 'name_asc':    return [...list].sort((a,b)=>a.name.localeCompare(b.name));
    case 'name_desc':   return [...list].sort((a,b)=>b.name.localeCompare(a.name));
    case 'time_asc':    return [...list].sort((a,b)=>a.timestamp - b.timestamp);
    case 'time_desc':   return [...list].sort((a,b)=>b.timestamp - a.timestamp);
    case 'points_asc':  return [...list].sort((a,b)=>a.sPoints - b.sPoints);
    case 'points_desc': return [...list].sort((a,b)=>b.sPoints - a.sPoints);
    case 'status':
      // approved → hold → denied
      const order = { approved: 0, hold: 1, denied: 2, pending: 3 };
      return [...list].sort((a,b) => (order[a.status]||3) - (order[b.status]||3));
    default:
      return list;
  }
}

// 9. Render each user (with “Phone” = clickable ID)
function renderItem(user) {
  const li = document.createElement('li');
  li.className = `user-item ${user.status}`;
  li.dataset.id = user.id;

  // Top row
  const top = document.createElement('div');
  top.className = 'user-top';
  const info  = document.createElement('span');
  info.className = 'info-icon'; info.textContent = 'ℹ️';
  const name  = document.createElement('span');
  name.className = 'name';      name.textContent   = user.name;
  const badge = document.createElement('span');
  badge.className = 'status-label';
  badge.textContent = user.status[0].toUpperCase() + user.status.slice(1);
  top.append(info, name, badge);

  // Action buttons
  const btns = document.createElement('div');
  btns.className = 'buttons';
  if (user.status !== 'approved') {
    const a = document.createElement('button');
    a.className = 'approve'; a.textContent = 'Approve';
    a.onclick = () => db.collection('members').doc(user.id)
                      .update({ status:'approved', onList:true });
    btns.append(a);
  }
  if (user.status !== 'hold') {
    const h = document.createElement('button');
    h.className = 'hold'; h.textContent = 'Hold';
    h.onclick = () => db.collection('members').doc(user.id)
                      .update({ status:'hold', onList:false });
    btns.append(h);
  }
  if (user.status !== 'denied') {
    const d = document.createElement('button');
    d.className = 'deny'; d.textContent = 'Deny';
    d.onclick = () => db.collection('members').doc(user.id)
                      .update({ status:'denied', onList:false });
    btns.append(d);
  }
  top.append(btns);
  li.append(top);

  // Expand/collapse details
  info.addEventListener('click', () => {
    const existing = li.querySelector('.extra-details');
    if (existing) {
      existing.remove();
      li.classList.remove('expanded');
    } else {
      li.classList.add('expanded');
      const ex = document.createElement('div');
      ex.className = 'extra-details';
      ex.innerHTML = `
        <div><strong>Name:</strong> ${user.name}</div>
        <div><strong>ID:</strong> ${user.id}</div>
        <div><strong>Phone:</strong> <a href="tel:${user.id}">${user.id}</a></div>
        <div><strong>Age:</strong> ${user.age ?? 'N/A'}</div>
        <div><strong>Instagram:</strong> ${user.instagram || 'N/A'}</div>
        <div><strong>Gender:</strong> ${user.gender || 'N/A'}</div>
        <div><strong>Neighborhood:</strong> ${user.neighborhood || 'N/A'}</div>
        <div><strong>Employment:</strong> ${user.employment || 'N/A'}</div>
        <div><strong>Points:</strong>
          <span class="points">${user.sPoints}</span>
          <input type="number" class="points-input" value="1" min="1" />
          <button class="points-btn decrement">−</button>
          <button class="points-btn increment">+</button>
        </div>
      `;
      const pts = ex.querySelector('.points');
      const inp = ex.querySelector('.points-input');
      ex.querySelector('.increment').onclick = () => {
        const v = parseInt(inp.value) || 1;
        adjustPoints(user, +v, pts);
      };
      ex.querySelector('.decrement').onclick = () => {
        const v = parseInt(inp.value) || 1;
        adjustPoints(user, -v, pts);
      };
      li.append(ex);
    }
  });

  listEl.append(li);
}

// 10. Points adjustment + undo
async function adjustPoints(user, delta, ptsSpan) {
  try {
    await db.collection('members').doc(user.id)
      .update({ sPoints: firebase.firestore.FieldValue.increment(delta) });
    user.sPoints += delta;
    ptsSpan.textContent = user.sPoints;
    showUndoToast(`${user.name} ${delta>0?'+':''}${delta} point`, () =>
      undoPoints(user.id, -delta)
    );
  } catch(e) { console.error(e); }
}
async function undoPoints(id, delta) {
  try {
    await db.collection('members').doc(id)
      .update({ sPoints: firebase.firestore.FieldValue.increment(delta) });
  } catch(e) { console.error(e); }
}

// 11. Toast
function showUndoToast(msg, onUndo) {
  const t = document.createElement('div');
  t.className='toast'; t.textContent=msg;
  const b = document.createElement('button');
  b.className='undo-btn'; b.textContent='Undo';
  t.append(b); document.body.append(t);
  const to = setTimeout(()=>t.remove(), 5000);
  b.onclick = () => { clearTimeout(to); t.remove(); onUndo(); };
}
