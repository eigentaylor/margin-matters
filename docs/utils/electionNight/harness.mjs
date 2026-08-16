'use strict';

/**
 * Shared Playwright test harness for the election-night validator scripts
 * (validateConfidence.mjs, validateWinProb.mjs). Both scripts drive the real
 * app headlessly rather than reimplementing its browser-coupled closure
 * logic in Node, and both need the exact same setup to do that: resolve a
 * base URL, launch Chromium (honoring PLAYWRIGHT_CHROMIUM_PATH for this
 * environment's pre-installed browser), and serve the CDN scripts index.html
 * loads from local node_modules when the sandbox's egress policy blocks the
 * real CDN. Extracted here so a future validator doesn't have to duplicate
 * it a third time.
 *
 * Usage in a validator script:
 *   npm start                                                  # serves docs/ on :8080
 *   npm install --no-save d3@7 topojson-client@3 us-atlas@3    # one-time, see below
 *   node docs/utils/electionNight/<script>.mjs [baseUrl]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.join(__dirname, '..', '..', '..');

/** Base URL for the served docs/ site: CLI arg (argv[2]) or the npm start default. */
export function resolveBaseUrl(argv = process.argv) {
  return argv[2] || 'http://127.0.0.1:8080';
}

// index.html/senate.html load d3/topojson-client/us-atlas from a public CDN,
// which this sandboxed environment's egress policy blocks. Serve the same
// versions from local node_modules instead (installed via `npm install
// --no-save d3@7 topojson-client@3 us-atlas@3`) so the page can still
// initialize offline.
export const CDN_ROUTES = [
  { match: 'https://cdn.jsdelivr.net/npm/d3@7', file: path.join(REPO_ROOT, 'node_modules/d3/dist/d3.js'), contentType: 'application/javascript' },
  { match: 'https://cdn.jsdelivr.net/npm/topojson-client@3', file: path.join(REPO_ROOT, 'node_modules/topojson-client/dist/topojson-client.js'), contentType: 'application/javascript' },
  { match: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json', file: path.join(REPO_ROOT, 'node_modules/us-atlas/states-10m.json'), contentType: 'application/json' }
];

/**
 * Intercepts jsdelivr requests on `page` and serves the matching local
 * fallback, aborting anything unmatched. If your network can already reach
 * the real CDN, calling this is harmless (routing just adds a redundant
 * local copy of the same files) but the `npm install --no-save` prerequisite
 * still applies since it asserts the local files exist first.
 */
export async function installCdnFallbacks(page) {
  for (const route of CDN_ROUTES) {
    if (!fs.existsSync(route.file)) {
      throw new Error(`Missing local fallback for ${route.match}: ${route.file}. Run: npm install --no-save d3@7 topojson-client@3 us-atlas@3`);
    }
  }
  await page.route('https://cdn.jsdelivr.net/**', async (routeHandle) => {
    const url = routeHandle.request().url();
    const found = CDN_ROUTES.find(r => url === r.match || url.startsWith(`${r.match}/`) || url.startsWith(`${r.match}?`));
    if (!found) {
      await routeHandle.abort();
      return;
    }
    await routeHandle.fulfill({ status: 200, contentType: found.contentType, body: fs.readFileSync(found.file) });
  });
}

/**
 * Launches Chromium, honoring PLAYWRIGHT_CHROMIUM_PATH when set (this
 * environment's pre-installed browser at a path Playwright's default
 * resolution doesn't always find) — see the repo's environment notes on
 * PLAYWRIGHT_BROWSERS_PATH/PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD.
 */
export async function launchChromium(extraOptions = {}) {
  const options = { ...extraOptions };
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  return chromium.launch(options);
}

export default { REPO_ROOT, resolveBaseUrl, CDN_ROUTES, installCdnFallbacks, launchChromium };
