// feed/js/feed-core.js

(async function main() {
  // Wait for auth so we can prefer “not-RSVP’d” future event
  await window.FEED_AUTH_READY;

  // First prefetch to warm pools
  await Promise.all([
    window.FEED_DATA.prefetchFutureEvents(),
    window.FEED_DATA.prefetchRecentMedia()
  ]);

  // Page 1 (starts w/ future un-RSVP’d event, then videos/images, plus slot 3&7 injections)
  await loadNextFeedPage();

  // Infinite scroll sentinel
  ensureInfiniteScroll();

  // Fallback button
  const more = document.getElementById('load-more');
  more.style.display = 'block';
  more.onclick = loadNextFeedPage;
})();

let isLoading = false;
async function loadNextFeedPage() {
  if (isLoading) return;
  isLoading = true;
  try {
    const queue = await window.FEED_DATA.buildNextRenderQueuePage();
    await window.FEED_RENDER.renderQueue(queue);
  } catch (e) {
    console.error('Feed page load failed', e);
  }
  isLoading = false;
}

function ensureInfiniteScroll() {
  let sentinel = document.getElementById('feed-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'feed-sentinel';
    sentinel.style.height = '1px';
    document.body.appendChild(sentinel);
  }
  const io = new IntersectionObserver(async (entries) => {
    if (entries[0].isIntersecting) await loadNextFeedPage();
  }, { root: null, threshold: 0.1, rootMargin: '300px 0px' });
  io.observe(sentinel);
}
