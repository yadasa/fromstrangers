// events/js/event.js

// 1. Initialize Firebase
if (!window.firebaseConfig) {
  throw new Error("Missing firebaseConfig.js");
}
firebase.initializeApp(window.firebaseConfig);
const auth    = firebase.auth();
// avoid unnecessary token refreshes on each load:
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch(err => console.error('Failed to set auth persistence:', err));
const db      = firebase.firestore();
const storage = firebase.storage();

function makeAvatarImg(pfpId, size = 64) {
  const img = document.createElement('img');
  img.width = img.height = size;
  img.style.objectFit = 'cover';
  img.style.borderRadius = '50%';
  img.src = pfpId;
  img.onerror = () => {
    img.onerror = null;
    img.src     = `/api/drive/thumb?id=${encodeURIComponent(pfpId)}&sz=${size}`;
  };
  return img;
}
// 1a) Watch for real auth state and force login if needed
firebase.auth().onAuthStateChanged(user => {
  if (user) {
    // valid session → hydrate
    const phone = user.phoneNumber.replace('+1','');
    db.collection('members').doc(phone).get().then(snap => {
      const name = snap.exists ? snap.data().name : '';
      handleLogin(phone, name);
    });
  } else {
    // no session → force login
    document.getElementById('phone-entry').style.display = 'flex';
    currentPhone = '';
    currentName  = '';
    document.querySelectorAll('.rsvp-button.active')
            .forEach(btn => btn.classList.remove('active'));
  }
});

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
//function savePhone(phone) {
//  try { localStorage.setItem('userPhone', phone); } catch {}
//  document.cookie = `userPhone=${phone};max-age=${60*60*24*365};path=/;SameSite=Lax`;
//}
//function loadPhone() {
//  try { return localStorage.getItem('userPhone'); } catch {}
//  const m = document.cookie.match(/(?:^|; )userPhone=(\d{10})/);
//  return m ? m[1] : null;
//}

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
   // grab the raw token from the URL
   const refToken = params.get('ref');
   // strip off the first/last 4 random chars
   const stripped = refToken.slice(4, -4);
   // reverse back to the original hash
   const reversedHash = stripped.split('').reverse().join('');
   // look up the member whose hashedPhone equals that
   db.collection('members')
     .where('hashedPhone', '==', reversedHash)
     .get()
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


// ───────────────────────────────────────────────────────────────────
// 1) Listen for loginSuccess from the iframe
// ───────────────────────────────────────────────────────────────────
window.addEventListener('message', async event => {
  if (event.origin !== window.location.origin) return;
  const msg = event.data;
  if (msg.type === 'loginSuccess' && msg.phone) {
    await handleLogin(msg.phone, msg.name || '');
  }
});

/**
 * Called once the iframe tells us login succeeded
 */
async function handleLogin(phone, name) {
  // ← new persistence
  localStorage.setItem('userPhone', phone);
  localStorage.setItem('userName',  name);
  currentPhone = phone;
  currentName  = name;
  isFirstLogin = false;

  // hide the login overlay
  document.getElementById('phone-entry').style.display = 'none';

  // update header
  document.getElementById('signed-in').innerText = `Signed in as ${currentName}`;

  // unlock UI…
  unlockLoggedInFeatures();
  // …then just refresh RSVP state and guest preview (no full reload)
  await loadRSVPList();
  // await loadGuestListPreview();
}

// ───────────────────────────────────────────────────────────────────

