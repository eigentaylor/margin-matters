#!/usr/bin/env node
'use strict';

/**
 * Historical sweep for RETRACTION_THRESHOLD_FRACTION (docs/election-night.js:
 * a called unit is retracted "too close to call" once its confidence falls
 * back under `threshold * RETRACTION_THRESHOLD_FRACTION`, currently 0.5).
 *
 * There was no principled way to pick that 0.5 - it was a reasonable-looking
 * guess. This script drives the real app headlessly (same approach as
 * validateConfidence.mjs) across every historical year, for several
 * candidate fraction values, and reports for each value:
 *   - how many retractions happen in total, and per year
 *   - how long each retraction's "too close to call" limbo actually lasts
 *     (recall time - retraction time), which should respect the
 *     RETRACTED_MIN_DWELL_MINUTES floor
 *   - the "wasted retraction" rate: how often the call we retracted was
 *     actually already correct (its leader matched the unit's ground-truth
 *     winner) - a false alarm, since we walked back a call that didn't need
 *     walking back
 *
 * A good fraction is the one that catches genuine near-misses without
 * generating an excessive wasted-retraction rate. Lower the fraction and
 * retractions get rarer (only very confident-then-collapsing calls qualify);
 * raise it and more calls get second-guessed, including some that were fine.
 *
 * Usage:
 *   npm start                                          # serves docs/ on :8080
 *   node docs/utils/electionNight/validateRetraction.mjs [baseUrl]
 */

import { resolveBaseUrl, installCdnFallbacks, launchChromium } from './harness.mjs';

const BASE_URL = resolveBaseUrl();
const PAGE_URL = `${BASE_URL}/index.html`;

const CANDIDATE_FRACTIONS = [0.3, 0.4, 0.5, 0.6, 0.7];

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function runYear(page, year, fraction) {
  await page.evaluate(() => {
    window._enCallLog = [];
    window._enRetractionLog = [];
    const resetBtn = document.getElementById('enReset');
    if (resetBtn) resetBtn.click();
  });

  await page.evaluate((f) => { window.RETRACTION_THRESHOLD_FRACTION_OVERRIDE = f; }, fraction);

  await page.evaluate((y) => {
    const slider = document.getElementById('yearSlider');
    slider.value = String(y);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, year);

  await page.evaluate(() => {
    const conf = document.getElementById('enConfidence');
    if (conf) {
      conf.value = '0.15';
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
  const retractionLog = await page.evaluate(() => window._enRetractionLog || []);
  return { callLog, retractionLog };
}

async function main() {
  const browser = await launchChromium();
  const page = await browser.newPage();
  await page.addInitScript(() => { window.ENABLE_EN_COLOR_CALL_LOG = true; });
  page.on('pageerror', err => console.error('[page exception]', err));
  await installCdnFallbacks(page);

  console.log(`Loading ${PAGE_URL} ...`);
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window._byYearMap && window._byYearMap.size > 0, { timeout: 30000 });

  const years = await page.evaluate(() => Array.from(window._byYearMap.keys()).sort((a, b) => a - b));
  console.log(`Found ${years.length} years of data: ${years[0]}-${years[years.length - 1]}\n`);
  console.log(`Sweeping RETRACTION_THRESHOLD_FRACTION over: ${CANDIDATE_FRACTIONS.join(', ')}\n`);

  const results = [];

  for (const fraction of CANDIDATE_FRACTIONS) {
    let totalRetractions = 0;
    const dwellTimes = [];
    let wastedRetractions = 0;
    const perYearCounts = [];

    for (const year of years) {
      let result;
      try {
        result = await runYear(page, year, fraction);
      } catch (err) {
        console.error(`  ! fraction ${fraction}, ${year}: failed to run (${err.message})`);
        continue;
      }
      const { callLog, retractionLog } = result;
      if (retractionLog.length) perYearCounts.push({ year, count: retractionLog.length });
      totalRetractions += retractionLog.length;

      // Pair each retraction with its unit's two chronological call-log
      // entries (original call, then eventual recall) - registerCall()
      // pushes one entry per call, so a retracted-then-recalled unit
      // naturally produces exactly two entries for the same unitKey.
      retractionLog.forEach(retraction => {
        const unitCalls = callLog
          .filter(c => c.unit === retraction.unitKey)
          .sort((a, b) => a.time - b.time);
        const originalCall = unitCalls.find(c => c.time < retraction.time - 1e-6);
        const recall = unitCalls.find(c => c.time > retraction.time + 1e-6);
        if (recall) dwellTimes.push(recall.time - retraction.time);
        if (originalCall && originalCall.leader === originalCall.actualWinner) wastedRetractions++;
      });
    }

    results.push({
      fraction,
      totalRetractions,
      yearsWithRetraction: perYearCounts.length,
      avgDwell: dwellTimes.length ? dwellTimes.reduce((a, b) => a + b, 0) / dwellTimes.length : null,
      medianDwell: median(dwellTimes),
      minDwell: dwellTimes.length ? Math.min(...dwellTimes) : null,
      wastedRetractions,
      wastedRate: totalRetractions ? (100 * wastedRetractions / totalRetractions) : null
    });
    console.log(`fraction ${fraction}: ${totalRetractions} retraction(s) across ${perYearCounts.length} year(s)`);
  }

  await browser.close();

  console.log('\n=== Summary by RETRACTION_THRESHOLD_FRACTION ===');
  console.log('fraction  retractions  years-affected  avg-dwell-min  median-dwell-min  wasted-rate');
  results.forEach(r => {
    const avgDwell = r.avgDwell != null ? r.avgDwell.toFixed(1) : '—';
    const medDwell = r.medianDwell != null ? r.medianDwell.toFixed(1) : '—';
    const wastedRate = r.wastedRate != null ? `${r.wastedRate.toFixed(1)}%` : '—';
    console.log(
      `${String(r.fraction).padEnd(9)}${String(r.totalRetractions).padEnd(13)}${String(r.yearsWithRetraction).padEnd(16)}${avgDwell.padEnd(15)}${medDwell.padEnd(18)}${wastedRate}`
    );
  });

  console.log('\n=== Guidance ===');
  console.log('Prefer the lowest fraction whose wasted-rate stays low (few "we retracted a call that was fine") -');
  console.log('raising the fraction catches more genuine near-misses but also second-guesses more correct calls.');
  console.log(`Current shipped default: RETRACTION_THRESHOLD_FRACTION = 0.5 (see docs/election-night.js).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
