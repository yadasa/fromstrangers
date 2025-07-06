// js/leaderboard.js

// ─────────────────────────────────────────────────────────────────────────────
// 1) Hash helper (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
async function hashHex(message) {
  const msgBuffer  = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Profile-ID generator helper (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
async function generateProfileId(phone) {
  const rev = phone.split('').reverse();
  let noise = '';
  for (const d of rev) {
    noise += d + Math.floor(Math.random() * 100)
                      .toString()
                      .padStart(2, '0');
  }
  const prefix = Math.floor(Math.random() * 10000)
                     .toString()
                     .padStart(4, '0');
  const suffix = Math.floor(Math.random() * 10000)
                     .toString()
                     .padStart(4, '0');
  return await hashHex(prefix + noise + suffix);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) Login helpers: persist / load phone & name locally
// ─────────────────────────────────────────────────────────────────────────────
function savePhone(phone) {
  try { localStorage.setItem('userPhone', phone); } catch {}
  document.cookie =
    `userPhone=${phone};max-age=${60*60*24*365};path=/;SameSite=Lax`;
}
function loadPhone() {
  try { return localStorage.getItem('userPhone'); } catch {}
  const m = document.cookie.match(/(?:^|; )userPhone=(\d{10})/);
  return m ? m[1] : null;
}
function saveName(name) {
  try { localStorage.setItem('userName', name); } catch {}
}
function loadName() {
  return localStorage.getItem('userName') || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) Pull & render the leaderboard for a given phone
// ─────────────────────────────────────────────────────────────────────────────
async function runLeaderboard(currentPhone) {
  const db   = firebase.firestore();
  const snap = await db.collection('members')
                       .orderBy('sPoints', 'desc')
                       .get();
  const members = snap.docs.map((d, i) => ({
    phone:      d.id,
    name:       d.data().name,
    sPoints:    d.data().sPoints || 0,
    rank:       i +  1,
    profilePic: d.data().profilePic || null,
    profileId:  d.data().profileId  || null
  }));

  const listEl = document.getElementById('leaderboard-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  async function handleNameClick(u) {
    let pid = u.profileId;
    if (!pid) {
      pid = await generateProfileId(u.phone);
      await db.collection('members').doc(u.phone)
              .update({ profileId: pid });
    }
    window.location.href = `/profile?id=${pid}`;
  }

  function makeRow(u, extraClass = '') {
    const div = document.createElement('div');
    div.className = `leaderboard-item ${extraClass}`;

    // avatar + clickable name
    const nameSpan = document.createElement('span');
    nameSpan.style.cursor = 'pointer';
    const img = document.createElement('img');
    img.src = u.profilePic
      ? `/api/drive/thumb?id=${u.profilePic}&sz=32`
      : '../assets/defaultpfp.png';
    img.width = img.height = 32;
    img.style.borderRadius   = '50%';
    img.style.marginRight     = '8px';
    nameSpan.appendChild(img);
    nameSpan.appendChild(
      document.createTextNode(`${u.rank}. ${u.name}`)
    );
    nameSpan.addEventListener('click', () => handleNameClick(u));

    // points
    const ptsSpan = document.createElement('span');
    ptsSpan.textContent = u.sPoints;

    div.appendChild(nameSpan);
    div.appendChild(ptsSpan);
    return div;
  }

  // top 5
  members.slice(0, 5).forEach(u => {
    const cls = ['', 'first', 'second', 'third', ''][u.rank] || '';
    listEl.appendChild(makeRow(u, cls));
  });

  // placeholder + your row if outside top 5
  const meIdx = members.findIndex(u => u.phone === currentPhone);
  if (meIdx > 4) {
    const placeholder = document.createElement('div');
    placeholder.className = 'leaderboard-item placeholder';
    placeholder.innerHTML = `<span>...</span><span></span>`;
    listEl.appendChild(placeholder);
    listEl.appendChild(makeRow(members[meIdx]));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) Main entry: wire up auth + optimistic UI + rubric modal
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!window.firebaseConfig) {
    throw new Error("Missing firebaseConfig");
  }
  firebase.initializeApp(window.firebaseConfig);
  const auth = firebase.auth();

  // 5.1) Don’t block on this—persist session in background
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch(err => console.warn('Auth persistence failed:', err));

  // 5.2) Optimistically restore from localStorage
  const cachedPhone = loadPhone();
  const cachedName  = loadName();
  if (cachedPhone) {
    const phoneEntryEl = document.getElementById('phone-entry');
    if (phoneEntryEl) phoneEntryEl.style.display = 'none';
    const appEl = document.getElementById('app');
    if (appEl)    appEl.style.display         = 'block';
    const nameEl = document.getElementById('user-name');
    if (nameEl)   nameEl.innerText            = cachedName;

    runLeaderboard(cachedPhone);
  }

  // 5.3) React to real auth state changes
  auth.onAuthStateChanged(async user => {
    const phoneEntryEl = document.getElementById('phone-entry');
    const appEl        = document.getElementById('app');
    const nameEl       = document.getElementById('user-name');

    if (!user) {
      // session gone → clear cache & show login
      localStorage.removeItem('userPhone');
      localStorage.removeItem('userName');
      if (appEl)        appEl.style.display         = 'none';
      if (phoneEntryEl) phoneEntryEl.style.display = 'block';
      return;
    }

    // valid session → fetch phone + name
    const phone = user.phoneNumber.replace('+1','');
    savePhone(phone);

    // look up display name
    const db   = firebase.firestore();
    const snap = await db.collection('members').doc(phone).get();
    const name = snap.exists ? snap.data().name : '';
    saveName(name);

    // update UI & run leaderboard
    if (phoneEntryEl) phoneEntryEl.style.display = 'none';
    if (appEl)        appEl.style.display       = 'block';
    if (nameEl)       nameEl.innerText          = name;

    runLeaderboard(phone);
  });

  // 5.4) Rubric modal logic (unchanged)
  const linkRubric = document.getElementById('link-rubric');
  if (linkRubric) {
    linkRubric.onclick = async e => {
      e.preventDefault();
      const res  = await fetch('../rubric.json');
      const data = await res.json();
      const list = document.getElementById('rubric-list');
      if (list) {
        list.innerHTML =
          data.map(r => `<li>+${r.points} ${r.description}</li>`).join('');
      }
      const overlay = document.getElementById('rubric-overlay');
      if (overlay) overlay.style.display = 'flex';
    };
  }
  const closeRubric = document.getElementById('rubric-close');
  if (closeRubric) {
    closeRubric.onclick = () => {
      const overlay = document.getElementById('rubric-overlay');
      if (overlay) overlay.style.display = 'none';
    };
  }
});
