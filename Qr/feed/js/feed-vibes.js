// feed/js/feed-vibes.js

// Placeholder question banks. Replace/augment by reading from vibes.html if you later expose them.
const VIBES_BANK = {
  values: [
    { id:'val_optimism', q:'Are you more optimistic or cautious?' },
    { id:'val_social',   q:'Prefer big gatherings or small hangouts?' },
  ],
  vision: [
    { id:'vis_change',   q:'Move fast or perfect slowly?' },
    { id:'vis_focus',    q:'Depth or breadth right now?' },
  ],
  vibes: [
    { id:'vib_spont',    q:'Spontaneous or planned?' },
    { id:'vib_chill',    q:'High energy or chill?' },
  ]
};

function unansweredPool() {
  const answered = JSON.parse(localStorage.getItem('vibesAnswers')||'{}'); // {id:value}
  const all = [...VIBES_BANK.values, ...VIBES_BANK.vision, ...VIBES_BANK.vibes];
  return all.filter(q => !(q.id in answered));
}

async function VIBES_pickRandomUnanswered() {
  const pool = unansweredPool();
  if (!pool.length) return null;
  return pool[Math.floor(Math.random()*pool.length)];
}

async function VIBES_renderCard(item) {
  // item: { type:'vibe-question', id, q }
  const feed = document.getElementById('feed');
  const card = document.createElement('article');
  card.className = 'post vibe-card';
  card.innerHTML = `
    <div class="post-header">
      <div class="post-user">Question</div>
      <div class="post-sub">From vibes/values/vision</div>
    </div>
    <div class="post-media">
      <div class="vibe-wrap" style="padding:16px;">
        <div class="vibe-q" style="font-weight:bold;margin-bottom:10px;">${item.q}</div>
        <input type="range" min="-100" max="100" value="0" class="vibe-slider" />
        <div class="vibe-scale" style="display:flex;justify-content:space-between;font-size:12px;opacity:.7;margin-top:6px;">
          <span>Left</span><span>Right</span>
        </div>
        <button class="vibe-save" style="margin-top:10px;">Save</button>
      </div>
    </div>
  `;
  feed.appendChild(card);
  const saveBtn = card.querySelector('.vibe-save');
  const slider  = card.querySelector('.vibe-slider');
  saveBtn.onclick = () => {
    const store = JSON.parse(localStorage.getItem('vibesAnswers')||'{}');
    store[item.id] = parseInt(slider.value, 10);
    localStorage.setItem('vibesAnswers', JSON.stringify(store));
    saveBtn.textContent = 'Saved ✓';
  };
}

window.VIBES_pickRandomUnanswered = VIBES_pickRandomUnanswered;
window.VIBES_renderCard = VIBES_renderCard;
