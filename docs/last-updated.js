// Load and inject the last updated timestamp from last-updated.json
(function () {
  // Try a set of likely relative prefixes and accept only valid JSON responses.
  // Try parent-relative prefixes first so nested pages (e.g. docs/state/*)
  // will find the file at a higher level without first requesting
  // ./last-updated.json (which causes noisy 404s).
  const candidates = [
    '../', '../../', '../../../', '../../../../',
    './',
    '/docs/', '/' // try absolute roots as last resort
  ];

  async function tryFetch(prefix) {
    try {
      const res = await fetch(prefix + 'last-updated.json', { cache: 'no-store' });
      if (!res.ok) return null;
      const text = await res.text();
      // quick reject obvious HTML payloads (starts with '<')
      if (text.trim().startsWith('<')) return null;
      try {
        return JSON.parse(text);
      } catch (e) {
        return null;
      }
    } catch (e) {
      return null;
    }
  }

  (async function load() {
    let data = null;
    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i];
      data = await tryFetch(p);
      if (data && data.lastUpdated) {
        break;
      }
    }

    if (!data || !data.lastUpdated) {
      console.warn('Could not load last-updated.json: no valid JSON found at tried prefixes');
      return;
    }

    const timestamp = data.lastUpdated;
    // Find all elements with data-last-updated attribute and update them
    document.querySelectorAll('[data-last-updated]').forEach(el => {
      el.textContent = 'Last updated: ' + timestamp;
    });
  })();

})();