// 4. Attach event listeners on DOMContentLoaded
let currentGifTarget = null; 
// START REVISION: Restructure DOMContentLoaded to prevent race condition
document.addEventListener('DOMContentLoaded', async () => {
  // Always show the app shell immediately
  document.getElementById('app').style.display = 'block';

    // ** Optimistic restore **
    setupRSVPButtons();
    const cachedPhone = localStorage.getItem('userPhone');
    const cachedName  = localStorage.getItem('userName');
    if (cachedPhone) {
      currentPhone = cachedPhone;
      currentName  = cachedName || '';
      isFirstLogin = false;

      // hide the overlay
      const pe = document.getElementById('phone-entry');
      if (pe) pe.style.display = 'none';

      // update header
      const hdr = document.getElementById('signed-in');
      if (hdr) hdr.innerText = `Signed in as ${currentName}`;

      // unlock features and load immediately
      unlockLoggedInFeatures();
      // don't await these—you can let them run
      loadRSVPList();
      // sanity‐check:
      const saveBtn = document.getElementById('payment-save');
      console.log('found save button →', saveBtn);

      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          console.log('💾 Save clicked');   // <-- now you should see this
          const checked = document.querySelectorAll('#payment-list input:checked');
          for (const cb of checked) {
            const phone = cb.dataset.phone;
            const mSnap = await db.collection('members').doc(phone).get();
            const full  = mSnap.exists ? mSnap.data().name : '';
            const parts = full.split(' ');
            const text  = `${parts[0]} ${parts.slice(-1)[0][0]}. has paid`;

            await db.collection('events')
              .doc(eventId)
              .collection('comments')
              .add({
                text,
                green:    true,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
              });
          }
          // close
          document.getElementById('payment-modal').style.display = 'none';
        });
      }
    }


  // Show login overlay (iframe) until we get postMessage
  // Hide login overlay by default (so guests see the event/guest list immediately)
  document.getElementById('phone-entry').style.display = 'none';
  document.getElementById('comment-widget').style.display = 'block';

  // START: ADD THIS ENTIRE BLOCK
  // Main Comment Widget Listeners
  document.getElementById('btn-post-comment').onclick = () => submitComment();
  
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
    }
  };

  document.getElementById('btn-giphy-open').onclick = () => {
    currentGifTarget = document.getElementById('comment-input');
    document.getElementById('giphy-modal').style.display = 'flex';
    document.getElementById('giphy-search-input').value = '';
    document.getElementById('giphy-results').innerHTML = '';
  };
  // END: ADD THIS ENTIRE BLOCK

  // START: ADD THIS ENTIRE BLOCK
  // Modal Listeners
  document.getElementById('giphy-close').onclick = () => {
    document.getElementById('giphy-modal').style.display = 'none';
    currentGifTarget = null;
  };

  document.getElementById('see-all-close').onclick = () => {
    document.getElementById('see-all-modal').style.display = 'none';
  };

  document.getElementById('giphy-search-input').onkeyup = async (e) => {
    if (e.key === 'Enter') {
      const query = e.target.value.trim();
      if (query) await searchGiphy(query);
    }
  };
  // END: ADD THIS ENTIRE BLOCK

  // START: ADD THIS FINAL BLOCK
  // "See All" Modal Tab Listeners
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.onclick = async (e) => {
      document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const status = e.currentTarget.getAttribute('data-status');
      await populateSeeAllList(status);
    };
  });
  // END: ADD THIS FINAL BLOCK

  // ─────────────────────────────────────────────────────────────────
  // REMOVED: any loadPhone()/savePhone() logic & auto-resume via localStorage.
  // We no longer call loadEventData() here – it will be triggered by handleLogin().
  //
  // However, to let public (logged-out) users see the event details:
  await loadEventData();
  await loadGuestListPreview();
  loadComments();
  
  // ─────────────────────────────────────────────────────────────────

  // --- All other synchronous event listeners can be set up below ---

  // Phone and OTP Submission Logic
  //document.getElementById('phone-submit').onclick = async () => {
  //  let raw = document.getElementById('phone-input').value.replace(/\D/g, '');
  //  if (raw.length === 11 && raw.startsWith('1')) {
  //    raw = raw.slice(1);
  //  }
  //  if (raw.length !== 10) {
  //    alert('Enter a valid 10-digit phone.');
  //    return;
  //  }
  //  try {
  //    await initRecaptcha();
  //    const confirmation = await auth.signInWithPhoneNumber('+1' + raw, window.recaptchaVerifier);
  //    window.confirmationResult = confirmation;
  //    document.getElementById('otp-entry').style.display = 'block';
  //  } catch (err) {
  //    console.error('signInWithPhoneNumber error:', err);
  //    alert('SMS not sent: ' + err.message);
  //  }
  //};

  //document.getElementById('otp-submit').onclick = async () => {
  //  const code = document.getElementById('otp-input').value.trim();
  //  if (code.length !== 6) {
  //    alert('Enter the 6-digit code.');
  //    return;
  //  }
  //  try {
  //    const cred = await window.confirmationResult.confirm(code);
  //    const user = cred.user;
  //    currentPhone = user.phoneNumber.replace('+1', '');
  //    savePhone(currentPhone);
  //    const snap = await db.collection('members').doc(currentPhone).get();
  //    if (!snap.exists) {
  //      alert('No membership record found. Please sign up first.');
  //      return;
  //    }
  //    const data = snap.data();
  //    currentName = data.name || data.Name || 'No Name';
  //    isFirstLogin = false;
  //    document.getElementById('phone-entry').style.display = 'none';
  //    document.getElementById('signed-in').innerText = `Signed in as ${currentName}`;

  //    // After a manual login, unlock features and reload data to get user-specific content
  //    unlockLoggedInFeatures();
  //    await loadEventData();
  //  } catch (err) {
  //    console.error('OTP confirm error:', err);
  //    alert('Code incorrect: ' + err.message);
  //  }
  //};
  
  // Other button listeners
  document.getElementById('btn-see-all').onclick = () => {
    if (!currentPhone) {
      document.getElementById('phone-entry').style.display = 'flex';
      return;
    }
    showSeeAllModal('Going');
  };
  
  document.getElementById('comments-signin-btn').onclick = () => {
    document.getElementById('phone-entry').style.display = 'flex';
  };
});
// END REVISION

