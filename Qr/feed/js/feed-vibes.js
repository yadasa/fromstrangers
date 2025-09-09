/* feed-vibes.js – feed slider card (auto-save on release)
 *
 * - Pull one random unanswered slider from Vibes / Values / Vision
 * - Style to exactly match /css/vibes.css (uses .range-slider + JS gradient)
 * - Auto-save to localStorage + Firestore (best-effort) on release
 *
 * Public (global):
 *   window.VIBES_pickRandomUnanswered({ db, phone })
 *   window.VIBES_renderCard(questionObj, { db, phone, onSaved })
 */

/* ------------------ tiny helpers ------------------ */
function _loadLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function _saveLocal(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function _cap(s='') { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/* ---- gradient/slider behavior (mirrors vibes.css + vibes.js look) ---- */
function _applySliderGradient(slider) {
  // Track is transparent in CSS; we paint the gradient here.
  // We mimic a center accent that fades, left/right dark/cream bands like your site.
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const val = parseFloat(slider.value);
  const pct = ((val - min) / (max - min)) * 100;

  // Tuned to resemble your design (cream center, dark bands)
  const center = 50;
  const feather = 2; // soft blend around center
  let bg;
  if (val >= 0) {
    const from = center - feather;
    bg = `linear-gradient(to right,
      #FFFFFF 0%,
      #FFFFFF ${from}%,
      #DCC9B8 ${center}%,
      #1A1A1A ${pct}%,
      #FFFFFF ${pct}%,
      #FFFFFF 100%)`;
  } else {
    const to = center + feather;
    bg = `linear-gradient(to right,
      #FFFFFF 0%,
      #FFFFFF ${pct}%,
      #1A1A1A ${pct}%,
      #DCC9B8 ${center}%,
      #FFFFFF ${to}%,
      #FFFFFF 100%)`;
  }
  slider.style.background = bg;
}
function _wireSliderGradient(slider) {
  const update = () => _applySliderGradient(slider);
  slider.addEventListener('input', update, { passive: true });
  // initialize
  update();
}

/* ------------------ Catalog from vibes.html / vibes.js ------------------ */
/* Vibes q1..q20 + named */
const VIBES_MAP = {
  budget: { label: "What's the maximum you'd be willing to spend per outing?", min:'<$5', max:'$75+' },
  q1:  { label: 'How talkative are you?',                                    min:'Quiet',               max:'Chatty' },
  q2:  { label: 'Do you seek excitement or calm?',                            min:'Adrenaline',          max:'Relaxation' },
  q3:  { label: 'When you recharge, do you prefer…?',                         min:'Alone-Time',          max:'Group-Time' },
  q4:  { label: 'How active do you like your activities?',                    min:'Active',              max:'Passive' },
  q5:  { label: 'What’s your ideal setting?',                                 min:'Nature',              max:'City' },
  q6:  { label: 'When are you at your best?',                                 min:'Daytime',             max:'Nighttime' },
  q7:  { label: 'How do you prefer to spend on outings?',                     min:'Budget-Friendly',     max:'Splurge' },
  q8:  { label: 'Do you focus on details or possibilities?',                  min:'Concrete Details',    max:'Big Picture' },
  q9:  { label: 'How do you make decisions?',                                 min:'Heartfelt Connections', max:'Objective Analysis' },
  q10: { label: 'What do you prioritize at an event?',                        min:'Foodie Focus',        max:'Activity Focus' },
  q11: { label: 'How do you approach decisions?',                             min:'Decisive',            max:'Adaptable' },
  q12: { label: 'How do you handle plans?',                                   min:'Structured',          max:'Flexible' },
  q13: { label: 'What pace suits you best?',                                  min:'Fast-Paced',          max:'Slow-Paced' },
  q14: { label: 'How do you approach new experiences?',                       min:'Risk-Taking',         max:'Cautious' },
  q15: { label: 'Do you prefer new ideas or tried methods?',                  min:'Innovator',           max:'Traditionalist' },
  q16: { label: 'How do you like to present yourself?',                       min:'Photogenic',          max:'Low-Key' },
  q17: { label: 'How do you express yourself?',                               min:'Reserved',            max:'Expressive' },
  q18: { label: 'Do you stick with familiar spots or seek new ones?',         min:'Local Hangout',       max:'Explore New' },
  q19: { label: 'What’s your problem-solving style?',                         min:'Analytical',          max:'Creative' },
  q20: { label: 'What’s your goal for activities?',                           min:'Skill-Build',         max:'Just Fun' },
  chillVsCompetitive:  { label:'Chill vs. Competitive',        min:'Chill',     max:'Competitive' },
  indoorsVsOutdoors:   { label:'Indoors vs. Outdoors',         min:'Indoors',   max:'Outdoors' },
  plannedVsSpontaneous:{ label:'Planned vs. Spontaneous',      min:'Planned',   max:'Spontaneous' },
  quietVsVibrant:      { label:'Quiet vs. Vibrant',            min:'Quiet',     max:'Vibrant' },
  smallVsLarge:        { label:'Small Groups vs. Large Groups',min:'Small',     max:'Large' }
};

/* Values va1..va25 */
const VALUES_MAP = {
  va1:{label:'Lead with values or charm?',min:'Values',max:'Charm'},
  va2:{label:'Prioritize impact or comfort?',min:'Impact',max:'Comfort'},
  va3:{label:'Seek purpose or pleasure?',min:'Purpose',max:'Pleasure'},
  va4:{label:'Master one field or explore many?',min:'Depth',max:'Breadth'},
  va5:{label:'Stay true or adapt on the fly?',min:'Authenticity',max:'Adaptability'},
  va6:{label:'Lift others or lift yourself?',min:'Service',max:'Self-Advancement'},
  va7:{label:'Honor tradition or spark change?',min:'Tradition',max:'Transformation'},
  va8:{label:'Play it safe or dive into the unknown?',min:'Security',max:'Adventure'},
  va9:{label:'Give back or get ahead?',min:'Give Back',max:'Get Ahead'},
  va10:{label:'Speak bluntly or keep the peace?',min:'Honesty',max:'Harmony'},
  va11:{label:'Think it through or follow your heart?',min:'Reason',max:'Emotion'},
  va12:{label:'Absorb knowledge or share wisdom?',min:'Learning',max:'Teaching'},
  va13:{label:'Feel with others or stay objective?',min:'Empathy',max:'Objectivity'},
  va14:{label:'Avoid risk or chase reward?',min:'Risk-Averse',max:'Risk-Seeking'},
  va15:{label:'Invent new paths or follow proven roads?',min:'Innovation',max:'Reliability'},
  va16:{label:'Follow passion or plan carefully?',min:'Passion',max:'Prudence'},
  va17:{label:'Show your colors or blend in?',min:'Expression',max:'Restraint'},
  va18:{label:'Blend with the crowd or stand out?',min:'Community',max:'Individuality'},
  va19:{label:'Push boundaries or stay grounded?',min:'Growth',max:'Stability'},
  va20:{label:'Juggle many things or focus on one?',min:'Multitasking',max:'Focus'},
  va21:{label:'Think long-term or live in the moment?',min:'Legacy',max:'Present'},
  va22:{label:'Take bold leaps or tread carefully?',min:'Boldness',max:'Caution'},
  va23:{label:'Share openly or guard secrets?',min:'Openness',max:'Privacy'},
  va24:{label:'Honor the past or innovate now?',min:'Heritage',max:'Progress'},
  va25:{label:'See the horizon or notice every detail?',min:'Vision',max:'Detail'}
};

/* Vision vi1..vi25 */
const VISION_MAP = {
  vi1:{label:'Explore space or protect Earth’s nature?',min:'Space Explorer',max:'Earth Guardian'},
  vi2:{label:'Certainty or surprise?',min:'Certainty',max:'Surprise'},
  vi3:{label:'Chart unknown territories or navigate known paths?',min:'Explorer',max:'Navigator'},
  vi4:{label:'Build a company or spark a movement?',min:'Corporate Founder',max:'Activist'},
  vi5:{label:'Influence many or master one?',min:'Influence',max:'Mastery'},
  vi6:{label:'Write a bestselling book or start a legacy foundation?',min:'Author',max:'Philanthropist'},
  vi7:{label:'Launch a startup or guide a nonprofit?',min:'Startup Founder',max:'Nonprofit Leader'},
  vi8:{label:'Broad network or deep bonds?',min:'Network',max:'Bonds'},
  vi9:{label:'Achieve global fame or local respect?',min:'Global Star',max:'Community Hero'},
  vi10:{label:'Amass wealth or gain wisdom?',min:'Wealth',max:'Wisdom'},
  vi11:{label:'Own your time or lead an industry?',min:'Time Freedom',max:'Industry Leader'},
  vi12:{label:'Assets or experiences?',min:'Assets',max:'Experiences'},
  vi13:{label:'Live in a smart city or off-grid retreat?',min:'Smart City',max:'Off-Grid'},
  vi14:{label:'Automate everything or craft by hand?',min:'Automation',max:'Artisanal'},
  vi15:{label:'Solo success or shared victory?',min:'Solo',max:'Shared'},
  vi16:{label:'Shape policies or create new markets?',min:'Policy-Maker',max:'Market-Maker'},
  vi17:{label:'Dream big or map every detail?',min:'Visionary',max:'Planner'},
  vi18:{label:'Plan for the distant future or focus on today?',min:'Futurist',max:'Nowist'},
  vi19:{label:'Raise a big family or mentor through your work?',min:'Family',max:'Mentorship'},
  vi20:{label:'Have unlimited leisure or endless productivity?',min:'Leisure',max:'Productivity'},
  vi21:{label:'Hold a steady job or chase freelance freedom?',min:'Steady Job',max:'Freelance'},
  vi22:{label:'Fast-track your career or savor each step?',min:'Fast-Track',max:'Savour'},
  vi23:{label:'Own a private retreat or host a vibrant hub?',min:'Private Retreat',max:'Public Space'},
  vi24:{label:'Big dreams or small joys?',min:'Dreams',max:'Joys'},
  vi25:{label:'Stay connected 24/7 or unplug weekly?',min:'Always On',max:'Weekly Off'}
};

/* Build master keys to iterate */
const VIBE_KEYS   = ['budget', ...Array.from({length:20},(_,i)=>`q${i+1}`),
  'chillVsCompetitive','indoorsVsOutdoors','plannedVsSpontaneous','quietVsVibrant','smallVsLarge'];
const VALUES_KEYS = Array.from({length:25},(_,i)=>`va${i+1}`);
const VISION_KEYS = Array.from({length:25},(_,i)=>`vi${i+1}`);

/* ------------------ pick random unanswered ------------------ */
async function VIBES_pickRandomUnanswered(ctx = {}) {
  const { db, phone } = ctx;
  // If you don't pass db/phone, we still pick using localStorage only.
  let remote = {};
  if (db && phone) {
    try {
      const snap = await db.collection('members').doc(phone).get();
      remote = snap.exists ? (snap.data() || {}) : {};
    } catch { remote = {}; }
  }

  const local = _loadLocal('vibes_answers', { vibes:{}, values:{}, vision:{} });

  const answers = {
    vibes:  { ...(remote.vibes  || {}), ...(local.vibes  || {}) },
    values: { ...(remote.values || {}), ...(local.values || {}) },
    vision: { ...(remote.vision || {}), ...(local.vision || {}) }
  };

  const unanswered = [];

  // Vibes
  for (const key of VIBE_KEYS) {
    if (!(key in answers.vibes)) {
      const meta = VIBES_MAP[key];
      if (meta) unanswered.push({
        section:'vibes', key, value:0,
        label: meta.label, minLabel: meta.min, maxLabel: meta.max
      });
    }
  }
  // Values
  for (const key of VALUES_KEYS) {
    if (!(key in answers.values)) {
      const meta = VALUES_MAP[key];
      if (meta) unanswered.push({
        section:'values', key, value:0,
        label: meta.label, minLabel: meta.min, maxLabel: meta.max
      });
    }
  }
  // Vision
  for (const key of VISION_KEYS) {
    if (!(key in answers.vision)) {
      const meta = VISION_MAP[key];
      if (meta) unanswered.push({
        section:'vision', key, value:0,
        label: meta.label, minLabel: meta.min, maxLabel: meta.max
      });
    }
  }

  if (!unanswered.length) return null;
  return _randPick(unanswered);
}

/* ------------------ render a feed card (auto-save) ------------------ */
/* ------------------ render a feed card (media-only, no header/footer) ------------------ */
function VIBES_renderCard(q, { db, phone, onSaved } = {}) {
  // <article class="post vibe-card"> with ONLY a media block inside
  const card = document.createElement('article');
  card.className = 'post vibe-card';

  // MEDIA container (matches feed media sizing & uses vibes.css internals)
  const media = document.createElement('div');
  media.className = 'post-media';

  // Inner wrapper styled by vibes.css
  const wrap = document.createElement('div');
  wrap.className = 'w-form';
  wrap.style.margin = '0 auto';        // keep compact inside post-media
  wrap.style.background = 'transparent'; // let post box show through
  wrap.style.padding = '16px 16px 12px';

  // Question title (matches vibes.css .slider-question)
  const qTitle = document.createElement('div');
  qTitle.className = 'slider-question';
  qTitle.textContent = q.label || `${(q.section||'').toUpperCase()} ${q.key}`;
  wrap.appendChild(qTitle);

  // Labels above slider (uses .slider-labels from vibes.css)
  const labels = document.createElement('div');
  labels.className = 'slider-labels';
  labels.innerHTML = `<span>${q.minLabel || 'Left'}</span><span>${q.maxLabel || 'Right'}</span>`;
  wrap.appendChild(labels);

  // Slider row (styled by .range-slider in vibes.css, gradient via helper)
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'slider-wrap';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'range-slider';
  slider.min = '-5';
  slider.max = '5';
  slider.step = '0.1';
  slider.value = '0';
  sliderWrap.appendChild(slider);
  wrap.appendChild(sliderWrap);

  // Subtle saved chip (no footer/actions)
  const savedChip = document.createElement('div');
  savedChip.style.fontSize = '0.8rem';
  savedChip.style.textAlign = 'right';
  savedChip.style.opacity = '0';
  savedChip.style.transition = 'opacity 200ms ease';
  savedChip.textContent = '';
  wrap.appendChild(savedChip);

  // assemble
  media.appendChild(wrap);
  card.appendChild(media);

  // little top margin between the "media" and (nonexistent) caption, per your request
  // (kept minimal; no caption/footer added)
  card.style.marginBottom = '0.5rem';

  // gradient wiring (same behavior as vibes page)
  if (typeof _wireSliderGradient === 'function') {
    _wireSliderGradient(slider);
  }

  // AUTO-SAVE to localStorage + best-effort Firestore on release
  const doSave = async () => {
    const val = Number(slider.value) || 0;

    // local overlay (same key used elsewhere so other pages can read it)
    const stash = (function _load() {
      try { return JSON.parse(localStorage.getItem('vibes_answers')) || { vibes:{}, values:{}, vision:{} }; }
      catch { return { vibes:{}, values:{}, vision:{} }; }
    })();

    const section = q.section || 'vibes';
    stash[section] = stash[section] || {};
    stash[section][q.key] = val;
    try { localStorage.setItem('vibes_answers', JSON.stringify(stash)); } catch {}

    // firestore best-effort merge
    if (db && phone) {
      try {
        await db.collection('members').doc(phone)
          .set({ [section]: { ...(stash[section] || {}), [q.key]: val } }, { merge: true });
      } catch (_) { /* non-blocking */ }
    }

    // confirmation
    savedChip.textContent = 'Saved ✓';
    savedChip.style.opacity = '1';
    setTimeout(() => { savedChip.style.opacity = '0'; }, 900);

    if (typeof onSaved === 'function') onSaved({ section, key: q.key, value: val });
  };

  // save on release (same UX as vibes page)
  let dirty = false;
  slider.addEventListener('input', () => { dirty = true; }, { passive: true });
  const release = () => { if (dirty) { dirty = false; doSave(); } };
  slider.addEventListener('change',    release);
  slider.addEventListener('pointerup', release, { passive: true });
  slider.addEventListener('touchend',  release, { passive: true });
  slider.addEventListener('mouseup',   release, { passive: true });

  // mount into feed
  document.getElementById('feed').appendChild(card);
  return card;
}


/* -------------- expose to global -------------- */
window.VIBES_pickRandomUnanswered = VIBES_pickRandomUnanswered;
window.VIBES_renderCard = VIBES_renderCard;
