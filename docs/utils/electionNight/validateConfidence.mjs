#!/usr/bin/env node
'use strict';

/**
 * Historical validation for the election-night confidence-display rescale
 * (docs/utils/formatters.js: rescaleConfidenceForDisplay / CONFIDENCE_JUNCTION_RAW).
 *
 * The rescale only changes how a raw confidence value is *displayed*
 * (e.g. raw 0.3 -> "99%") — it never changes when a call actually fires
 * (calculateConfidence / shouldCallState / state.confidenceThreshold are
 * untouched). The premise for squishing raw 0.3-1.0 into display 99%-100%
 * is that calls made at raw confidence >= 0.3 have historically almost
 * always matched the eventual result. This script checks that premise
 * against every unit in every historical election year, rather than taking
 * it on faith.
 *
 * It does NOT reimplement the confidence/bias/reporting-schedule math in
 * Node — that logic lives entirely inside the browser-coupled
 * election-night.js closure, and a from-scratch reimplementation would risk
 * silently drifting from what the app actually does. Instead this drives
 * the real app headlessly: it loads docs/index.html, and for each
 * historical year, forces the call threshold to 0.3, fast-forwards the
 * simulation to completion via the same deterministic seek mechanism the
 * progress-bar scrubber uses (advanceDeterministic, triggered by setting
 * #enProgress to 1), then reads back every call record (each already
 * carries both the called leader and the ground-truth final winner,
 * st.winner, baked in by registerCall()).
 *
 * Usage:
 *   npm start                                          # serves docs/ on :8080
 *   npm install --no-save d3@7 topojson-client@3 us-atlas@3   # one-time, see below
 *   node docs/utils/electionNight/validateConfidence.mjs [baseUrl]
 *
 * index.html loads d3/topojson-client/us-atlas from a public CDN. If your
 * network can already reach that CDN, the extra npm install above isn't
 * needed. In sandboxed/offline environments, this script intercepts those
 * CDN requests and serves the matching versions from local node_modules
 * instead (see installCdnFallbacks below) so the page can still initialize.
 *
 * Decision rule (see the plan / commit message for full reasoning):
 *   - Zero miscalls at raw confidence >= 0.3 => ship CONFIDENCE_JUNCTION_RAW = 0.3.
 *   - Miscalls cluster just above 0.3 but vanish above some r* => raise the
 *     junction to r* (display only; the call threshold itself stays as-is).
 *   - Any miscall at raw confidence >= 0.999 => don't squish that far; cap
 *     the upper piece below 100% until reporting is fully complete instead.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const BASE_URL = process.argv[2] || 'http://127.0.0.1:8080';
const PAGE_URL = `${BASE_URL}/index.html`;

// index.html loads d3/topojson-client/us-atlas from a public CDN, which this
// sandboxed environment's egress policy blocks. Serve the same versions from
// local node_modules instead (installed via `npm install --no-save d3@7
// topojson-client@3 us-atlas@3`) so the page can still initialize offline.
const CDN_ROUTES = [
  { match: 'https://cdn.jsdelivr.net/npm/d3@7', file: path.join(REPO_ROOT, 'node_modules/d3/dist/d3.js'), contentType: 'application/javascript' },
  { match: 'https://cdn.jsdelivr.net/npm/topojson-client@3', file: path.join(REPO_ROOT, 'node_modules/topojson-client/dist/topojson-client.js'), contentType: 'application/javascript' },
  { match: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json', file: path.join(REPO_ROOT, 'node_modules/us-atlas/states-10m.json'), contentType: 'application/json' }
];

async function installCdnFallbacks(page) {
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

const CONFIDENCE_BUCKETS = [
  { label: '[0.3-0.5)', min: 0.3, max: 0.5 },
  { label: '[0.5-0.8)', min: 0.5, max: 0.8 },
  { label: '[0.8-0.999)', min: 0.8, max: 0.999 },
  { label: '[0.999-1.0]', min: 0.999, max: Infinity }
];

function bucketFor(confidence) {
  for (const b of CONFIDENCE_BUCKETS) {
    if (confidence >= b.min && confidence < b.max) return b.label;
  }
  return confidence >= 1 ? '[0.999-1.0]' : 'below 0.3 (should not happen at default threshold)';
}

async function runYear(page, year) {
  await page.evaluate(() => {
    window._enCallLog = [];
    const resetBtn = document.getElementById('enReset');
    if (resetBtn) resetBtn.click();
  });

  await page.evaluate((y) => {
    const slider = document.getElementById('yearSlider');
    slider.value = String(y);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, year);

  await page.evaluate(() => {
    const conf = document.getElementById('enConfidence');
    if (conf) {
      conf.value = '0.3';
      conf.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // Fast-forward the whole simulation synchronously via the same
  // deterministic-seek code path the progress-bar scrubber uses.
  await page.evaluate(() => {
    const progress = document.getElementById('enProgress');
    progress.value = '1';
    progress.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const callLog = await page.evaluate(() => window._enCallLog || []);

  // Best-effort near-tie flag: read raw historical vote totals for this
  // year directly from the same data source buildStateData() reads
  // (window._byYearMap), independent of the call log, so we can surface
  // units where the final margin was ~0 votes regardless of whether they
  // happened to be called correctly.
  const nearTies = await page.evaluate((y) => {
    const rows = (window._byYearMap && window._byYearMap.get(y)) || [];
    return rows
      .filter(r => r && r.unit && r.unit !== 'NATIONAL')
      .map(r => ({ unit: r.unit, dVotes: Number(r.dVotes) || 0, rVotes: Number(r.rVotes) || 0 }))
      .filter(r => Math.abs(r.dVotes - r.rVotes) <= 1)
      .map(r => r.unit);
  }, year);

  return { callLog, nearTies };
}

async function main() {
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
  );
  const page = await browser.newPage();
  await page.addInitScript(() => { window.ENABLE_EN_COLOR_CALL_LOG = true; });
  page.on('pageerror', err => console.error('[page exception]', err));
  await installCdnFallbacks(page);

  console.log(`Loading ${PAGE_URL} ...`);
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window._byYearMap && window._byYearMap.size > 0, { timeout: 30000 });

  const years = await page.evaluate(() => Array.from(window._byYearMap.keys()).sort((a, b) => a - b));
  console.log(`Found ${years.length} years of data: ${years[0]}-${years[years.length - 1]}\n`);

  const buckets = new Map(CONFIDENCE_BUCKETS.map(b => [b.label, { total: 0, miscalls: 0 }]));
  const miscallDetails = [];
  const nearTieUnits = new Set();
  const nearTieMiscalls = [];
  let totalCalls = 0;

  for (const year of years) {
    let result;
    try {
      result = await runYear(page, year);
    } catch (err) {
      console.error(`  ! ${year}: failed to run (${err.message})`);
      continue;
    }
    const { callLog, nearTies } = result;
    nearTies.forEach(u => nearTieUnits.add(`${year} ${u}`));

    callLog.forEach(entry => {
      if (!entry || !isFinite(entry.confidence)) return;
      totalCalls++;
      const label = bucketFor(entry.confidence);
      const bucket = buckets.get(label);
      if (bucket) bucket.total++;
      const isMiscall = entry.actualWinner && entry.leader && entry.actualWinner !== entry.leader;
      if (isMiscall) {
        if (bucket) bucket.miscalls++;
        const detail = { year, unit: entry.unit, confidence: entry.confidence, called: entry.leader, actual: entry.actualWinner };
        miscallDetails.push(detail);
        if (nearTies.includes(entry.unit)) nearTieMiscalls.push(detail);
      }
    });

    console.log(`  ${year}: ${callLog.length} calls${nearTies.length ? `, ${nearTies.length} near-tie unit(s): ${nearTies.join(', ')}` : ''}`);
  }

  await browser.close();

  console.log('\n=== Miscall rate by raw-confidence bucket (threshold 0.3) ===');
  for (const b of CONFIDENCE_BUCKETS) {
    const stats = buckets.get(b.label);
    const rate = stats.total > 0 ? (100 * stats.miscalls / stats.total).toFixed(2) : '—';
    console.log(`  ${b.label.padEnd(14)} total=${String(stats.total).padStart(5)}  miscalls=${String(stats.miscalls).padStart(4)}  rate=${rate}%`);
  }
  console.log(`  ${'TOTAL'.padEnd(14)} total=${String(totalCalls).padStart(5)}  miscalls=${String(miscallDetails.length).padStart(4)}`);

  if (miscallDetails.length) {
    console.log('\n=== Miscalls (leader called != ground-truth winner) ===');
    miscallDetails.forEach(d => {
      console.log(`  ${d.year} ${d.unit}: called ${d.called} @ confidence ${d.confidence.toFixed(4)}, actual winner ${d.actual}`);
    });
  } else {
    console.log('\nNo miscalls found at raw confidence >= 0.3 across the full historical dataset.');
  }

  if (nearTieMiscalls.length) {
    console.log('\n=== Miscalls that were ALSO flagged as near-ties (most important to review) ===');
    nearTieMiscalls.forEach(d => {
      console.log(`  ${d.year} ${d.unit}: called ${d.called} @ confidence ${d.confidence.toFixed(4)}, actual winner ${d.actual}`);
    });
  } else if (nearTieUnits.size) {
    console.log(`\n${nearTieUnits.size} near-tie unit(s) flagged across all years; none of them were miscalled.`);
  }

  console.log('\n=== Decision ===');
  const highConfMiscalls = miscallDetails.filter(d => d.confidence >= 0.999);
  if (miscallDetails.length === 0) {
    console.log('SAFE: no miscalls at raw confidence >= 0.3. Ship CONFIDENCE_JUNCTION_RAW = 0.3 as designed.');
  } else if (highConfMiscalls.length === 0) {
    const minMiscallConf = Math.min(...miscallDetails.map(d => d.confidence));
    console.log(`CAUTION: ${miscallDetails.length} miscall(s) found, lowest at raw confidence ${minMiscallConf.toFixed(4)}.`);
    console.log(`Consider raising CONFIDENCE_JUNCTION_RAW above ${minMiscallConf.toFixed(2)} in docs/utils/formatters.js before shipping.`);
  } else {
    console.log(`UNSAFE: ${highConfMiscalls.length} miscall(s) found at raw confidence >= 0.999 (deep in the squished display band).`);
    console.log('Do not ship the aggressive squish as-is — cap the upper display piece below 100% (e.g. floor at 99.5%) instead.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