// ─── NEW: Sign-Up iframe popup logic ─────────────────────────────────────
const signUpBtn     = document.getElementById('sign-up');
const signupOverlay = document.getElementById('signup-overlay');
const signupClose   = document.getElementById('signup-close');
const signupIframe  = signupOverlay.querySelector('iframe');

// When they click “Sign Up,” grab the ref token and show the iframe
signUpBtn.onclick = () => {
  const params   = new URLSearchParams(window.location.search);
  const refToken = params.get('ref') || '';
  signupIframe.src        = `../signup.html?ref=${encodeURIComponent(refToken)}`;
  signupOverlay.style.display = 'block';
};

// Close button hides the iframe overlay again
signupClose.onclick = () => {
  signupOverlay.style.display = 'none';
};
// ────────────────────────────────────────────────────────────────────────


// 5a. Set up the UI for a logged-out user
function setupLoggedOutView() {
  // --- This is the new, more robust implementation ---
  
  // 1. Target the necessary elements
  const commentsWrapper = document.getElementById('comments-wrapper'); // Assuming a wrapper div exists
  const commentsList = document.getElementById('comments-list');
  const commentsOverlay = document.getElementById('comments-blur-overlay');

  // 2. Apply styles to create the blurred overlay effect
  if (commentsWrapper && commentsList && commentsOverlay) {
    // Make the wrapper a positioning context
    commentsWrapper.style.position = 'relative';

    // Blur the list of comments
    commentsList.style.filter = 'blur(8px)';
    commentsList.style.pointerEvents = 'none'; // Prevent interaction with blurred content

    // Ensure the overlay is visible and styled correctly
    commentsOverlay.style.position = 'absolute';
    commentsOverlay.style.top = '0';
    commentsOverlay.style.left = '0';
    commentsOverlay.style.width = '100%';
    commentsOverlay.style.height = '100%';
    commentsOverlay.style.display = 'flex';
    commentsOverlay.style.zIndex = '10';
  }

  // 3. Replace the "Signed in as..." text with a "Sign In" button
  const signedInContainer = document.getElementById('signed-in');
  if (signedInContainer) {
    signedInContainer.innerHTML = ''; // Clear existing text
    const headerSignInBtn = document.createElement('button');
    headerSignInBtn.textContent = 'Sign In';
    headerSignInBtn.className = 'btn-header-signin'; // Use this class to style in your CSS
    // Applying backup styles in case CSS class isn't set
    headerSignInBtn.style.cssText = `
      padding: 8px 16px; 
      border: none; 
      background-color: var(--brown, #8d6e63); 
      color: var(--gold, #fff); 
      border-radius: 20px; 
      cursor: pointer;
      font-size: 0.9rem;
    `;
    headerSignInBtn.onclick = () => {
      document.getElementById('phone-entry').style.display = 'flex';
    };
    signedInContainer.appendChild(headerSignInBtn);
  }
}

// 5b. When the user logs in, unlock all features
function unlockLoggedInFeatures() {
  // Remove the comment blur and hide the overlay
  const commentsWrapper = document.getElementById('comments-wrapper');
  const commentsList = document.getElementById('comments-list');
  const overlay = document.getElementById('comments-blur-overlay');
  
  if (commentsList) {
    commentsList.style.filter = 'none';
    commentsList.style.pointerEvents = 'auto';
  }
  if (overlay) {
    overlay.style.display = 'none';
  }
  if(commentsWrapper){
    commentsWrapper.style.position = 'static'; // Reset position
  }

  // Show the comment input widget
  const commentWidget = document.getElementById('comment-widget');
  commentWidget.style.display = 'block';
  commentWidget.style.marginBottom = '20px';


  // Load the user's current RSVP status to highlight the correct button
  loadRSVPList();
}

