#!/usr/bin/env node
'use strict';

/**
 * Historical validation for the live national win-probability estimate
 * (docs/election-night.js: computeUnitPosterior / runNationalWinProbabilityMC
 * / updateNationalWinProbability).
 *
 * Checks several things a live-updating win probability absolutely must get
 * right, or it's actively misleading:
 *   1. Calibration — across many historical elections, races the model
 *      called "~70% D" should actually go D roughly 70% of the time,
 *      aggregated across the whole corpus (not any single election).
 *   2. Not overconfident early — when very little of the vote is counted,
 *      the model should still be leaning heavily on its polling-based prior
 *      (which carries real uncertainty), not snapping to near-certainty
 *      before there's a legitimate reason to.
 *   3. Swing honesty — the live swing hierarchy (docs/utils/electionNight/
 *      liveSwing.js) infers a shared national/regional swing from
 *      currently-reporting units' own deviation from their priors. Its
 *      z-score (mean/sigma) should look roughly standard-normal across the
 *      corpus; a systematically nonzero early-game mean is the fingerprint
 *      of contamination (e.g. createBiasParams's early-count center-
 *      compression bias, which the earliest-reporting states share) being
 *      misread as a real national swing, not a bug in the math itself.
 *   4. Swing recovery — does the solved national swing actually converge on
 *      the true final national swing (priorNpvMargin vs. the real outcome)
 *      as reporting completes? This is also the "when did the model notice"
 *      pivot-point data a future commentary system would want.
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
 * {time, nationalReporting, probD, evRange90, actualWinner, actualMargin,
 * actualEvMargin, swingNational, swingNationalSigma, swingNationalZ,
 * swingRegions, swingNObs, priorNpvMargin} per entry — actualWinner/
 * actualMargin/priorNpvMargin are ground truth, fine to read here since this
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

import { resolveBaseUrl, installCdnFallbacks, launchChromium } from './harness.mjs';

const BASE_URL = resolveBaseUrl();
const PAGE_URL = `${BASE_URL}/index.html`;

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
  const browser = await launchChromium();
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

  // Early-game confidence: direct measurement of "how far from a coin flip
  // is the model when almost nothing has been counted" — the thing actually
  // asked about, not just a pass/fail overconfidence flag.
  const earlyGameDeviations = []; // |probD-0.5| for nationalReporting < 0.15

  // Swing honesty: z-scores of the live swing hierarchy's national estimate,
  // bucketed by whether the sample is "early" (reporting < 0.15) or not.
  const swingZAll = [];
  const swingZEarly = [];

  // Swing recovery: per-year, the final checkpoint's |solved - true| swing
  // error, and the first reporting fraction at which that error drops below
  // 1pt (the "when did the model notice" pivot point).
  const swingRecoveryByYear = [];

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

      if (e.nationalReporting < 0.15) earlyGameDeviations.push(Math.abs(e.probD - 0.5));

      if (isFinite(e.swingNationalZ)) {
        swingZAll.push(e.swingNationalZ);
        if (e.nationalReporting < 0.15) swingZEarly.push(e.swingNationalZ);
      }
    });

    // Swing recovery: compare the solved national swing against the true
    // final national swing (priorNpvMargin - actualMargin) at the last
    // checkpoint, and find the first reporting fraction where they're
    // within 1pt of each other — the "when did the model notice" pivot.
    const lastEntry = entries.length ? entries[entries.length - 1] : null;
    if (lastEntry && isFinite(lastEntry.priorNpvMargin) && isFinite(lastEntry.actualMargin)) {
      const trueSwing = lastEntry.priorNpvMargin - lastEntry.actualMargin;
      const finalSwing = isFinite(lastEntry.swingNational) ? lastEntry.swingNational : null;
      const finalError = finalSwing != null ? Math.abs(finalSwing - trueSwing) : null;
      let noticedAt = null;
      for (const e of entries) {
        if (!isFinite(e.swingNational)) continue;
        if (Math.abs(e.swingNational - trueSwing) < 0.01) { noticedAt = e.nationalReporting; break; }
      }
      swingRecoveryByYear.push({ year, trueSwing, finalSwing, finalError, noticedAt });
    }

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

  console.log('\n=== Early-game confidence (mean |probD-0.5|, reporting < 15%) ===');
  const meanEarlyDeviation = earlyGameDeviations.length
    ? earlyGameDeviations.reduce((a, b) => a + b, 0) / earlyGameDeviations.length : null;
  console.log(meanEarlyDeviation != null
    ? `  ${(meanEarlyDeviation * 100).toFixed(1)}pt from a coin flip on average (n=${earlyGameDeviations.length}) — 0pt would be a permanent coin flip, 50pt would be permanent certainty.`
    : '  no early-game samples');

  console.log('\n=== Swing honesty (live-swing z-score should look ~standard-normal) ===');
  function meanOf(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
  function stdOf(arr) {
    if (arr.length < 2) return null;
    const m = meanOf(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  }
  const zMeanAll = meanOf(swingZAll);
  const zStdAll = stdOf(swingZAll);
  const zMeanEarly = meanOf(swingZEarly);
  const outlierCount = swingZAll.filter(z => Math.abs(z) > 3).length;
  const outlierRate = swingZAll.length ? outlierCount / swingZAll.length : null;
  console.log(`  all samples (n=${swingZAll.length}): mean=${zMeanAll != null ? zMeanAll.toFixed(2) : 'n/a'}  std=${zStdAll != null ? zStdAll.toFixed(2) : 'n/a'} (expect mean~0, std~1)`);
  console.log(`  early samples, reporting<15% (n=${swingZEarly.length}): mean=${zMeanEarly != null ? zMeanEarly.toFixed(2) : 'n/a'} (expect ~0 — a nonzero mean here is the fingerprint of early-count contamination, e.g. createBiasParams's center-compression bias, being misread as a real national swing)`);
  console.log(`  |z|>3 outlier rate: ${outlierRate != null ? (outlierRate * 100).toFixed(1) + '%' : 'n/a'} (n=${outlierCount})`);
  const swingHonestyOk = (zMeanEarly == null || Math.abs(zMeanEarly) < 0.5) && (outlierRate == null || outlierRate < 0.05);
  console.log(`  ${swingHonestyOk ? 'OK' : 'FLAGGED'} — ${swingHonestyOk ? 'no sign of systematic early-count contamination' : 'early-game z-scores look systematically biased, not just noisy'}`);

  console.log('\n=== Swing recovery (does the solved swing converge on the true final swing?) ===');
  const finalErrors = swingRecoveryByYear.map(r => r.finalError).filter(isFinite);
  const meanFinalError = meanOf(finalErrors);
  console.log(`  mean |solved - true| national swing at final checkpoint: ${meanFinalError != null ? (meanFinalError * 100).toFixed(2) + 'pt' : 'n/a'} (n=${finalErrors.length})`);
  const worstRecovery = swingRecoveryByYear.slice().sort((a, b) => (b.finalError || 0) - (a.finalError || 0)).slice(0, 5);
  worstRecovery.forEach(r => {
    console.log(`  ${r.year}: true swing=${(r.trueSwing * 100).toFixed(1)}pt  solved=${r.finalSwing != null ? (r.finalSwing * 100).toFixed(1) + 'pt' : 'n/a'}  error=${r.finalError != null ? (r.finalError * 100).toFixed(1) + 'pt' : 'n/a'}  noticed at reporting=${r.noticedAt != null ? (r.noticedAt * 100).toFixed(0) + '%' : 'never (<1pt)'}`);
  });

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
