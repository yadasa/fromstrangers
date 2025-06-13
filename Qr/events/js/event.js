// events/js/event.js

// 1. Initialize Firebase
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig.js");
}
firebase.initializeApp(window.firebaseConfig);
const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();

// If we’re on localhost, point to the emulators, not prod
if (location.hostname === 'localhost') {
  // Firestore emulator
  firebase.firestore().useEmulator('127.0.0.1', 8080);
  // Functions emulator
  firebase.functions().useEmulator('127.0.0.1', 5001);
}


// ─────────────────────────────────────────────────────────────────────
// INITIATE INVISIBLE RECAPTCHA FOR PHONE AUTH
// ─────────────────────────────────────────────────────────────────────
async function initRecaptcha() {
  // If an older verifier exists, clear it first
  if (window.recaptchaVerifier) {
    try {
      window.recaptchaVerifier.clear();
    } catch (_e) { /* ignore any errors */ }
  }

  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier(
    'recaptcha-container',
    {
      size: 'invisible',
      callback: (token) => {
        console.log('reCAPTCHA solved, token:', token);
      },
      'expired-callback': () => {
        console.warn('reCAPTCHA expired; re-initializing');
        initRecaptcha();
      }
    }
  );

  // Render the invisible widget
  await window.recaptchaVerifier.render();
  // Immediately verify so that a token is ready when we call signInWithPhoneNumber
  await window.recaptchaVerifier.verify();
}


/**
 * Given a day‐of‐month integer (1–31), returns the appropriate English
 * ordinal suffix (1st, 2nd, 3rd, 4th, …).
 */
function getOrdinalSuffix(day) {
  const j = day % 10,
        k = day % 100;
  if (k >= 11 && k <= 13) {
    return 'th';
  }
  if (j === 1) {
    return 'st';
  }
  if (j === 2) {
    return 'nd';
  }
  if (j === 3) {
    return 'rd';
  }
  return 'th';
}

/**
 * Takes a date‐string in "YYYY-MM-DD" form and returns a human‐friendly
 * string like "Saturday, August 2nd, 2025".
 */
function formatEventDate(isoDateStr) {
  const [year, month, day] = isoDateStr.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  const weekday  = dt.toLocaleDateString('en-US', { weekday: 'long' });
  const monthName = dt.toLocaleDateString('en-US', { month: 'long' });
  const dayNum   = dt.getDate();
  const ordinal  = getOrdinalSuffix(dayNum);
  return `${weekday}, ${monthName} ${dayNum}${ordinal}, ${year}`;
}

// 2. Session persistence (phone in localStorage/cookie)
function savePhone(phone) {
  try { localStorage.setItem('userPhone', phone); } catch {}
  document.cookie = `userPhone=${phone};max-age=${60*60*24*365};path=/;SameSite=Lax`;
}
function loadPhone() {
  try { return localStorage.getItem('userPhone'); } catch {}
  const m = document.cookie.match(/(?:^|; )userPhone=(\d{10})/);
  return m ? m[1] : null;
}

// 3. Parse event ID from URL
let eventId = null;
const params = new URLSearchParams(window.location.search);
if (params.has('e')) {
  eventId = params.get('e');
}
if (!eventId) {
  console.warn("No eventId in URL. Click 'Create Dummy Event' to make one.");
}

// 3a. Parse referral token if present
let referrerPhone = null;
if (params.has('ref')) {
  const refToken = params.get('ref');
  const stripped = refToken.slice(4, -4);
  const reversedHash = stripped.split('').reverse().join('');
  db.collection('members').where('hashedPhone', '==', reversedHash).get()
    .then(refSnap => {
      if (!refSnap.empty) {
        referrerPhone = refSnap.docs[0].id;
      }
    })
    .catch(err => console.error('Referral lookup failed:', err));
}

let currentPhone = '';
let currentName  = '';
let isFirstLogin = true;

