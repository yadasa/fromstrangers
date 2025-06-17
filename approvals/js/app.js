// js/app.js

// 1. Initialize Firebase
if (!window.firebaseConfig) throw new Error("Missing firebaseConfig!");
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

// 2. DOM refs & state
const listEl      = document.getElementById('user-list');
const searchBar   = document.getElementById('searchBar');
const filtersDiv  = document.getElementById('filtersDiv');
const sortSelect  = document.getElementById('sortSelect');
const tabButtons  = document.querySelectorAll('.tab-controls button');

const ageMinInput = document.getElementById('ageMin');
const ageMaxInput = document.getElementById('ageMax');
const ageLabel    = document.getElementById('ageLabel');
const ageSlider   = document.getElementById('ageSlider');

const budMinInput = document.getElementById('budgetMin');
const budMaxInput = document.getElementById('budgetMax');
const budLabel    = document.getElementById('budgetLabel');
const budSlider   = document.getElementById('budgetSlider');

let allUsers      = [];
let currentSort   = 'time_desc';
let activeTab     = 'all';
// dynamic budget range (will be set from Firestore)
let budgetRange   = { min: -5, max: 5 };

// 3. Firestore listener
db.collection('members').onSnapshot(snap => {
  allUsers = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id:         doc.id,
      name:       d.name ?? d.Name ?? 'No Name',
      status:     (d.status || '').toLowerCase() || (d.onList ? 'approved' : 'pending'),
      timestamp:  d.timestamp?.toMillis() || 0,
      phone:      d.phoneNumber || d.phone || '',
      age:        d.age ?? null,
      instagram:  d.instagramHandle || d.instagram || '',
      gender:     d.gender || '',
      employment: d.employment || '',
      budget:     d["vibes"]?.q7 ?? 0,
      sPoints:    d.sPoints || 0
    };
  });

  // determine dynamic budget slider min/max
  const budgets = allUsers.map(u => u.budget).filter(v => typeof v === 'number');
  if (budgets.length) {
    budgetRange.min = Math.min(...budgets);
    budgetRange.max = Math.max(...budgets);
    // apply to inputs
    budMinInput.min = budgetRange.min;
    budMinInput.max = budgetRange.max;
    budMaxInput.min = budgetRange.min;
    budMaxInput.max = budgetRange.max;
    // initialize values at full range
    budMinInput.value = budgetRange.min;
    budMaxInput.value = budgetRange.max;
  }

  populateFilters();
  setupDetailsToggles();
  updateSliders();
  applyFilters();
}, err => {
  console.error(err);
  listEl.innerHTML = '<li class="user-item denied">Error loading users</li>';
});

// 4. Populate checkboxes
function populateFilters() {
  const genders = new Set(), emps = new Set();
  allUsers.forEach(u => {
    if (u.gender)     genders.add(u.gender);
    if (u.employment) emps.add(u.employment);
  });
  fillOpts('genderOptions','gender',[...genders]);
  fillOpts('employmentOptions','employment',[...emps]);
}
function fillOpts(id,name,vals) {
  const c = document.getElementById(id);
  c.innerHTML = '';
  vals.forEach(v => {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" name="${name}" value="${v}"> ${v}`;
    const inp = lbl.querySelector('input');
    inp.addEventListener('change', () => {
      lbl.classList.toggle('selected', inp.checked);
      applyFilters();
    });
    c.append(lbl);
  });
}

// 5. Wire controls
searchBar.addEventListener('input', applyFilters);
filtersDiv.addEventListener('change', applyFilters);
sortSelect.addEventListener('change', e => {
  currentSort = e.target.value;
  applyFilters();
});
tabButtons.forEach(b => {
  b.addEventListener('click', () => {
    tabButtons.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    activeTab = b.dataset.tab;
    applyFilters();
  });
});

// 6. Sliders input → update label, track, filter
[ageMinInput, ageMaxInput].forEach(i =>
  i.addEventListener('input', () => { updateSliders(); applyFilters(); })
);
[budMinInput, budMaxInput].forEach(i =>
  i.addEventListener('input', () => { updateSliders(); applyFilters(); })
);

