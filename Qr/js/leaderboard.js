// js/leaderboard.js
async function hashHex(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
// --- helper to make a new profileId if none exists ---
async function generateProfileId(phone) {
  const rev = phone.split('').reverse();
  let noise = '';
  for (const d of rev) {
    noise += d + Math.floor(Math.random() * 100).toString().padStart(2, '0');
  }
  const prefix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  // assume hashHex is imported/available in this scope
  return await hashHex(prefix + noise + suffix);
}

document.addEventListener('DOMContentLoaded', () => {
  firebase.initializeApp(window.firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  function loadPhone() {
    try { return localStorage.getItem('userPhone'); } catch {}
    const m = document.cookie.match(/(?:^|; )userPhone=(\d{10})/);
    return m ? m[1] : null;
  }

  auth.onAuthStateChanged(async user => {
    if (!user) return;
    document.getElementById('phone-entry').style.display = 'none';
    document.getElementById('app').style.display = 'block';

    const currentPhone = loadPhone();
    const snap = await db.collection('members')
                         .orderBy('sPoints', 'desc')
                         .get();
    const members = snap.docs.map((d, i) => ({
      phone:     d.id,
      name:      d.data().name,
      sPoints:   d.data().sPoints || 0,
      rank:      i + 1,
      profilePic: d.data().profilePic || null,
      profileId: d.data().profileId || null  // ← may be missing
    }));

    const listEl = document.getElementById('leaderboard-list');
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
      img.style.borderRadius = '50%';
      img.style.marginRight = '8px';
      nameSpan.appendChild(img);
      nameSpan.appendChild(document.createTextNode(`${u.rank}. ${u.name}`));
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
  });

  // rubric modal logic (unchanged) …
  document.getElementById('link-rubric').onclick = async e => {
    e.preventDefault();
    const res = await fetch('rubric.json');
    const data = await res.json();
    const ul = document.getElementById('rubric-list');
    ul.innerHTML = data.map(r =>
      `<li>+${r.points} ${r.description}</li>`
    ).join('');
    document.getElementById('rubric-overlay').style.display = 'flex';
  };
  document.getElementById('rubric-close').onclick = () => {
    document.getElementById('rubric-overlay').style.display = 'none';
  };
});