// 4. Attach event listeners on DOMContentLoaded
let currentGifTarget = null; 
document.addEventListener('DOMContentLoaded', () => {
  // 4a) Always show #app immediately
  document.getElementById('app').style.display = 'block';

  // 4b) Auto‐login if phone saved
  (async () => {
    const saved = loadPhone();
    if (!saved) return;
    try {
      const snap = await db.collection('members').doc(saved).get();
      if (!snap.exists) return;
      const data = snap.data();
      //if (!data.onList) return;
      currentPhone = saved;
      currentName  = data.name || data.Name || 'No Name';
      isFirstLogin = false;
      document.getElementById('signed-in').innerText = `Signed in as ${currentName}`;
      document.getElementById('phone-entry').style.display = 'none';
      unlockCommentsAndRSVP();
      await loadEventData();
    } catch (e) {
      console.error('Auto-resume failed', e);
    }
  })();

  // ─────────────────────────────────────────────────────────────────────
  // 4c) PHONE SUBMISSION → SEND SMS (REAL FLOW)
  // ─────────────────────────────────────────────────────────────────────
  const skipSMS = false;

  document.getElementById('phone-submit').onclick = async () => {
    // 1) Normalize phone: strip non-digits, drop leading '1' if present
    let raw = document.getElementById('phone-input').value.replace(/\D/g, '');
    if (raw.length === 11 && raw.startsWith('1')) {
      raw = raw.slice(1);
    }
    if (raw.length !== 10) {
      alert('Enter a valid 10-digit phone.');
      return;
    }

    // 2) If we ever want to skip SMS in dev, we could keep old logic here.
    //    But now skipSMS=false, so we always go to the OTP flow below.

    // 3) INITIATE reCAPTCHA
    try {
      await initRecaptcha();
    } catch (err) {
      console.error('Error initializing reCAPTCHA:', err);
      alert('reCAPTCHA setup failed; reload and try again.');
      return;
    }

    // 4) CALL Firebase PHONE AUTH
    try {
      const confirmation = await auth.signInWithPhoneNumber(
        '+1' + raw,
        window.recaptchaVerifier
      );
      // Store the confirmation object so otp-submit can use it
      window.confirmationResult = confirmation;

      // 5) SHOW the previously‐hidden OTP input group
      document.getElementById('otp-entry').style.display = 'block';
    } catch (err) {
      console.error('signInWithPhoneNumber error:', err);
      if (err.code === 'auth/invalid-app-credential') {
        alert('reCAPTCHA token invalid/expired; please try again.');
      } else {
        alert('SMS not sent: ' + err.message);
      }
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // 4c-2) VERIFY OTP CODE
  // ─────────────────────────────────────────────────────────────────────
  document.getElementById('otp-submit').onclick = async () => {
    const code = document.getElementById('otp-input').value.trim();
    if (code.length !== 6) {
      alert('Enter the 6-digit code.');
      return;
    }

    try {
      // 1) CONFIRM the OTP with Firebase
      const cred = await window.confirmationResult.confirm(code);
      const user = cred.user; // e.g. { phoneNumber: "+11234567890", … }
      // Strip the "+1" to get "1234567890"
      const phoneDigits = user.phoneNumber.replace('+1', '');
      currentPhone = phoneDigits;

      // 2) SAVE to localStorage + cookie so next visit auto-resumes
      savePhone(currentPhone);

      // 3) LOOK UP Firestore “members/<phone>” to confirm onList
      const snap = await db.collection('members').doc(currentPhone).get();
      if (!snap.exists) {
        alert('No membership record found. Please sign up first.');
        return;
      }
      const data = snap.data();
      //if (!data.onList) {
        //alert('Your membership is not approved yet.');
        //return;
      //}

      // 4) SET currentName + hide login overlay + show main app
      currentName = data.name || data.Name || 'No Name';
      isFirstLogin = false;
      document.getElementById('signed-in').innerText = `Signed in as ${currentName}`;
      document.getElementById('phone-entry').style.display = 'none';
      unlockCommentsAndRSVP();
      await loadEventData();
    } catch (err) {
      console.error('OTP confirm error:', err);
      alert('Code incorrect: ' + err.message);
    }
  };



  // 4d) Create Dummy Event (temporary)
  document.getElementById('btn-create-dummy').onclick = async () => {
    if (!eventId) {
      const newDocRef = db.collection('events').doc();
      eventId = newDocRef.id;
    }
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const creator = currentPhone || 'unknown';

    const dummy = {
      title: "Sample Event",
      host: currentName || "Strangers",
      imageUrl: "https://via.placeholder.com/600x200.png?text=Dummy+Event",
      date: "2025-06-20",
      time: "7:00 PM",
      location: "123 Main Street",
      description: "This is a dummy event description.\nAdd multiline text here.",
      calendarLink: "https://example.com/dummy.ics",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: creator
    };

    try {
      await db.collection('events').doc(eventId).set(dummy);
      alert("Dummy event created at events/" + eventId);
      window.location.search = "?e=" + encodeURIComponent(eventId);
    } catch (err) {
      console.error("Failed to create dummy event at events/" + eventId, err);
      alert("Error creating dummy event.");
    }
  };

  // 4e) Giphy modal open/close (main comment)
  document.getElementById('btn-giphy-open').onclick = () => {
    currentGifTarget = document.getElementById('comment-input');
    document.getElementById('giphy-modal').style.display = 'flex';
    document.getElementById('giphy-search-input').value = '';
    document.getElementById('giphy-results').innerHTML = '';
  };
  document.getElementById('giphy-close').onclick = () => {
    document.getElementById('giphy-modal').style.display = 'none';
    currentGifTarget = null;
  };
  document.getElementById('giphy-search-input').onkeyup = async (e) => {
    if (e.key === 'Enter') {
      const query = e.target.value.trim();
      if (!query) return;
      await searchGiphy(query);
    }
  };

  // 4f) Image upload icon triggers file input for main comment
  document.getElementById('btn-image-upload').onclick = () => {
    const mainContent = document.getElementById('comment-input');
    if (mainContent.querySelector('img[data-giphy]')) {
      alert("You may only add either images or a single GIF per comment.");
      return;
    }
    document.getElementById('comment-file-input').click();
  };
  document.getElementById('comment-file-input').onchange = () => {
    const mainContent = document.getElementById('comment-input');
    if (mainContent.querySelector('img[data-giphy]')) {
      alert("You already inserted a GIF; remove it before uploading images.");
      document.getElementById('comment-file-input').value = '';
      return;
    }
  };

  // 4g) Post comment button (gated by login)
  document.getElementById('btn-post-comment').onclick = async () => {
    if (!currentPhone) {
      document.getElementById('phone-entry').style.display = 'flex';
      return;
    }
    await submitComment();
  };

  // 4h) See All modal logic (unchanged)
  document.getElementById('btn-see-all').onclick = () => {
    showSeeAllModal('Going');
  };
  document.getElementById('see-all-close').onclick = () => {
    document.getElementById('see-all-modal').style.display = 'none';
  };
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.onclick = async (e) => {
      document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const status = e.currentTarget.getAttribute('data-status');
      await populateSeeAllList(status);
    };
  });

  // 4i) Comments “Sign In” overlay button
  document.getElementById('comments-signin-btn').onclick = () => {
    document.getElementById('phone-entry').style.display = 'flex';
  };
});