function updateSliders() {
  // Age
  let a1 = +ageMinInput.value, a2 = +ageMaxInput.value;
  if (a1 > a2) [a1, a2] = [a2, a1];
  ageLabel.textContent = `${a1} – ${a2 === 40 ? '40+' : a2}`;
  colorRange(
    ageSlider,
    +ageMinInput.min, +ageMinInput.max,
    a1, a2,
    '#a69c8b'
  );

  // Budget
  let b1 = +budMinInput.value, b2 = +budMaxInput.value;
  if (b1 > b2) [b1, b2] = [b2, b1];
  // compute displayed range (offset by budgetRange.min) and round to 1 decimal:
  const rawMin = (b1 - budgetRange.min);
  const rawMax = (b2 - budgetRange.min);
  const dispMin = Math.round(rawMin * 10) / 10;
  const dispMax = Math.round(rawMax * 10) / 10;
  budLabel.textContent = `${dispMin} – ${dispMax}`;

  colorRange(
    budSlider,
    budgetRange.min, budgetRange.max,
    b1, b2,
    '#a69c8b'
  );
}


// helper: paints only between thumbs
function colorRange(element, min, max, val1, val2, color) {
  const p1 = ((val1 - min) / (max - min)) * 100;
  const p2 = ((val2 - min) / (max - min)) * 100;
  element.style.background =
    `linear-gradient(to right,
       #ddd 0%, #ddd ${p1}%,
       ${color} ${p1}%, ${color} ${p2}%,
       #ddd ${p2}%, #ddd 100%)`;
}

// 7. Ensure only one details open at a time, animate width
function setupDetailsToggles() {
  document.querySelectorAll('#filtersDiv details').forEach(detail => {
    detail.addEventListener('toggle', () => {
      if (!detail.open) {
        const content = detail.querySelector('.filter-options, .filter-slider');
        if (content) content.style.width = '';
        return;
      }
      // close siblings
      document.querySelectorAll('#filtersDiv details').forEach(d => {
        if (d !== detail && d.open) d.open = false;
      });
      // animate the newly opened panel to 33vw
      const content = detail.querySelector('.filter-options, .filter-slider');
      if (content) {
        content.style.width = '33vw';
      }
    });
  });
}

// 8. Filter → search → sort → render
function applyFilters() {
  let list = [...allUsers];

  // Tab filter (hold includes pending)
  if (activeTab === 'approved')
    list = list.filter(u => u.status === 'approved');
  else if (activeTab === 'hold')
    list = list.filter(u => u.status === 'hold' || u.status === 'pending');
  else if (activeTab === 'denied')
    list = list.filter(u => u.status === 'denied');

  // Checkboxes
  const getChecked = sel =>
    Array.from(document.querySelectorAll(sel))
         .filter(i => i.checked)
         .map(i => i.value);
  const gsel = new Set(getChecked('#genderOptions input'));
  const esel = new Set(getChecked('#employmentOptions input'));
  if (gsel.size) list = list.filter(u => gsel.has(u.gender));
  if (esel.size) list = list.filter(u => esel.has(u.employment));

  // Age slider
  let a1 = +ageMinInput.value, a2 = +ageMaxInput.value;
  if (a1 > a2) [a1, a2] = [a2, a1];
  list = list.filter(u =>
    u.age !== null &&
    (a2 === 40 ? u.age >= a1 : u.age >= a1 && u.age <= a2)
  );

  // Budget slider
  let b1 = +budMinInput.value, b2 = +budMaxInput.value;
  if (b1 > b2) [b1, b2] = [b2, b1];
  list = list.filter(u =>
    u.budget >= b1 &&
    u.budget <= b2
  );

  // Search
  const q = searchBar.value.trim().toLowerCase();
  if (q) {
    const toks = q.split(/\s+/);
    list = list.filter(u => toks.every(t => matchUser(u, t)))
               .sort((a, b) => score(b, toks) - score(a, toks));
  }

  // Sort
  list = sortByOpt(list, currentSort);

  // Render
  listEl.innerHTML = '';
  list.forEach(renderItem);
}
function matchUser(u,t) {
  return [u.name, u.instagram, u.gender, u.employment, String(u.age), u.budget, u.id]
    .some(f => f?.toLowerCase().includes(t));
}
function score(u,toks) {
  let s=0, n=u.name.toLowerCase();
  toks.forEach(t=>{
    if (n.startsWith(t)) s+=3;
    else if (n.includes(t)) s+=2;
    if (u.instagram.toLowerCase().includes(t)) s+=2;
    if (String(u.age)===t) s+=2;
    if (u.employment.toLowerCase().includes(t)) s+=1;
    if (u.gender.toLowerCase().includes(t))     s+=1;
    if (String(u.budget)===t)                   s+=1;
    if (u.id.includes(t))                       s+=1;
  });
  return s;
}