// 6. Load event data and initialize UI (runs for all users)
async function loadEventData() {
  if (!eventId) return;

  // 6a. If logged in, check admin flag to show admin-only buttons
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

  // 6b-1. Handle the “Create Event” form submission
  const createForm = document.getElementById('create-event-form');
  createForm.addEventListener('submit', async e => {
    e.preventDefault();

    // 1) Gather only the *event* fields (no tickets):
    const eventData = {
      title:       document.getElementById('new-event-name').value.trim(),
      date:        document.getElementById('new-event-date').value,
      time:        document.getElementById('new-event-time').value,
      address:     document.getElementById('new-event-address').value.trim(),
      description: document.getElementById('new-event-description').value.trim(),
      imageUrl:    document.getElementById('new-event-image').value.trim(),
      createdBy:   currentPhone,
      createdAt:   firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      // 2) First, create the *event* document without tickets:
      const evRef = await db.collection('events').add(eventData);

      // 3) Then for each ticket-row input, add a doc to the subcollection:
      const rows = document.querySelectorAll('.ticket-row-input');
      for (const row of rows) {
        const name  = row.querySelector('.ticket-name').value.trim();
        const desc  = row.querySelector('.ticket-desc').value.trim();
        const price = parseFloat(row.querySelector('.ticket-price').value) || 0;
        const link  = row.querySelector('.ticket-link').value.trim();

        if (name && link) {
          await db
            .collection('events')
            .doc(evRef.id)
            .collection('tickets')
            .add({
              name,
              description: desc,
              price,
              link
            });
        }
      }

      // 4) Finally, redirect to view the new event:
      window.location.href = `eventid.html?e=${evRef.id}`;
    } catch (err) {
      console.error('Error creating event and tickets:', err);
      alert('There was an error creating your event or tickets.');
    }

  });


  // 6c. Fetch event document
  const eventSnap = await db.collection('events').doc(eventId).get();
  if (!eventSnap.exists) {
    alert("Event not found.");
    return;
  }
  const e = eventSnap.data();

  // 6d) If the current user *is* the event’s host, show Payment Status
  if (currentPhone && e.createdBy === currentPhone) {
    const payBtn = document.getElementById('btn-payment-status');
    payBtn.style.display = 'inline-block';
    payBtn.onclick = showPaymentModal;
  }

  // Wire up the × in the payment modal
  document.getElementById('payment-modal-close')
    .addEventListener('click', () => {
      document.getElementById('payment-modal').style.display = 'none';
    });

  // Title, host
  document.getElementById('event-title').innerText = e.title || 'Untitled Event';
  if (e.createdBy) {
    db.collection('members').doc(e.createdBy).get().then(creatorSnap => {
        if (creatorSnap.exists) {
            const cData = creatorSnap.data();
            document.getElementById('event-host').innerText = 'Hosted by ' + (cData.name || cData.Name || 'Strangers');
        } else {
            document.getElementById('event-host').innerText = 'Hosted by ' + (e.host || 'Strangers');
        }
    });
  } else {
    document.getElementById('event-host').innerText = 'Hosted by ' + (e.host || 'Strangers');
  }

  // Image & dynamic gradient + meta tags
  if (e.imageUrl) {
    const eventImageEl = document.getElementById('event-image');
    eventImageEl.onload = () => {
      try {
        const colorThief = new ColorThief();
        const palette = colorThief.getPalette(eventImageEl, 5);
        const top4 = palette.slice(0, 4).map(c => `rgb(<span class="math-inline">\{c\[0\]\},</span>{c[1]},${c[2]})`);
        const gradient = `linear-gradient(to right, ${top4.join(', ')})`;
        const appEl = document.getElementById('app');
        appEl.style.setProperty('--event-gradient', gradient);
        appEl.classList.add('event-gradient-active');
      } catch (err) {
        console.error('Gradient extraction failed:', err);
      }
    };
    eventImageEl.src = e.imageUrl;
    document.title = e.title || 'Event Page';
    document.getElementById('page-title').innerText = e.title || 'Event Page';
    const ogImage = e.imageUrl || '../assets/ogimage.png';
    document.querySelector("meta[property='og:title']").setAttribute("content", e.title || '');
    document.querySelector("meta[property='og:image']").setAttribute("content", ogImage);
  }

  // Date & time
  if (e.date) document.getElementById('event-date').innerText = formatEventDate(e.date);
  if (e.time) document.getElementById('event-time').innerText = e.time;

  // Location & description
  document.getElementById('event-location').innerText = e.location || '';
  document.getElementById('event-description').innerText = e.description || '';

  // Calendar & share logic
  setupCalendarAndShare(e);



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

    if (memberSnap.exists && memberSnap.data().profilePic) {
      const img = makeAvatarImg(memberSnap.data().profilePic, 64);
      
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

// Revised showPaymentModal: shows modal immediately & loads names in parallel
async function showPaymentModal() {
  const listEl = document.getElementById('payment-list');
  const modal  = document.getElementById('payment-modal');

  // 1) Show modal immediately
  listEl.innerHTML = '<p>Loading…</p>';
  modal.style.display = 'flex';

  try {
    // 2) Fetch all “Going” / “Maybe” RSVPs
    const rsvpsSnap = await db.collection('events')
      .doc(eventId)
      .collection('rsvps')
      .where('status','in',['Going','Maybe'])
      .get();

    const phones = rsvpsSnap.docs.map(doc => doc.id);

    // 3) Load all member names in parallel
    const members = await Promise.all(phones.map(phone =>
      db.collection('members').doc(phone).get()
        .then(snap => ({
          phone,
          name: snap.exists ? snap.data().name : 'Unknown'
        }))
    ));

    // 4) Render checkboxes
    listEl.innerHTML = '';
    members.forEach(({ phone, name }) => {
      const parts = name.split(' ');
      const label = `${parts[0]} ${parts.slice(-1)[0][0]}.`; // “Alice B.”

      const row = document.createElement('div');
      row.style.margin = '0.5rem 0';

      const cb = document.createElement('input');
      cb.type          = 'checkbox';
      cb.dataset.phone = phone;

      row.append(cb, document.createTextNode(' ' + label));
      listEl.appendChild(row);
    });
  } catch (err) {
    console.error('Error loading payment list:', err);
    listEl.innerHTML = '<p style="color:red">Failed to load list</p>';
  }
}

// Replace the form submit with a plain Save button handler (no redirect)
document.getElementById('payment-save')
  .addEventListener('click', async () => {
    console.log('💾 Save clicked');
    const checked = document.querySelectorAll('#payment-list input:checked');
    for (const cb of checked) {
      const phone = cb.dataset.phone;
      const mSnap = await db.collection('members').doc(phone).get();
      const full  = mSnap.exists ? mSnap.data().name : '';
      const parts = full.split(' ');
      const text  = `${parts[0]} ${parts.slice(-1)[0][0]}. has paid`;

      await db.collection('events')
        .doc(eventId)
        .collection('comments')
        .add({
          text,
          green:    true,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
    // Close modal without redirect
    document.getElementById('payment-modal').style.display = 'none';
  });

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
    if (memberSnap.exists && memberSnap.data().profilePic) {
      const img = makeAvatarImg(memberSnap.data().profilePic, 64);
      
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

  const rsvpRef   = db.collection('events').doc(eventId).collection('rsvps').doc(currentPhone);
  const memberRef = db.collection('members').doc(currentPhone);
  // 1) fetch previous RSVP so we know if it really changed
  const prevSnap    = await rsvpRef.get();
  const prevStatus  = prevSnap.exists ? prevSnap.data().status : null;

  await db.runTransaction(async tx => {
    const doc       = await tx.get(rsvpRef);
    const prevData  = doc.exists ? doc.data() : {};
    const prevSt    = prevData.status;

    // compute old vs new points
    const pts       = { Going: 10, Maybe: 5, NotGoing: 1 };
    const oldPts    = prevSt ? (pts[prevSt] || 0) : 0;
    const newPts    = pts[status];
    const delta     = newPts - oldPts;

    // 1) write the new RSVP (and carry forward if we already gave referral)
    tx.set(rsvpRef, {
      status,
      updatedAt:        firebase.firestore.FieldValue.serverTimestamp(),
      referrerAwarded:  prevData.referrerAwarded || false
    }, { merge: true });

    // 2) only update your sPoints by the net delta
    if (delta !== 0) {
      tx.update(memberRef, {
        sPoints: firebase.firestore.FieldValue.increment(delta)
      });
    }

    // 3) if first‐ever RSVP, referrer exists, and user has 0 points, award bonus
    if (!doc.exists && referrerPhone) {
      // read rsvp’ing user’s current sPoints
      const userSnap = await tx.get(memberRef);
      const currentPts = userSnap.exists
        ? (userSnap.data().sPoints || 0)
        : 0;

      if (currentPts < 17) {
        const refMemRef   = db.collection('members').doc(referrerPhone);
        const referralPts = status === 'Going' ? 200 : 50;
        tx.update(refMemRef, {
          sPoints: firebase.firestore.FieldValue.increment(referralPts)
        });
        tx.update(rsvpRef, { referrerAwarded: true }, { merge: true });
      }
    }
  });

  
 // 4) only add a system comment if the status is different than before
 if (prevStatus !== status) {
   const sysText = `${currentName} marked as *${status}*`;
   await db
     .collection('events')
     .doc(eventId)
     .collection('comments')
     .add({
       text:      sysText,
       system:    true,
       timestamp: firebase.firestore.FieldValue.serverTimestamp()
     });
 }

  // 5) update the active class on the RSVP buttons
  document.querySelectorAll('.rsvp-button').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`btn-${status.toLowerCase()}`).classList.add('active');

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

// 10. Load comments (runs for all users)
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
      const isSysComment = c.system === true;

      // Apply special styling directly to the main row container
      if (isGreenComment) {
        row.style.backgroundColor = '#01796F'; // Pine Green
        row.style.color = 'white';
        row.style.borderRadius = '8px'; // Ensure consistent border-radius
      }

      if (isSysComment) {
        row.style.backgroundColor = '#bdafa2'; // Pine Green
        row.style.color = 'white';
        row.style.borderRadius = '8px'; // Ensure consistent border-radius
      }

      // ── Avatar (conditionally rendered) ──
      if (!isGreenComment) {
        const avatarEl = document.createElement('div');
        avatarEl.className = 'comment-avatar';

        if (c.user && member && member.profilePic) {
          avatarEl.innerHTML = '';
          const img = makeAvatarImg(memberSnap.data().profilePic, 64);
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

      if (c.user && c.user === currentPhone) {
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
  container.style.marginBottom = '30px';

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
        if (memSnap.exists && memSnap.data().profilePic) {
          avatarEl.innerHTML = '';
          const img = makeAvatarImg(memberSnap.data().profilePic, 64);
          
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

// 13. Load user's RSVP status (only after login)
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
      const storageRef = storage.ref(`events/<span class="math-inline">\{eventId\}/comments/</span>{currentPhone}_${timestamp}_${file.name}`);
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

// ---- START REVISION: Award up to 30 pts/day (3 pts/comment) ----
const memberRef = db.collection('members').doc(currentPhone);

// count how many comments they've posted since midnight
const startOfDay = new Date();
startOfDay.setHours(0,0,0,0);
const todaySnap = await db.collection('events')
  .doc(eventId)
  .collection('comments')
  .where('user','==', currentPhone)
  .where('timestamp','>=',
         firebase.firestore.Timestamp.fromDate(startOfDay))
  .get();

const ptsSoFar  = todaySnap.size * 3;
const canGive   = ptsSoFar < 30 ? Math.min(3, 30 - ptsSoFar) : 0;
if (canGive > 0) {
  await memberRef.update({
    sPoints: firebase.firestore.FieldValue.increment(canGive)
  });
}

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
    const storageRef = storage.ref(`events/<span class="math-inline">\{eventId\}/comments/</span>{parentId}_reply_${currentPhone}_${timestamp}_${file.name}`);
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
    
  // ---- START REVISION: Award sPoints for replying ----
  try {
    const memberRef = db.collection('members').doc(currentPhone);
    await memberRef.update({
      sPoints: firebase.firestore.FieldValue.increment(3)
    });
  } catch (err) {
    console.error("Failed to award sPoints for reply:", err);
    // This is a non-critical error, so we don't need to alert the user.
  }
  // ---- END REVISION ----

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
      const img      = makeAvatarImg(memberSnap.data().profilePic, 64);
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
  // “Add to Calendar” → build & download .ics
  document.getElementById('btn-calendar').onclick = () => {
    // parse date
    const [y, m, d] = e.date.split('-').map(Number);

    // parse time, supporting both "HH:MM" and "H:MMAM/PM"
    const timeStr = (e.time || '').trim();
    let hours = 0, minutes = 0;
    const ampmMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (ampmMatch) {
      // 12-hour format
      hours   = parseInt(ampmMatch[1], 10);
      minutes = parseInt(ampmMatch[2], 10);
      const suffix = ampmMatch[3].toUpperCase();
      if (suffix === 'PM' && hours < 12) hours += 12;
      if (suffix === 'AM' && hours === 12) hours = 0;
    } else {
      // assume 24-hour "HH:MM"
      const parts = timeStr.split(':').map(p => parseInt(p, 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        hours = parts[0];
        minutes = parts[1];
      }
    }

    const startDt = new Date(y, m - 1, d, hours, minutes);

    // duration (in minutes) or default to 180
    const durationMin = typeof e.duration === 'number' ? e.duration : 180;
    const endDt = new Date(startDt.getTime() + durationMin * 60000);

    // helper to format as UTC YYYYMMDDTHHMMSSZ
    const fmtUTC = dt => {
      const pad = n => n.toString().padStart(2, '0');
      return dt.getUTCFullYear()
        + pad(dt.getUTCMonth() + 1)
        + pad(dt.getUTCDate()) + 'T'
        + pad(dt.getUTCHours())
        + pad(dt.getUTCMinutes())
        + pad(dt.getUTCSeconds()) + 'Z';
    };

    const dtstamp = fmtUTC(new Date());
    const dtstart = fmtUTC(startDt);
    const dtend   = fmtUTC(endDt);
    const uid     = `${eventId}@yourapp.com`;
    const title   = e.title.replace(/[\r\n]/g, ' ');
    const desc    = (e.description || '').replace(/[\r\n]/g, '\\n');
    const loc     = (e.location || '').replace(/[\r\n]/g, ' ');

    // build lines, omitting LOCATION if empty
    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//YourApp//EN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${desc}`,
      ...(loc ? [`LOCATION:${loc}`] : []),
      `URL:${window.location.href}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ];

    const blob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${title || 'event'}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };



  document.getElementById('btn-share-event').onclick = async () => {
    if (!navigator.share) {
      alert('Web Share API not supported');
      return;
    }
    if (!currentPhone) {
      alert('You need to be signed in to share.');
      return;
    }

    // 1) Make sure OG meta tags are up to date
    const ogImage = e.imageUrl || '../assets/ogimage.png';
    document.querySelector("meta[property='og:image']").content = ogImage;
    document.querySelector("meta[property='og:title']").content = e.title;

    // 2) Preload the image into cache so the share sheet can pick it up immediately
    await new Promise(resolve => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = resolve;
      img.src = ogImage;
    });

    // 3) Ensure we have a canonical SHA-256 hash stored on the user record
    const userRef = db.collection('members').doc(currentPhone);
    const userSnap = await userRef.get();
    let hashHex = userSnap.exists && userSnap.data().hashedPhone;
    if (!hashHex) {
      // compute raw SHA-256 hex digest
      const phoneBytes = new TextEncoder().encode(currentPhone);
      const digest = await crypto.subtle.digest('SHA-256', phoneBytes);
      const hashArray = Array.from(new Uint8Array(digest));
      hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      // store it for future
      await userRef.set({ hashedPhone: hashHex }, { merge: true });
    }

    // 4) Build the referral token (4 random chars + reversedHash + 4 random chars)
    const reversedHash = hashHex.split('').reverse().join('');
    const randChars = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      return Array.from({ length: 4 }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length))
      ).join('');
    };
    const finalToken = randChars() + reversedHash + randChars();

    // 5) Build the full URL with ?e=…&ref=…
    const baseURL = window.location.origin + window.location.pathname;
    const shareURL = `${baseURL}?e=${encodeURIComponent(eventId)}&ref=${encodeURIComponent(finalToken)}`;

    // 6) Fire the native share sheet
    try {
      await navigator.share({
        title: e.title,
        text:  `Join me at ${e.title}`,
        url:   shareURL
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
          <h3 style="margin:0; color:#333;"><span class="math-inline">${t.name}</h3\>
          <p style\="margin\:0\.25rem 0; color\:\#555;"\></span>${t.description}</p>
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