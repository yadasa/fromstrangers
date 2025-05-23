// js/app.js

// 1. Initialize Firebase using the external config
if (!window.firebaseConfig) {
    throw new Error("Missing firebaseConfig! Make sure js/firebaseConfig.js exists");
  }
  firebase.initializeApp(window.firebaseConfig);
  const db = firebase.firestore();
  
  // 2. DOM ref & state
  const listEl = document.getElementById('user-list');
  let allUsers = [];
  
  // 3. Render the list in the right order
  function renderList() {
    listEl.innerHTML = '';
  
    // Split into onList=false (pending) vs. onList=true (approved)
    const pending  = allUsers.filter(u => !u.onList);
    const approved = allUsers.filter(u => u.onList);
  
    // Render pending first, then approved
    pending.concat(approved).forEach(renderItem);
  }
  
  // 4. Render one user row
  function renderItem(user) {
    const li = document.createElement('li');
    li.className = 'user-item' + (user.onList ? ' approved' : '');
  
    // Details: name and doc ID
    const details = document.createElement('div');
    details.className = 'user-details';
    details.textContent = `${user.name} (${user.id})`;
  
    // Info icon
    const info = document.createElement('span');
    info.className = 'info-icon';
    info.textContent = 'ℹ️';
    info.addEventListener('click', () => {
      alert(JSON.stringify(user, null, 2));
    });
    details.appendChild(info);
  
    // Buttons
    const btns = document.createElement('div');
    btns.className = 'buttons';
  
    // Approve button
    const ok = document.createElement('button');
    ok.className = 'approve';
    ok.textContent = 'Approve';
    ok.onclick = async () => {
      await db.collection('members').doc(user.id)
              .update({ onList: true });
    };
  
    // Deny button (unapprove)
    const no = document.createElement('button');
    no.className = 'deny';
    no.textContent = 'Deny';
    no.onclick = async () => {
      await db.collection('members').doc(user.id)
              .update({ onList: false });
    };
  
    btns.append(ok, no);
    li.append(details, btns);
    listEl.appendChild(li);
  }
  
  // 5. Firestore real-time listener (no filter)
  db.collection('members')
    .onSnapshot(snap => {
      console.log('🔔 total members:', snap.size);
      allUsers = snap.docs.map(doc => {
        const d = doc.data();
        // Normalize onList:
        let onListNorm = false;
        if (typeof d.onList === 'boolean') {
          onListNorm = d.onList;
        } else if (typeof d.onList === 'string') {
          onListNorm = d.onList.toLowerCase() === 'true';
        }
        return {
          id:     doc.id,
          name:   d.name   ?? d.Name   ?? 'No Name',
          onList: onListNorm
        };
      });
      console.log('🔔 pending:', allUsers.filter(u => !u.onList).length,
                  'approved:', allUsers.filter(u => u.onList).length);
      renderList();
    }, err => {
      console.error('Firestore onSnapshot error:', err);
      listEl.innerHTML = '<li class="user-item denied">Error loading users</li>';
    });
  