function sortByOpt(list,opt) {
  if(opt==='name_asc')    return [...list].sort((a,b)=>a.name.localeCompare(b.name));
  if(opt==='name_desc')   return [...list].sort((a,b)=>b.name.localeCompare(a.name));
  if(opt==='time_desc')   return [...list].sort((a,b)=>b.timestamp - a.timestamp);
  if(opt==='time_asc')    return [...list].sort((a,b)=>a.timestamp - b.timestamp);
  if(opt==='points_desc') return [...list].sort((a,b)=>b.sPoints - a.sPoints);
  if(opt==='points_asc')  return [...list].sort((a,b)=>a.sPoints - b.sPoints);
  if(opt==='status') {
    const ord={approved:0,hold:1,denied:2,pending:3};
    return [...list].sort((a,b)=> (ord[a.status]||3)-(ord[b.status]||3) );
  }
  return list;
}

function renderItem(u) {
  const li=document.createElement('li');
  li.className=`user-item ${u.status}`;
  li.dataset.id=u.id;

  const top=document.createElement('div'); top.className='user-top';
  const info=document.createElement('span'); info.className='info-icon'; info.textContent='ℹ️';
  const nm=document.createElement('span'); nm.className='name'; nm.textContent=u.name;
  const bd=document.createElement('span'); bd.className='status-label';
  bd.textContent=u.status[0].toUpperCase()+u.status.slice(1);
  top.append(info,nm,bd);

  const btns=document.createElement('div'); btns.className='buttons';
  if(u.status!=='approved'){
    const a=document.createElement('button');a.className='approve';a.textContent='Approve';
    a.onclick=()=>db.collection('members').doc(u.id).update({status:'approved',onList:true});
    btns.append(a);
  }
  if(u.status!=='hold'){
    const h=document.createElement('button');h.className='hold';h.textContent='Hold';
    h.onclick=()=>db.collection('members').doc(u.id).update({status:'hold',onList:false});
    btns.append(h);
  }
  if(u.status!=='denied'){
    const d=document.createElement('button');d.className='deny';d.textContent='Deny';
    d.onclick=()=>db.collection('members').doc(u.id).update({status:'denied',onList:false});
    btns.append(d);
  }
  top.append(btns); li.append(top);

  info.addEventListener('click',()=>{
    const ex=li.querySelector('.extra-details');
    if(ex){ ex.remove(); li.classList.remove('expanded'); }
    else {
      li.classList.add('expanded');
      const e=document.createElement('div'); e.className='extra-details';
      e.innerHTML=`
        <div><strong>Name:</strong> ${u.name}</div>
        <div><strong>ID:</strong> ${u.id}</div>
        <div><strong>Phone:</strong> <a href="tel:${u.id}">${u.id}</a></div>
        <div><strong>Age:</strong> ${u.age??'N/A'}</div>
        <div><strong>Instagram:</strong> ${u.instagram||'N/A'}</div>
        <div><strong>Gender:</strong> ${u.gender||'N/A'}</div>
        <div><strong>Employment:</strong> ${u.employment||'N/A'}</div>
        <div><strong>Budget:</strong> ${u.budget}</div>
        <div><strong>Points:</strong>
          <span class="points">${u.sPoints}</span>
          <input type="number" class="points-input" value="1" min="1" />
          <button class="points-btn decrement">−</button>
          <button class="points-btn increment">+</button>
        </div>
      `;
      const pts=e.querySelector('.points'), inp=e.querySelector('.points-input');
      e.querySelector('.increment').onclick=()=>{ const v=parseInt(inp.value)||1; adjPts(u,+v,pts); };
      e.querySelector('.decrement').onclick=()=>{ const v=parseInt(inp.value)||1; adjPts(u,-v,pts); };
      li.append(e);
    }
  });

  listEl.append(li);
}

async function adjPts(u,day,span){
  try {
    await db.collection('members').doc(u.id)
      .update({sPoints:firebase.firestore.FieldValue.increment(day)});
    u.sPoints+=day; span.textContent=u.sPoints;
    showUndo(`${u.name} ${day>0?'+':''}${day} point`, ()=>undoPts(u.id,-day));
  } catch(e) { console.error(e); }
}
async function undoPts(i,d){
  try {
    await db.collection('members').doc(i)
      .update({sPoints:firebase.firestore.FieldValue.increment(d)});
  } catch(e) { console.error(e); }
}

function showUndo(msg,fn){
  const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
  const b=document.createElement('button'); b.className='undo-btn'; b.textContent='Undo';
  t.append(b); document.body.append(t);
  const to=setTimeout(()=>t.remove(),5000);
  b.onclick=()=>{ clearTimeout(to); t.remove(); fn(); };
}
