// Load and inject the last updated timestamp from last-updated.json
(function () {
  // Build a prioritized list of candidate prefixes for last-updated.json.
  // Prefer relative and repo-aware locations (derived from the running
  // script URL and the current pathname) so we don't hit the absolute
  // site root (e.g. https://user.github.io/) which often 404s for
  // project pages hosted under a subpath.
  const candidates = [];

  // 1) Parent-relative attempts to handle nested pages first
  candidates.push('../', '../../', '../../../', '../../../../');

  // 2) Same-directory and relative
  candidates.push('./');

  // 3) Try to derive a base from the script tag that loaded this file.
  // If the script is served from /<repo>/docs/..., prefer that repo root.
  try {
    const scriptEl = document.currentScript || document.querySelector('script[src$="last-updated.js"]');
    if (scriptEl && scriptEl.src) {
      const u = new URL(scriptEl.src, location.href);
      // scriptDir ends with '/'
      const scriptDir = u.pathname.replace(/[^/]+$/, '');
      // Example: /<repo>/docs/
      candidates.push(scriptDir);
      // Try scriptDir + 'last-updated.json' by pushing the dir (fetch code appends filename)
      // Also try the parent of scriptDir (one level up) so docs/state pages work
      const parentDir = scriptDir.replace(/[^/]+\/$/, '').replace(/[^/]+$/, '') + '/';
      if (parentDir && parentDir !== scriptDir) candidates.push(parentDir);
    }
  } catch (e) {
    // ignore URL parsing problems
  }

  // 4) Derive the likely repository root from the pathname (e.g. '/margin-matters/')
  try {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const repoRoot = '/' + parts[0] + '/';
      // Prefer the repo root (deployed GitHub Pages for project pages
      // typically expose site files at /<repo>/...). Try both the
      // repo-root-relative and an absolute-origin URL so we land on
      // https://<user>.github.io/<repo>/last-updated.json when hosted.
      candidates.push(repoRoot + 'docs/');
      candidates.push(repoRoot);
      try {
        const originRepo = location.origin + repoRoot;
        candidates.push(originRepo);
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {}

  // 5) As a last, less-favored fallback, try absolute '/docs/' but avoid
  // probing the absolute site root '/' which commonly causes noisy 404s.
  candidates.push('/docs/');

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
      // swallow network errors silently (we'll warn once if nothing found)
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
      // Don't spam the console from multiple failed fetches; issue a single
      // concise warning so maintainers can notice the missing metadata.
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