// 5. When the user logs in, remove blur/overlay and enable RSVP/comments
function unlockCommentsAndRSVP() {
  // Hide the comments overlay
  const overlay = document.getElementById('comments-blur-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }

  // Show reply widget
  document.getElementById('comment-widget').style.display = 'block';

  // Load comments and set up RSVP
  loadComments();
  setupRSVPButtons();
  loadRSVPList();
}

// 6. Load event data and initialize UI (always runs after login or manually called)
async function loadEventData() {
  if (!eventId) return;

  // 6a. If logged in, check admin flag (members/{phone})
  if (currentPhone) {
    try {
      const userSnap = await db.collection('members').doc(currentPhone).get();
      if (userSnap.exists && userSnap.data().isAdmin === true) {
        document.getElementById('btn-create-event').style.display = 'inline-block';
      }
    } catch (err) {
      console.error('Error checking admin flag:', err);
    }
  }

  // 6b. Wire up “Create Event” button & modal
  document.getElementById('btn-create-event')
    .addEventListener('click', () => {
      document.getElementById('event-modal').style.display = 'flex';
    });
  document.getElementById('event-modal-close')
    .addEventListener('click', () => {
      document.getElementById('event-modal').style.display = 'none';
    });
  document.getElementById('event-modal')
    .addEventListener('click', (e) => {
      if (e.target.id === 'event-modal') {
        document.getElementById('event-modal').style.display = 'none';
      }
    });

  // 6c. Fetch event document
  const eventSnap = await db.collection('events').doc(eventId).get();
  if (!eventSnap.exists) {
    alert("Event not found.");
    return;
  }
  const e = eventSnap.data();

  // Title, host
  document.getElementById('event-title').innerText = e.title || 'Untitled Event';
  if (e.createdBy) {
    const creatorSnap = await db.collection('members').doc(e.createdBy).get();
    if (creatorSnap.exists) {
      const cData = creatorSnap.data();
      document.getElementById('event-host').innerText =
        'Hosted by ' + (cData.name || cData.Name || 'Strangers');
    } else {
      document.getElementById('event-host').innerText =
        'Hosted by ' + (e.host || 'Strangers');
    }
  } else {
    document.getElementById('event-host').innerText =
      'Hosted by ' + (e.host || 'Strangers');
  }

  // Image & dynamic gradient + meta tags
  if (e.imageUrl) {
    const eventImageEl = document.getElementById('event-image');

    // Dynamic background gradient once the image loads
    eventImageEl.onload = () => {
      try {
        const colorThief = new ColorThief();
        const palette = colorThief.getPalette(eventImageEl, 5);
        const top4 = palette.slice(0, 4).map(
          (c) => `rgb(${c[0]},${c[1]},${c[2]})`
        );
        const gradient = `linear-gradient(to right, ${top4.join(', ')})`;
        const appEl = document.getElementById('app');
        appEl.style.setProperty('--event-gradient', gradient);
        appEl.classList.add('event-gradient-active');
      } catch (err) {
        console.error('Gradient extraction failed:', err);
      }
    };

    // Set image and meta tags
    eventImageEl.src = e.imageUrl;
    document.title = e.title || 'Event Page';
    document.getElementById('page-title').innerText = e.title || 'Event Page';
    document.querySelector("meta[property='og:title']")
      .setAttribute("content", e.title || '');
    document.querySelector("meta[property='og:image']")
      .setAttribute("content", e.imageUrl);
  }

  // Date & time
  if (e.date) {
    document.getElementById('event-date').innerText = formatEventDate(e.date);
  }
  if (e.time) {
    document.getElementById('event-time').innerText = e.time;
  }

  // Location & description
  document.getElementById('event-location').innerText    = e.location || '';
  document.getElementById('event-description').innerText = e.description || '';

  // Calendar & share logic
  setupCalendarAndShare(e);

  // Load guest list preview
  await loadGuestListPreview();

  // Wire up “Pay Now” button
  document.getElementById('btn-pay').onclick = () => {
    if (!currentPhone) {
      document.getElementById('phone-entry').style.display = 'flex';
      return;
    }
    showTicketModal();
  };
  document.getElementById('ticket-modal-close').onclick = () => {
    document.getElementById('ticket-modal').style.display = 'none';
  };

  // 6d. Dynamic “Add/Remove Ticket Option” for Create Event form
  const ticketContainer = document.getElementById('ticket-options-container');
  const addTicketBtn   = document.getElementById('add-ticket-option');

  function createTicketRow() {
    const template = ticketContainer.querySelector('.ticket-row-input');
    const newRow   = template.cloneNode(true);
    newRow.querySelector('.ticket-name').value = '';
    newRow.querySelector('.ticket-desc').value = '';
    newRow.querySelector('.ticket-price').value = '';
    newRow.querySelector('.ticket-link').value = '';

    const removeBtn = newRow.querySelector('.remove-ticket');
    removeBtn.addEventListener('click', () => {
      const rows = ticketContainer.querySelectorAll('.ticket-row-input');
      if (rows.length > 1) {
        newRow.remove();
      } else {
        newRow.querySelector('.ticket-name').value = '';
        newRow.querySelector('.ticket-desc').value = '';
        newRow.querySelector('.ticket-price').value = '';
        newRow.querySelector('.ticket-link').value = '';
      }
    });

    return newRow;
  }

  addTicketBtn.addEventListener('click', () => {
    const newTicketRow = createTicketRow();
    ticketContainer.appendChild(newTicketRow);
  });

  ticketContainer.querySelector('.ticket-row-input .remove-ticket')
    .addEventListener('click', (e) => {
      const rows = ticketContainer.querySelectorAll('.ticket-row-input');
      const rowNode = e.currentTarget.closest('.ticket-row-input');
      if (rows.length > 1) {
        rowNode.remove();
      } else {
        rowNode.querySelector('.ticket-name').value = '';
        rowNode.querySelector('.ticket-desc').value = '';
        rowNode.querySelector('.ticket-price').value = '';
        rowNode.querySelector('.ticket-link').value = '';
      }
    });

  // 6e. Create Event form submission
  document.getElementById('create-event-form')
    .addEventListener('submit', (e) => {
      e.preventDefault();

      // Collect event fields
      const name        = document.getElementById('new-event-name').value.trim();
      const date        = document.getElementById('new-event-date').value;
      const time        = document.getElementById('new-event-time').value;
      const address     = document.getElementById('new-event-address').value.trim();
      const description = document.getElementById('new-event-description').value.trim();
      const imageLink   = document.getElementById('new-event-image').value.trim();

      if (!name || !date || !time || !address || !description || !imageLink) {
        alert('Please fill in all event fields.');
        return;
      }

      // Collect ticket options
      const ticketRows = ticketContainer.querySelectorAll('.ticket-row-input');
      const tickets    = [];
      ticketRows.forEach(row => {
        const tName  = row.querySelector('.ticket-name').value.trim();
        const tDesc  = row.querySelector('.ticket-desc').value.trim();
        const tPrice = parseFloat(row.querySelector('.ticket-price').value);
        const tLink  = row.querySelector('.ticket-link').value.trim();
        if (tName && tDesc && !isNaN(tPrice) && tLink) {
          tickets.push({ name: tName, description: tDesc, price: tPrice, paymentlink: tLink });
        }
      });

      db.collection('events')
        .add({
          title:        name,
          host:         currentName || '',
          imageUrl:     imageLink,
          date:         date,
          time:         time,
          location:     address,
          description:  description,
          calendarLink: '',
          createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
          createdBy:    currentPhone
        })
        .then(docRef => {
          const newEventId = docRef.id;
          const batch = db.batch();
          tickets.forEach(t => {
            const ticketDocRef = db
              .collection('events')
              .doc(newEventId)
              .collection('tickets')
              .doc();
            batch.set(ticketDocRef, {
              name:        t.name,
              description: t.description,
              price:       t.price,
              paymentlink: t.paymentlink
            });
          });
          return batch.commit().then(() => newEventId);
        })
        .then(newEventId => {
          alert('Event and tickets created successfully!');
          document.getElementById('event-modal').style.display = 'none';
        })
        .catch(err => {
          console.error('Error creating event or tickets:', err);
          alert('Failed to create event. Check console for details.');
        });
    });
}

// 7. Load Guest List Preview
async function loadGuestListPreview() {
  const listContainer = document.getElementById('guest-list-preview');
  listContainer.innerHTML = '';
  const rsvpsSnap = await db.collection('events')
    .doc(eventId)
    .collection('rsvps')
    .where('status', 'in', ['Going', 'Maybe'])
    .get();
  const allDocs = rsvpsSnap.docs;
  const total = allDocs.length;
  const limit = 6;
  for (let i = 0; i < Math.min(limit, total); i++) {
    const phone = allDocs[i].id;
    const memberSnap = await db.collection('members').doc(phone).get();
    const avatarEl = document.createElement('div');
    avatarEl.className = 'avatar';
    avatarEl.dataset.phone = phone;

    if (memberSnap.exists && memberSnap.data().profileImage) {
      const img = document.createElement('img');
      img.src = memberSnap.data().profileImage;
      avatarEl.appendChild(img);
    } else {
      const name = memberSnap.exists
                   ? (memberSnap.data().name || memberSnap.data().Name)
                   : '??';
      const pick = (parseInt(phone.slice(-2)) % 3) + 1; 
      const gradient = getComputedStyle(document.documentElement)
                       .getPropertyValue(`--muted-color${pick}-start`).trim()
                       + ',\n'
                       + getComputedStyle(document.documentElement)
                       .getPropertyValue(`--muted-color${pick}-end`).trim();
      avatarEl.style.background = `radial-gradient(circle at center, ${gradient})`;
      const initials = name.split(' ')
                           .map(s => s[0]).join('').toUpperCase();
      avatarEl.textContent = initials;
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'guest-tooltip';
    tooltip.innerText = memberSnap.exists
                        ? (memberSnap.data().name || memberSnap.data().Name)
                        : 'Unknown';
    avatarEl.appendChild(tooltip);
    avatarEl.onclick = () => {
      document.querySelectorAll('.guest-tooltip')
              .forEach(t => t.style.opacity = '0');
      tooltip.style.opacity = '1';
      setTimeout(() => tooltip.style.opacity = '0', 2000);
    };
    listContainer.appendChild(avatarEl);
  }
  if (total > limit) {
    const extra = total - limit;
    const plusEl = document.createElement('div');
    plusEl.className = 'avatar plus';
    plusEl.textContent = `+${extra}`;
    listContainer.appendChild(plusEl);
  }
}

// 8. “See All” modal population
async function showSeeAllModal(statusFilter) {
  document.getElementById('see-all-modal').style.display = 'flex';
  document.querySelectorAll('.tab-button').forEach(b => {
    b.classList.toggle('active', b.dataset.status === statusFilter);
  });
  await populateSeeAllList(statusFilter);
}

async function populateSeeAllList(statusFilter) {
  const list = document.getElementById('see-all-list');
  list.innerHTML = '';
  const rsvpsSnap = await db.collection('events')
    .doc(eventId)
    .collection('rsvps')
    .where('status', '==', statusFilter)
    .get();
  for (const doc of rsvpsSnap.docs) {
    const phone = doc.id;
    const memberSnap = await db.collection('members').doc(phone).get();
    const row = document.createElement('div');
    row.className = 'see-all-row';
    // Avatar
    const avatarEl = document.createElement('div');
    avatarEl.className = 'see-all-avatar';
    if (memberSnap.exists && memberSnap.data().profileImage) {
      const img = document.createElement('img');
      img.src = memberSnap.data().profileImage;
      avatarEl.appendChild(img);
    } else {
      const name = memberSnap.exists
                   ? (memberSnap.data().name || memberSnap.data().Name)
                   : '??';
      const pick = (parseInt(phone.slice(-2)) % 3) + 1;
      const gradient = getComputedStyle(document.documentElement)
                       .getPropertyValue(`--muted-color${pick}-start`).trim()
                       + ',\n'
                       + getComputedStyle(document.documentElement)
                       .getPropertyValue(`--muted-color${pick}-end`).trim();
      avatarEl.style.background = `radial-gradient(circle at center, ${gradient})`;
      const initials = name.split(' ')
                           .map(s => s[0]).join('').toUpperCase();
      avatarEl.textContent = initials;
    }
    row.appendChild(avatarEl);
    // Name
    const nameSpan = document.createElement('span');
    nameSpan.textContent = memberSnap.exists
                           ? (memberSnap.data().name || memberSnap.data().Name)
                           : 'Unknown';
    nameSpan.style.fontSize = '0.95rem';
    nameSpan.style.color = 'var(--text)';
    row.appendChild(nameSpan);
    list.appendChild(row);
  }
}

// 9. RSVP button handlers (gated by login)
function setupRSVPButtons() {
  document.getElementById('btn-going').onclick    = () => handleRSVP('Going');
  document.getElementById('btn-maybe').onclick    = () => handleRSVP('Maybe');
  document.getElementById('btn-notgoing').onclick = () => handleRSVP('NotGoing');
}

async function handleRSVP(status) {
  if (!currentPhone) {
    document.getElementById('phone-entry').style.display = 'flex';
    return;
  }
  const rsvpRef = db.collection('events').doc(eventId).collection('rsvps').doc(currentPhone);
  await rsvpRef.set({
    status: status,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // Update button styles
  document.querySelectorAll('.rsvp-button').forEach(btn => btn.classList.remove('active'));
  const targetBtn = document.getElementById(`btn-${status.toLowerCase()}`);
  if (targetBtn) {
    targetBtn.classList.add('active');
  }

  // Award points
  const delta = status === 'Going' ? 10 : status === 'Maybe' ? 5 : 1;
  const memberRef = db.collection('members').doc(currentPhone);
  try {
    await memberRef.update({
      sPoints: firebase.firestore.FieldValue.increment(delta)
    });
  } catch (e) {
    console.error('Points update failed', e);
  }

  // Referral award
  if (referrerPhone) {
    const refMemberRef = db.collection('members').doc(referrerPhone);
    try {
      await refMemberRef.update({
        sPoints: firebase.firestore.FieldValue.increment(5)
      });
    } catch (e) {
      console.error('Referral points update failed', e);
    }
    referrerPhone = null;
  }

  // System comment
  const sysText = `${currentName} marked as *${status}*`;
  await db.collection('events').doc(eventId).collection('comments').add({
    text: sysText,
    name: '',
    user: '',
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    system: true
  });

  // Refresh preview
  await loadGuestListPreview();

  // Show Pay Now if Going/Maybe
  const btnPay = document.getElementById('btn-pay');
  if (status === 'Going' || status === 'Maybe') {
    btnPay.style.display = 'block';
    setTimeout(() => btnPay.classList.add('fade-in'), 50);
  } else {
    btnPay.style.display = 'none';
    btnPay.classList.remove('fade-in');
  }
}

// 10. Load comments (only after login)
// 10. Load comments (only after login)
function loadComments() {
  const commentsRef = db
    .collection('events')
    .doc(eventId)
    .collection('comments')
    .orderBy('timestamp', 'desc');

  commentsRef.onSnapshot(async (snapshot) => {
    const list = document.getElementById('comments-list');
    list.innerHTML = ''; 

    const promises = snapshot.docs.map(async (doc) => {
      const c = doc.data();
      const ts = c.timestamp && c.timestamp.toMillis ? c.timestamp.toMillis() : 0;
      let memberData = null;
      if (c.user) {
        const memSnap = await db.collection('members').doc(c.user).get();
        memberData = memSnap.exists ? memSnap.data() : null;
      }
      return { id: doc.id, comment: c, member: memberData, ts };
    });

    const allComments = await Promise.all(promises);
    allComments.sort((a, b) => b.ts - a.ts);

    allComments.forEach(({ id, comment: c, member, ts }) => {
      const row = document.createElement('div');
      row.className = 'comment';
      row.dataset.commentId = id;

      const isGreenComment = c.green === true;

      // Apply special styling directly to the main row container
      if (isGreenComment) {
        row.style.backgroundColor = '#01796F'; // Pine Green
        row.style.color = 'white';
        row.style.borderRadius = '8px'; // Ensure consistent border-radius
      }

      // ── Avatar (conditionally rendered) ──
      if (!isGreenComment) {
        const avatarEl = document.createElement('div');
        avatarEl.className = 'comment-avatar';

        if (c.user && member && member.profileImage) {
          avatarEl.innerHTML = '';
          const img = document.createElement('img');
          img.src = member.profileImage;
          avatarEl.appendChild(img);
        } else if (c.user) {
          const name = member ? (member.name || member.Name || 'Unknown') : 'Unknown';
          const pick = (parseInt(c.user.slice(-2)) % 3) + 1;
          const gradient =
            getComputedStyle(document.documentElement).getPropertyValue(`--muted-color${pick}-start`).trim() +
            ', ' +
            getComputedStyle(document.documentElement).getPropertyValue(`--muted-color${pick}-end`).trim();
          avatarEl.style.background = `radial-gradient(circle at center, ${gradient})`;
          const initials = name.split(' ').map((s) => s[0]).join('').toUpperCase();
          avatarEl.textContent = initials;
        } else {
          avatarEl.style.background = 'rgba(0,0,0,0.1)';
          avatarEl.textContent = '⚙';
        }
        row.appendChild(avatarEl);
      }

      // ── Content container ──
      const content = document.createElement('div');
      content.className = 'comment-content';
      content.style.position = 'relative';

      if (isGreenComment) {
        // Reset styles for the inner content div to prevent conflicts
        content.style.padding = '0';
        content.style.marginLeft = '0';
      }

      if (c.user === currentPhone) {
        const delLink = document.createElement('span');
        delLink.textContent = 'x';
        delLink.style.position = 'absolute';
        delLink.style.top = '4px';
        delLink.style.right = '4px';
        delLink.style.color = isGreenComment ? 'white' : 'red';
        delLink.style.cursor = 'pointer';
        delLink.style.fontSize = '0.75rem';
        delLink.addEventListener('click', async () => {
          if (!confirm('Are you sure you want to delete this?')) return;
          await db.collection('events').doc(eventId).collection('comments').doc(id).delete();
        });
        content.appendChild(delLink);
      }

      // ── Header (name + timestamp) ──
      const header = document.createElement('div');
      header.className = 'comment-header';

      if (!isGreenComment) {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'comment-name';
        if (c.system && c.type === 'payment_confirmation') {
          header.classList.add('payment-confirmation');
          row.classList.add('comment-system', 'payment-confirmation');
          nameSpan.textContent = c.text;
        } else if (c.system) {
          nameSpan.textContent = 'System';
        } else {
          nameSpan.textContent = member ? (member.name || member.Name || 'Unknown') : (c.name || 'Unknown');
        }
        header.appendChild(nameSpan);
      }

      const tsSpan = document.createElement('span');
      tsSpan.className = 'comment-timestamp';
      if (c.timestamp && c.timestamp.toDate) {
        const d = c.timestamp.toDate();
        const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
        tsSpan.textContent = d.toLocaleString('en-US', opts);
        if (isGreenComment) {
          tsSpan.style.color = 'rgba(255, 255, 255, 0.8)';
          tsSpan.style.width = '100%';
          tsSpan.style.textAlign = 'right';
        }
      }
      header.appendChild(tsSpan);
      content.appendChild(header);

      // ── Media & Text ──
      if (c.imageUrls && Array.isArray(c.imageUrls)) {
        c.imageUrls.forEach((url) => {
          const imgEl = document.createElement('img');
          imgEl.src = url;
          imgEl.style.maxWidth = '100%';
          imgEl.style.borderRadius = '4px';
          imgEl.style.marginTop = '0.3rem';
          content.appendChild(imgEl);
        });
      }
      if (c.gifUrl) {
        const gifImg = document.createElement('img');
        gifImg.src = c.gifUrl;
        gifImg.style.maxWidth = '100%';
        gifImg.style.borderRadius = '4px';
        gifImg.style.marginTop = '0.3rem';
        content.appendChild(gifImg);
      }
      if (c.text && !(c.system && c.type === 'payment_confirmation')) {
        const textDiv = document.createElement('div');
        textDiv.className = 'comment-text';
        textDiv.textContent = c.text;
        if (isGreenComment) {
          textDiv.style.color = 'white';
        }
        content.appendChild(textDiv);
      }
      
      // ── Actions & Replies (conditionally rendered) ──
      if (!c.system && !isGreenComment) {
        const actions = document.createElement('div');
        actions.className = 'comment-actions';
        const replyBtn = document.createElement('button');
        replyBtn.textContent = 'Reply';
        replyBtn.addEventListener('click', () => showReplyInput(id, content));
        actions.appendChild(replyBtn);
        content.appendChild(actions);

        const repliesContainer = document.createElement('div');
        repliesContainer.className = 'comment-replies';
        content.appendChild(repliesContainer);
        loadReplies(id, repliesContainer);
      }

      row.appendChild(content);
      list.appendChild(row);
    });
  });
}

// 11. Show reply input under a comment
function showReplyInput(parentId, contentDiv) {
  if (contentDiv.querySelector('.reply-input-container')) return;

  const container = document.createElement('div');
  container.className = 'reply-input-container';
  container.style.position = 'relative';

  const textarea = document.createElement('div');
  textarea.className = 'reply-input';
  textarea.setAttribute('contenteditable', 'true');
  textarea.setAttribute('data-placeholder', 'Write a reply...');
  textarea.dataset.parentId = parentId;
  textarea.style.marginBottom = '2.5rem';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = false;
  fileInput.className = 'reply-file';
  fileInput.style.display = 'none';

  const iconContainer = document.createElement('div');
  iconContainer.className = 'reply-icons';
  iconContainer.style.position = 'absolute';
  iconContainer.style.bottom = '0.5rem';
  iconContainer.style.right = '0.5rem';
  iconContainer.style.display = 'flex';
  iconContainer.style.gap = '0.5rem';

  // Image upload button for replies
  const imgBtn = document.createElement('button');
  imgBtn.className = 'btn-image-upload-reply';
  imgBtn.title = 'Upload Image';
  imgBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor"
         xmlns="http://www.w3.org/2000/svg">
      <path d="M21 19V5C21 3.9 20.1 3 19 3H5C3.9 3 
               3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 
               21 21 20.1 21 19ZM19 19H5V5H19V19ZM12 
               8C10.34 8 9 9.34 9 11C9 12.66 10.34 14 12 
               14C13.66 14 15 12.66 15 11C15 9.34 13.66 
               8 12 8ZM6 18L10 13L13 17L16 12L19 18H6Z"/>
    </svg>`;
  imgBtn.onclick = () => {
    if (textarea.querySelector('img[data-giphy]')) {
      alert("You already inserted a GIF in this reply; remove it before uploading an image.");
      return;
    }
    fileInput.click();
  };

  // GIF button for replies
  const gifBtn = document.createElement('button');
  gifBtn.className = 'btn-giphy-open-reply';
  gifBtn.title = 'Insert GIF';
  gifBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor"
         xmlns="http://www.w3.org/2000/svg">
      <path d="M 18.75 3.50054 C 20.5449 3.50054 22 4.95562 22 6.75054 L 22 17.2531 
               C 22 19.048 20.5449 20.5031 18.75 20.5031 L 5.25 20.5031 
               C 3.45507 20.5031 2 19.048 2 17.2531 L 2 6.75054 
               C 2 4.95562 3.45507 3.50054 5.25 3.50054 L 18.75 3.50054 
               Z M 8.0146 8.87194 C 6.38839 8.87194 5.26104 10.2817 
               5.26104 11.9943 C 5.26104 13.7076 6.38858 15.1203 
               8.0146 15.1203 C 8.90238 15.1203 9.71768 14.6932 
               10.1263 13.9064 L 10.2025 13.7442 L 10.226 13.6745 
               L 10.244 13.5999 L 10.244 13.5999 L 10.2516 13.5169 
               L 10.2518 11.9962 L 10.245 11.9038 C 10.2054 11.6359 
               9.99569 11.4235 9.7292 11.3795 L 9.62682 11.3712 
               L 8.62522 11.3712 L 8.53286 11.378 C 8.26496 11.4177 
               8.05247 11.6273 8.00856 11.8938 L 8.00022 11.9962 
               L 8.007 12.0886 C 8.04667 12.3564 8.25635 12.5689 
               8.52284 12.6129 L 8.62522 12.6212 L 9.00104 12.6209 
               L 9.00104 13.3549 L 8.99484 13.3695 C 8.80607 13.6904 
               8.44322 13.8703 8.0146 13.8703 C 7.14873 13.8703 
               6.51103 13.0713 6.51103 11.9943 C 6.51103 10.9183 
               7.14789 10.1219 8.0146 10.1219 C 8.43601 10.1219 
               8.67583 10.1681 8.97566 10.3121 C 9.28682 10.4616 
               9.66019 10.3304 9.80962 10.0193 C 9.95904 9.70813 
               9.82793 9.33475 9.51677 9.18533 C 9.03353 8.95326 
               8.6115 8.87194 8.0146 8.87194 Z M 12.6289 8.99393 
               C 12.3151 8.99393 12.0554 9.22519 12.0107 9.52658 L 
               12.0039 9.61893 L 12.0039 14.3811 L 12.0107 14.4734 
               C 12.0554 14.7748 12.3151 15.0061 12.6289 15.0061 
               C 12.9427 15.0061 13.2025 14.7748 13.2472 14.4734 
               L 13.2539 14.3811 L 13.2539 9.61893 L 13.2472 9.52658 
               C 13.2025 9.22519 12.9427 8.99393 12.6289 8.99393 
               Z M 17.6222 9.00084 L 15.6248 8.99393 C 15.311 8.99286 
               15.0504 9.22322 15.0047 9.52444 L 14.9976 9.61678 
               L 14.9976 14.365 L 15.0044 14.4573 C 15.0441 14.7252 
               15.2537 14.9377 15.5202 14.9816 L 15.6226 14.99 L 
               15.715 14.9832 C 15.9829 14.9435 16.1953 14.7338 
               16.2393 14.4673 L 16.2476 14.365 L 16.247 13.2499 
               L 17.37 13.2504 L 17.4624 13.2436 C 17.7303 13.2039 
               17.9427 12.9943 17.9867 12.7278 L 17.995 12.6254 
               L 17.9882 12.533 C 17.9485 12.2651 17.7389 12.0527 
               17.4724 12.0087 L 17.37 12.0004 L 16.247 11.9999 
               L 16.247 10.2449 L 17.6178 10.2508 L 17.7102 10.2444 
               C 18.0118 10.2008 18.2439 9.94179 18.245 9.62799 
               C 18.2461 9.31419 18.0157 9.05361 17.7145 9.00793 
               L 17.6222 9.00084 L 15.6248 8.99393 L 17.6222 9.00084 
               Z"/>
    </svg>`;
  gifBtn.onclick = () => {
    if (textarea.querySelector('img:not([data-giphy])')) {
      alert("You uploaded an image in this reply; remove it before inserting a GIF.");
      return;
    }
    currentGifTarget = textarea;
    document.getElementById('giphy-modal').style.display = 'flex';
    document.getElementById('giphy-search-input').value = '';
    document.getElementById('giphy-results').innerHTML = '';
  };

  // "Post" button for replies
  const postBtn = document.createElement('button');
  postBtn.className = 'btn-post-reply';
  postBtn.textContent = 'Post';
  postBtn.onclick = async () => {
    await submitReply(parentId, textarea, fileInput);
  };

  // When a file is chosen for reply
  fileInput.onchange = () => {
    if (textarea.querySelector('img[data-giphy]')) {
      alert("You already inserted a GIF; remove it before uploading an image.");
      fileInput.value = '';
      return;
    }
  };

  iconContainer.appendChild(imgBtn);
  iconContainer.appendChild(gifBtn);
  iconContainer.appendChild(postBtn);

  container.appendChild(textarea);
  container.appendChild(fileInput);
  container.appendChild(iconContainer);
  contentDiv.appendChild(container);
}

// 12. Load replies for a given comment
function loadReplies(parentId, repliesContainer) {
  const repliesRef = db.collection('events')
    .doc(eventId)
    .collection('comments')
    .doc(parentId)
    .collection('replies')
    .orderBy('timestamp', 'asc');
  repliesRef.onSnapshot(snapshot => {
    repliesContainer.innerHTML = '';
    snapshot.forEach(async doc => {
      const r = doc.data();
      const row = document.createElement('div');
      row.className = 'comment reply';
      row.dataset.parentId = parentId;
      row.dataset.replyId  = doc.id;

      // Avatar
      const avatarEl = document.createElement('div');
      avatarEl.className = 'comment-avatar';
      if (r.user) {
        const memSnap = await db.collection('members').doc(r.user).get();
        if (memSnap.exists && memSnap.data().profileImage) {
          avatarEl.innerHTML = '';
          const img = document.createElement('img');
          img.src = memSnap.data().profileImage;
          avatarEl.appendChild(img);
        } else {
          const name = memSnap.exists
                       ? (memSnap.data().name || memSnap.data().Name)
                       : '??';
          const pick = (parseInt(r.user.slice(-2)) % 3) + 1;
          const gradient = getComputedStyle(document.documentElement)
                            .getPropertyValue(`--muted-color${pick}-start`).trim()
                            + ',\n'
                            + getComputedStyle(document.documentElement)
                            .getPropertyValue(`--muted-color${pick}-end`).trim();
          avatarEl.style.background = `radial-gradient(circle at center, ${gradient})`;
          const initials = name.split(' ')
                               .map(s => s[0]).join('').toUpperCase();
          avatarEl.textContent = initials;
        }
      } else {
        avatarEl.style.background = 'rgba(0,0,0,0.1)';
        avatarEl.textContent = '⚙';
      }
      row.appendChild(avatarEl);

      // Content
      const content = document.createElement('div');
      content.className = 'comment-content';
      content.style.marginLeft = '0.5rem';
      content.style.position = 'relative';

      // Delete link if owned by currentPhone
      if (r.user === currentPhone) {
        const delLink = document.createElement('span');
        delLink.textContent = 'x';
        delLink.style.position = 'absolute';
        delLink.style.top = 'var(--delete-offset-top, 4px)';
        delLink.style.right = 'var(--delete-offset-right, 4px)';
        delLink.style.color = 'red';
        delLink.style.cursor = 'pointer';
        delLink.style.fontSize = '0.75rem';
        delLink.addEventListener('click', async () => {
          if (!confirm("Are you sure you want to delete this?")) return;
          await db.collection('events')
                  .doc(eventId)
                  .collection('comments')
                  .doc(parentId)
                  .collection('replies')
                  .doc(doc.id)
                  .delete();
        });
        content.appendChild(delLink);
      }

      // Header (name + timestamp)
      const header = document.createElement('div');
      header.className = 'comment-header';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'comment-name';
      nameSpan.textContent = r.name || 'Unknown';
      header.appendChild(nameSpan);
      const tsSpan = document.createElement('span');
      tsSpan.className = 'comment-timestamp';
      if (r.timestamp && r.timestamp.toDate) {
        const d = r.timestamp.toDate();
        const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
        tsSpan.textContent = d.toLocaleString('en-US', opts);
      } else {
        tsSpan.textContent = '';
      }
      header.appendChild(tsSpan);
      content.appendChild(header);

      // Image (if any)
      if (r.imageUrl) {
        const imgEl = document.createElement('img');
        imgEl.src = r.imageUrl;
        imgEl.style.maxWidth = '100%';
        imgEl.style.borderRadius = '4px';
        imgEl.style.marginBottom = '0.3rem';
        content.appendChild(imgEl);
      }
      // GIF (if any)
      if (r.gifUrl) {
        const gifImg = document.createElement('img');
        gifImg.src = r.gifUrl;
        gifImg.setAttribute('data-giphy', 'true');
        gifImg.style.maxWidth = '100%';
        gifImg.style.borderRadius = '4px';
        gifImg.style.marginBottom = '0.3rem';
        content.appendChild(gifImg);
      }

      const textDiv = document.createElement('div');
      textDiv.className = 'comment-text';
      textDiv.textContent = r.text;
      content.appendChild(textDiv);

      row.appendChild(content);
      repliesContainer.appendChild(row);
    });
  });
}

// 13. Load RSVP list (initial button state)
async function loadRSVPList() {
  if (!currentPhone) return;
  const rsvpSnap = await db.collection('events')
    .doc(eventId)
    .collection('rsvps')
    .doc(currentPhone)
    .get();
  if (rsvpSnap.exists) {
    const status = rsvpSnap.data().status;
    document.querySelectorAll('.rsvp-button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${status.toLowerCase()}`).classList.add('active');
    if (status === 'Going' || status === 'Maybe') {
      const btnPay = document.getElementById('btn-pay');
      btnPay.style.display = 'block';
      setTimeout(() => btnPay.classList.add('fade-in'), 50);
    }
  }
}

// 14. Submit a new comment (gated by login)
async function submitComment() {
  if (!currentPhone) {
    document.getElementById('phone-entry').style.display = 'flex';
    return;
  }
  const contentDiv = document.getElementById('comment-input');
  const text       = contentDiv.innerText.trim();
  const fileInput  = document.getElementById('comment-file-input');
  const timestamp  = Date.now();

  const hasGif  = !!contentDiv.querySelector('img[data-giphy]');
  const hasFile = (fileInput.files && fileInput.files.length > 0);

  if (!text && !hasGif && !hasFile) {
    alert('Write something or insert media before posting.');
    return;
  }
  if (hasGif && hasFile) {
    alert("You may only add either images or a single GIF per comment.");
    return;
  }

  // Handle image attachments (multiple)
  const imageUrls = [];
  if (fileInput.files && fileInput.files.length > 0) {
    for (const file of fileInput.files) {
      const storageRef = storage.ref(`events/${eventId}/comments/${currentPhone}_${timestamp}_${file.name}`);
      await storageRef.put(file);
      const downloadUrl = await storageRef.getDownloadURL();
      imageUrls.push(downloadUrl);
    }
  }

  // Build payload
  const payload = {
    text:      text,
    name:      currentName,
    user:      currentPhone,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    system:    false
  };
  if (imageUrls.length > 0) {
    payload.imageUrls = imageUrls;
  }
  if (hasGif) {
    const gifElem = contentDiv.querySelector('img[data-giphy]');
    if (gifElem) {
      payload.gifUrl = gifElem.src;
    }
  }

  // Add to Firestore
  await db.collection('events')
    .doc(eventId)
    .collection('comments')
    .add(payload);

  // Clear inputs
  contentDiv.innerHTML = '';
  fileInput.value = '';
}

// 15. Submit a reply to a specific comment (gated by login)
async function submitReply(parentId, textarea, fileInput) {
  if (!currentPhone) {
    document.getElementById('phone-entry').style.display = 'flex';
    return;
  }
  const text      = textarea.innerText.trim();
  const timestamp = Date.now();

  const hasGif  = !!textarea.querySelector('img[data-giphy]');
  const hasFile = (fileInput.files && fileInput.files.length > 0);

  if (!text && !hasGif && !hasFile) {
    alert('Write something or insert media before replying.');
    return;
  }
  if (hasGif && hasFile) {
    alert("You may only add either an image or a single GIF per reply.");
    return;
  }

  let imageUrl = '';
  if (fileInput.files && fileInput.files[0]) {
    const file = fileInput.files[0];
    const storageRef = storage.ref(`events/${eventId}/comments/${parentId}_reply_${currentPhone}_${timestamp}_${file.name}`);
    await storageRef.put(file);
    imageUrl = await storageRef.getDownloadURL();
  }

  // Build payload
  const payload = {
    text:      text,
    name:      currentName,
    user:      currentPhone,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    system:    false
  };
  if (imageUrl) {
    payload.imageUrl = imageUrl;
  }
  if (hasGif) {
    const gifElem = textarea.querySelector('img[data-giphy]');
    if (gifElem) {
      payload.gifUrl = gifElem.src;
    }
  }

  // Add to Firestore under replies subcollection
  await db.collection('events')
    .doc(eventId)
    .collection('comments')
    .doc(parentId)
    .collection('replies')
    .add(payload);

  // Clear reply box
  textarea.innerHTML = '';
  fileInput.value     = '';
}

// 16. Search Giphy
async function searchGiphy(query) {
  const apiKey = "SgkvjeTFHnRpwftorW4urkxpnKEmei8A";
  const limit  = 24;
  const url    = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=${limit}&rating=pg`;
  try {
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`Giphy API ${res.status}`);
    const json = await res.json();
    const data = json.data;
    const container = document.getElementById('giphy-results');
    container.innerHTML = '';

    data.forEach(item => {
      const thumbUrl = item.images.fixed_width_small.webp || item.images.fixed_width_small.url;
      const fullUrl  = item.images.original.webp || item.images.original.url;
      const img      = document.createElement('img');
      img.src       = thumbUrl;
      img.className = 'giphy-thumb';
      img.onclick   = () => {
        const target = getActiveGifTarget();
        if (!target) {
          alert("No active input to insert GIF into.");
          document.getElementById('giphy-modal').style.display = 'none';
          return;
        }
        if (target.querySelector('img:not([data-giphy])')) {
          alert("You uploaded an image here; remove it before inserting a GIF.");
          return;
        }
        const existingGif = target.querySelector('img[data-giphy]');
        if (existingGif) {
          existingGif.src = fullUrl;
        } else {
          const gifImg = document.createElement('img');
          gifImg.src = fullUrl;
          gifImg.setAttribute('data-giphy', 'true');
          gifImg.style.maxWidth = '100%';
          gifImg.style.borderRadius = '4px';
          gifImg.style.marginBottom = '0.3rem';
          target.prepend(gifImg);
        }
        document.getElementById('giphy-modal').style.display = 'none';
      };
      container.appendChild(img);
    });
  } catch (err) {
    console.error("Giphy search failed:", err);
    alert("Giphy search failed: " + err.message);
  }
}

// Helper: return the current contenteditable expecting a GIF
function getActiveGifTarget() {
  return currentGifTarget;
}

// 17. Calendar & Share logic
function setupCalendarAndShare(e) {
  document.getElementById('btn-calendar').onclick = () => {
    if (e.calendarLink) {
      window.open(e.calendarLink, '_blank');
    } else {
      alert('No calendar link provided');
    }
  };

  document.getElementById('btn-share-event').onclick = async () => {
    if (!navigator.share) {
      alert('Web Share API not supported');
      return;
    }
    const baseURL = window.location.origin + window.location.pathname;
    const paramE  = '?e=' + encodeURIComponent(eventId);
    const phoneBytes = new TextEncoder().encode(currentPhone);
    const dig = await crypto.subtle.digest('SHA-256', phoneBytes);
    const hashArray = Array.from(new Uint8Array(dig));
    const hashHex   = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const reversedHash = hashHex.split('').reverse().join('');
    const randChars = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      return Array.from({ length: 4 }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length))
      ).join('');
    };
    const finalToken = randChars() + reversedHash + randChars();
    const shareURL = `${baseURL}${paramE}&ref=${encodeURIComponent(finalToken)}`;

    try {
      await navigator.share({
        title: e.title,
        text: 'Join me at ' + e.title,
        url: shareURL
      });
    } catch (err) {
      console.error('Share failed:', err);
    }
  };
}

// 18. Show ticket modal
function showTicketModal() {
  const ticketListEl = document.getElementById('ticket-list');
  ticketListEl.innerHTML = '';
  db.collection('events').doc(eventId).collection('tickets').get()
    .then(ticketsSnap => {
      ticketsSnap.forEach(doc => {
        const t   = doc.data();
        const row = document.createElement('div');
        row.className = 'ticket-row';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.padding = '0.75rem';
        row.style.borderBottom = '1px solid #eee';

        // Left side: name + description + price
        const left = document.createElement('div');
        left.style.flex = '1';
        left.innerHTML = `
          <h3 style="margin:0; color:#333;">${t.name}</h3>
          <p style="margin:0.25rem 0; color:#555;">${t.description}</p>
          <p style="margin:0; color:#555;">Price: $${Number(t.price).toFixed(2)}</p>
        `;

        // Right side: “Pay” button
        const right = document.createElement('div');
        const payBtn = document.createElement('button');
        payBtn.className = 'btn-pay-ticket';
        payBtn.textContent = 'Pay';
        payBtn.style.background = 'var(--brown)';
        payBtn.style.color = 'var(--gold)';
        payBtn.style.border = 'none';
        payBtn.style.borderRadius = '4px';
        payBtn.style.padding = '0.5rem 1rem';
        payBtn.style.fontSize = '0.9rem';
        payBtn.style.cursor = 'pointer';
        payBtn.style.boxShadow = 'var(--button-shadow)';
        payBtn.onclick = () => {
          if (!currentPhone) {
            document.getElementById('phone-entry').style.display = 'flex';
            return;
          }
          if (t.paymentlink && t.paymentlink.trim() !== '') {
            let url = t.paymentlink.trim();
            if (!/^https?:\/\//i.test(url)) {
              url = "https://" + url;
            }
            window.open(url, '_blank');
          } else {
            alert('No payment link available for this ticket.');
          }
        };
        right.appendChild(payBtn);

        row.appendChild(left);
        row.appendChild(right);
        ticketListEl.appendChild(row);
      });
      document.getElementById('ticket-modal').style.display = 'flex';
    })
    .catch(err => {
      console.error('Failed to load tickets:', err);
      alert('Error loading tickets.');
    });
}