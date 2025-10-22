// Dynamically load and inject the "back to map" and "last updated" elements
(function () {
  function createBackToMap(isInner = false) {
    const prefix = isInner ? '..' : '.';

    const backToMapHTML = `
      <div style="margin-top:12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <a class="back" href="${prefix}/index.html">← Back to Map</a>
        <div class="legend" style="font-size:0.85rem" data-last-updated>Last updated: ...</div>
      </div>
    `;

    return backToMapHTML;
  }

  function injectBackToMap() {
    // Find the placeholder element
    const placeholder = document.getElementById('back-to-map-placeholder');
    if (!placeholder) {
      console.warn('Back to map placeholder not found');
      return;
    }

    // Determine if this is an inner page (in a subdirectory)
    const isInner = placeholder.getAttribute('data-is-inner') === 'true';

    // Inject the back to map element
    placeholder.innerHTML = createBackToMap(isInner);
    // Start a short poll to wait for last-updated to be filled by
    // a separately-loaded script (e.g. last-updated.js). If after the
    // timeout the placeholder still contains the '...' sentinel, try a
    // few fallback fetches and populate the element ourselves.
    const LAST_UPDATED_SELECTOR = '[data-last-updated]';
    const sentinel = 'Last updated: ...';

    let attempts = 0;
    const maxAttempts = 10; // try for ~5 seconds (500ms interval)
    const intervalMs = 500;

    function tryPopulate(text) {
      const el = placeholder.querySelector(LAST_UPDATED_SELECTOR);
      if (el) el.textContent = text;
    }

    const poll = setInterval(() => {
      attempts += 1;
      const el = placeholder.querySelector(LAST_UPDATED_SELECTOR);
      if (!el) return;
      const txt = el.textContent && el.textContent.trim();
      // If another script filled a timestamp (not the sentinel), stop polling
      if (txt && txt !== sentinel) {
        clearInterval(poll);
        return;
      }
      if (attempts >= maxAttempts) {
        clearInterval(poll);
        // Try fallback fetches from a small set of likely prefixes.
        const prefixes = ['./', '../', '/margin-matters/docs/', '/margin-matters/'];
        (async function tryFallbacks() {
          for (let i = 0; i < prefixes.length; i++) {
            const prefix = prefixes[i];
            try {
              const url = prefix + 'last-updated.json';
              // Use no-cache to prefer fresh data
              const res = await fetch(url, { cache: 'no-store' });
              if (!res.ok) continue;
              const txt = await res.text();
              if (!txt || txt.trim().startsWith('<')) continue;
              let data = null;
              try { data = JSON.parse(txt); } catch (e) { data = null; }
              if (data && data.lastUpdated) {
                tryPopulate('Last updated: ' + data.lastUpdated);
                return;
              }
            } catch (e) {
              // ignore network errors for a given prefix
            }
          }
          // If we reach here, no fallback succeeded: leave the sentinel so
          // it's obvious the timestamp wasn't found.
        })();
      }
    }, intervalMs);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBackToMap);
  } else {
    injectBackToMap();
  }
})();
