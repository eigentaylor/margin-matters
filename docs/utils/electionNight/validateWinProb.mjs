#!/usr/bin/env node
'use strict';

/**
 * Historical validation for the live national win-probability estimate
 * (docs/election-night.js: computeUnitPosterior / runNationalWinProbabilityMC
 * / updateNationalWinProbability).
 *
 * Checks two things a live-updating win probability absolutely must get
 * right, or it's actively misleading:
 *   1. Calibration — across many historical elections, races the model
 *      called "~70% D" should actually go D roughly 70% of the time,
 *      aggregated across the whole corpus (not any single election).
 *   2. Not overconfident early — when very little of the vote is counted,
 *      the model should still be leaning heavily on its polling-based prior
 *      (which carries real uncertainty), not snapping to near-certainty
 *      before there's a legitimate reason to.
 *
 * Like validateConfidence.mjs, this does NOT reimplement the posterior/
 * Monte-Carlo math in Node — it lives entirely inside election-night.js's
 * browser-coupled closure. Instead this drives the real app headlessly,
 * stepping through many progress checkpoints per historical year (rather
 * than one big jump to 100%, since we want the whole probability
 * trajectory, not just the final answer) and reads back a debug-only
 * window._enProbLog array (gated behind window.ENABLE_EN_PROB_LOG, mirroring
 * the existing window.ENABLE_EN_COLOR_CALL_LOG / window._enCallLog pattern)
 * pushed from inside updateNationalWinProbability() with
 * {time, nationalReporting, probD, actualWinner, actualMargin} per entry —
 * actualWinner/actualMargin are ground truth, fine to read here since this
 * is test-only instrumentation the live algorithm itself never consults.
 *
 * Usage:
 *   npm start                                                  # serves docs/ on :8080
 *   npm install --no-save d3@7 topojson-client@3 us-atlas@3    # one-time, see below
 *   node docs/utils/electionNight/validateWinProb.mjs [baseUrl]
 *
 * index.html loads d3/topojson-client/us-atlas from a public CDN. If your
 * network can already reach that CDN, the extra npm install above isn't
 * needed. In sandboxed/offline environments, this script intercepts those
 * CDN requests and serves the matching versions from local node_modules
 * instead (see installCdnFallbacks below) so the page can still initialize.
 *
 * What to do with the output: this is meant to be run BEFORE trusting
 * REMAINING_DELTA_SIGMA_BASE/REMAINING_DELTA_SIGMA_MAIL_HEAVY (currently
 * 0.12/0.22, initial guesses) — the same way CONFIDENCE_JUNCTION_RAW was
 * validated rather than shipped on guesswork. If the calibration table or
 * the overconfidence check comes back bad, raise those constants in
 * docs/election-night.js and re-run.
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

const PROB_BUCKETS = Array.from({ length: 10 }, (_, i) => ({
  label: `[${i * 10}-${(i + 1) * 10}%)`,
  min: i / 10,
  max: (i + 1) / 10
}));

function bucketFor(probD) {
  const idx = Math.min(9, Math.floor(probD * 10));
  return PROB_BUCKETS[idx].label;
}

const LANDSLIDE_MARGIN = 0.10; // 10-point electoral-college margin (share of full pool) or wider

async function runYear(page, year) {
  await page.evaluate(() => {
    window._enProbLog = [];
    const resetBtn = document.getElementById('enReset');
    if (resetBtn) resetBtn.click();
  });

  await page.evaluate((y) => {
    const slider = document.getElementById('yearSlider');
    slider.value = String(y);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, year);

  // Step through many checkpoints (not one big jump) so we get the whole
  // probability trajectory for this year, not just the final answer. Each
  // step is a forward seek via the same deterministic advanceDeterministic()
  // path the progress-bar scrubber uses.
  for (let p = 5; p <= 100; p += 5) {
    await page.evaluate((val) => {
      const progress = document.getElementById('enProgress');
      progress.value = String(val / 100);
      progress.dispatchEvent(new Event('input', { bubbles: true }));
    }, p);
  }

  return page.evaluate(() => window._enProbLog || []);
}

async function main() {
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
  );
  const page = await browser.newPage();
  await page.addInitScript(() => { window.ENABLE_EN_PROB_LOG = true; });
  page.on('pageerror', err => console.error('[page exception]', err));
  await installCdnFallbacks(page);

  console.log(`Loading ${PAGE_URL} ...`);
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window._byYearMap && window._byYearMap.size > 0, { timeout: 30000 });

  const years = await page.evaluate(() => Array.from(window._byYearMap.keys()).sort((a, b) => a - b));
  console.log(`Found ${years.length} years of data: ${years[0]}-${years[years.length - 1]}\n`);

  const buckets = new Map(PROB_BUCKETS.map(b => [b.label, { total: 0, demWins: 0 }]));
  const overconfidentEarly = [];
  const spreadByReportingDecile = new Map(); // reporting-decile index -> [ev spread, ...]
  let totalSamples = 0;

  for (const year of years) {
    let entries;
    try {
      entries = await runYear(page, year);
    } catch (err) {
      console.error(`  ! ${year}: failed to run (${err.message})`);
      continue;
    }

    entries.forEach(e => {
      if (!e || !isFinite(e.probD)) return;
      totalSamples++;
      const bucket = buckets.get(bucketFor(e.probD));
      if (bucket) {
        bucket.total++;
        if (e.actualWinner === 'D') bucket.demWins++;
      }

      const isLandslide = Math.abs(e.actualEvMargin != null ? e.actualEvMargin : e.actualMargin) >= LANDSLIDE_MARGIN;
      if (e.nationalReporting < 0.15 && (e.probD > 0.90 || e.probD < 0.10) && !isLandslide) {
        overconfidentEarly.push({
          year, reporting: e.nationalReporting, probD: e.probD,
          actualMargin: e.actualMargin, actualEvMargin: e.actualEvMargin, actualWinner: e.actualWinner
        });
      }

      if (Array.isArray(e.evRange90)) {
        const spread = e.evRange90[1] - e.evRange90[0];
        const decile = Math.min(9, Math.floor(e.nationalReporting * 10));
        if (!spreadByReportingDecile.has(decile)) spreadByReportingDecile.set(decile, []);
        spreadByReportingDecile.get(decile).push(spread);
      }
    });

    console.log(`  ${year}: ${entries.length} probability samples`);
  }

  await browser.close();

  console.log('\n=== Calibration (reliability) across all years/checkpoints ===');
  console.log('  bucket          total   D-win rate   (expect roughly the bucket midpoint)');
  for (const b of PROB_BUCKETS) {
    const stats = buckets.get(b.label);
    const rate = stats.total > 0 ? (100 * stats.demWins / stats.total).toFixed(1) : '—';
    console.log(`  ${b.label.padEnd(14)} ${String(stats.total).padStart(6)}   ${String(rate).padStart(6)}%`);
  }
  console.log(`  TOTAL samples: ${totalSamples}`);

  console.log('\n=== Overconfidence check (reporting < 15%, probD > 90% or < 10%, non-landslide) ===');
  if (overconfidentEarly.length) {
    overconfidentEarly.forEach(d => {
      console.log(`  ${d.year}: reporting=${(d.reporting * 100).toFixed(1)}%  probD=${(d.probD * 100).toFixed(1)}%  EV margin=${(d.actualEvMargin * 100).toFixed(1)}pt  PV margin=${(d.actualMargin * 100).toFixed(1)}pt  winner=${d.actualWinner}`);
    });
  } else {
    console.log('  None found.');
  }

  console.log('\n=== CI narrows as reporting increases (mean [5%,95%] EV spread per reporting decile) ===');
  const avgSpreadByDecile = [];
  for (let d = 0; d < 10; d++) {
    const samples = spreadByReportingDecile.get(d) || [];
    const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
    avgSpreadByDecile.push(avg);
    console.log(`  reporting [${d * 10}-${(d + 1) * 10}%): ${avg != null ? avg.toFixed(1) + ' EV' : 'no samples'} (n=${samples.length})`);
  }
  const definedSpreads = avgSpreadByDecile.map((v, i) => ({ v, i })).filter(x => x.v != null);
  let narrowingOk = true;
  if (definedSpreads.length >= 2) {
    const first = definedSpreads[0].v;
    const last = definedSpreads[definedSpreads.length - 1].v;
    narrowingOk = last <= first; // should trend narrower overall, not required to be strictly monotonic
    console.log(`  Overall trend: ${first.toFixed(1)} EV -> ${last.toFixed(1)} EV (${narrowingOk ? 'narrows as expected' : 'DOES NOT narrow — investigate'})`);
  }

  console.log('\n=== Decision ===');
  // Simple calibration score: mean absolute error between each bucket's
  // rate and its midpoint, weighted by sample count.
  let weightedErr = 0, weightedN = 0;
  for (const b of PROB_BUCKETS) {
    const stats = buckets.get(b.label);
    if (!stats.total) continue;
    const mid = (b.min + b.max) / 2;
    const rate = stats.demWins / stats.total;
    weightedErr += Math.abs(rate - mid) * stats.total;
    weightedN += stats.total;
  }
  const calibrationMAE = weightedN > 0 ? weightedErr / weightedN : null;
  console.log(`Calibration MAE across buckets: ${calibrationMAE != null ? (calibrationMAE * 100).toFixed(1) + 'pt' : 'n/a (no samples)'}`);

  if (calibrationMAE != null && calibrationMAE <= 0.08 && overconfidentEarly.length === 0 && narrowingOk) {
    console.log('SAFE: calibration looks reasonable, no early-overconfidence cases, and CI narrows as expected. Ship REMAINING_DELTA_SIGMA_* as-is.');
  } else if (overconfidentEarly.length > 0) {
    console.log(`CAUTION: ${overconfidentEarly.length} early-overconfidence case(s) found — raise REMAINING_DELTA_SIGMA_BASE/REMAINING_DELTA_SIGMA_MAIL_HEAVY and re-run.`);
  } else if (!narrowingOk) {
    console.log('CAUTION: the EV spread does not narrow as reporting increases — check computeUnitPosterior/runNationalWinProbabilityMC for a bug before trusting the calibration numbers above.');
  } else {
    console.log(`CAUTION: calibration MAE (${(calibrationMAE * 100).toFixed(1)}pt) is higher than the 8pt target — consider tuning REMAINING_DELTA_SIGMA_*/POLL_ERROR_SPEC and re-run.`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
