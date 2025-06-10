// js/leaderboard.js
document.addEventListener('DOMContentLoaded', () => {
  firebase.initializeApp(window.firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  // reuse your savePhone/loadPhone from app.js
  function loadPhone() {
    try { return localStorage.getItem('userPhone'); } catch {}
    const m = document.cookie.match(/(?:^|; )userPhone=(\d{10})/);
    return m ? m[1] : null;
  }

  // after login (similar to index.js flow)
  auth.onAuthStateChanged(async user => {
    if (!user) return; // show phone-entry first
    document.getElementById('phone-entry').style.display = 'none';
    document.getElementById('app').style.display = 'block';

    const currentPhone = loadPhone();
    // fetch all members sorted by sPoints desc
    const snap = await db.collection('members')
                         .orderBy('sPoints', 'desc')
                         .get();
    const members = snap.docs.map((d,i) => ({
      phone: d.id,
      name: d.data().name,
      sPoints: d.data().sPoints||0,
      rank: i+1
    }));
    const listEl = document.getElementById('leaderboard-list');
    listEl.innerHTML = '';

    // show top 5
    members.slice(0,5).forEach(u => {
      const div = document.createElement('div');
      div.className = `leaderboard-item ${['','first','second','third',''].slice(u.rank, u.rank+1)[0]}`;
      div.innerHTML = `<span>${u.rank}. ${u.name}</span><span>${u.sPoints}</span>`;
      listEl.appendChild(div);
    });

    // find current user
    const meIdx = members.findIndex(u => u.phone===currentPhone);
    if (meIdx > 4) {
      // placeholder
      const ell = document.createElement('div');
      ell.className = 'leaderboard-item placeholder';
      ell.innerHTML = `<span>...</span><span></span>`;
      listEl.appendChild(ell);
      // my row
      const me = members[meIdx];
      const div = document.createElement('div');
      div.className = 'leaderboard-item';
      div.innerHTML = `<span>${me.rank}. ${me.name}</span><span>${me.sPoints}</span>`;
      listEl.appendChild(div);
    }
  });

  // rubric modal logic
  document.getElementById('link-rubric').onclick = async e => {
    e.preventDefault();
    const res = await fetch('rubric.json');
    const data = await res.json();
    const ul = document.getElementById('rubric-list');
    ul.innerHTML = data.map(r =>
      `<li>+${r.points} ${r.description}</li>`
    ).join('');
    document.getElementById('rubric-overlay').style.display='flex';
  };
  document.getElementById('rubric-close').onclick = () => {
    document.getElementById('rubric-overlay').style.display='none';
  };
});
