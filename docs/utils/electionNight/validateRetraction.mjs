#!/usr/bin/env node
'use strict';

/**
 * Historical sweep for WRONG_CALL_RETRACTION_THRESHOLD_FRACTION
 * (docs/election-night.js: a WRONG call - one whose called leader doesn't
 * match the unit's ground-truth winner - is retracted "too close to call"
 * once its confidence falls back under
 * `threshold * WRONG_CALL_RETRACTION_THRESHOLD_FRACTION`, currently 0.85).
 * A correct-but-tightening call keeps using the separate, lower
 * RETRACTION_THRESHOLD_FRACTION (0.5) untouched by this sweep.
 *
 * calculateConfidence() always sorts to the current top two candidates, so
 * it passes through 0 by construction at the exact tick the raw leader
 * flips. A wrong call's retraction cutoff needs to sit far enough above 0
 * that "too close to call" doesn't land on the same tick as the leader
 * actually flipping to the true winner (the "breaking news: X takes the
 * lead" moment, logged via registerLeadFlip()/window._enLeadFlipLog) - a gap
 * that used to be a single tick before this constant was split out from the
 * correct-call one. This script drives the real app headlessly (same
 * approach as validateConfidence.mjs) across every historical year, for
 * several candidate fraction values, and reports for each value:
 *   - how many wrong-call retractions happen in total, and per year
 *   - how long each retraction's "too close to call" limbo actually lasts
 *     (recall time - retraction time), which should respect the
 *     RETRACTED_MIN_DWELL_MINUTES floor
 *   - the gap between each wrong-call retraction and the next lead-flip
 *     notice for the same unit (if any) - the metric that actually matters
 *     here, since a near-zero gap is exactly the "simultaneous-looking"
 *     symptom this constant exists to fix
 *   - the "wasted retraction" rate among ALL retractions (wrong-call and
 *     correct-call together): how often the call we retracted was actually
 *     already correct - a false alarm, since we walked back a call that
 *     didn't need walking back. Included as a sanity check that raising the
 *     wrong-call cutoff hasn't perturbed correct-call retractions, which it
 *     shouldn't since they use an unrelated constant.
 *
 * A good fraction is the one that clears a comfortable retraction-to-flip
 * gap without generating an excessive wasted-retraction rate. Lower the
 * fraction and the gap shrinks back toward zero; raise it and retractions
 * (and the gap) happen earlier, but more calls get second-guessed while
 * still arguably "fine in the moment".
 *
 * Usage:
 *   npm start                                          # serves docs/ on :8080
 *   node docs/utils/electionNight/validateRetraction.mjs [baseUrl]
 */

import { resolveBaseUrl, installCdnFallbacks, launchChromium } from './harness.mjs';

const BASE_URL = resolveBaseUrl();
const PAGE_URL = `${BASE_URL}/index.html`;

const CANDIDATE_FRACTIONS = [0.6, 0.7, 0.8, 0.85, 0.9];

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
    window._enLeadFlipLog = [];
    const resetBtn = document.getElementById('enReset');
    if (resetBtn) resetBtn.click();
  });

  await page.evaluate((f) => { window.WRONG_CALL_RETRACTION_THRESHOLD_FRACTION_OVERRIDE = f; }, fraction);

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
  const leadFlipLog = await page.evaluate(() => window._enLeadFlipLog || []);
  return { callLog, retractionLog, leadFlipLog };
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
  console.log(`Sweeping WRONG_CALL_RETRACTION_THRESHOLD_FRACTION over: ${CANDIDATE_FRACTIONS.join(', ')}\n`);

  const results = [];

  for (const fraction of CANDIDATE_FRACTIONS) {
    let totalRetractions = 0;
    let wrongCallRetractions = 0;
    const dwellTimes = [];
    const flipGaps = [];
    const retractConfidences = [];
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
      const { callLog, retractionLog, leadFlipLog } = result;
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
        const wasWrong = originalCall && originalCall.leader !== originalCall.actualWinner;
        if (!wasWrong) {
          wastedRetractions++;
          return;
        }
        wrongCallRetractions++;
        if (isFinite(retraction.confidence)) retractConfidences.push(retraction.confidence);
        // Nearest lead-flip notice for this unit strictly after the
        // retraction - kept as a sanity check that it stays comfortably
        // non-zero, but this doesn't discriminate well between fraction
        // values on its own: the post-retraction "surge toward the true
        // winner" bias curve (computeRetractionSurgeBiasParams) re-paces
        // the subsequent flip relative to *when retraction happened*, not
        // relative to a fixed clock, so it tends to land a similar number
        // of minutes later regardless of the fraction. The metric that
        // actually moves with the fraction is retractConfidences below:
        // a higher fraction retracts at a higher (less collapsed)
        // confidence, i.e. further ahead of where the ORIGINAL, pre-surge
        // curve would have organically crossed over on its own - which is
        // the real fix for "too close to call" reading as simultaneous
        // with the flip.
        const nextFlip = leadFlipLog
          .filter(f => f.unitKey === retraction.unitKey && f.time > retraction.time + 1e-6)
          .sort((a, b) => a.time - b.time)[0];
        if (nextFlip) flipGaps.push(nextFlip.time - retraction.time);
      });
    }

    results.push({
      fraction,
      totalRetractions,
      wrongCallRetractions,
      yearsWithRetraction: perYearCounts.length,
      avgDwell: dwellTimes.length ? dwellTimes.reduce((a, b) => a + b, 0) / dwellTimes.length : null,
      medianDwell: median(dwellTimes),
      minDwell: dwellTimes.length ? Math.min(...dwellTimes) : null,
      avgFlipGap: flipGaps.length ? flipGaps.reduce((a, b) => a + b, 0) / flipGaps.length : null,
      medianFlipGap: median(flipGaps),
      minFlipGap: flipGaps.length ? Math.min(...flipGaps) : null,
      avgRetractConfidence: retractConfidences.length ? retractConfidences.reduce((a, b) => a + b, 0) / retractConfidences.length : null,
      medianRetractConfidence: median(retractConfidences),
      wastedRetractions,
      wastedRate: totalRetractions ? (100 * wastedRetractions / totalRetractions) : null
    });
    console.log(`fraction ${fraction}: ${totalRetractions} retraction(s) (${wrongCallRetractions} wrong-call) across ${perYearCounts.length} year(s)`);
  }

  await browser.close();

  console.log('\n=== Summary by WRONG_CALL_RETRACTION_THRESHOLD_FRACTION ===');
  console.log('fraction  retractions  wrong-call  median-retract-confidence  median-dwell-min  median-flip-gap-min  wasted-rate');
  results.forEach(r => {
    const medConf = r.medianRetractConfidence != null ? r.medianRetractConfidence.toFixed(3) : '—';
    const medDwell = r.medianDwell != null ? r.medianDwell.toFixed(1) : '—';
    const medFlipGap = r.medianFlipGap != null ? r.medianFlipGap.toFixed(1) : '—';
    const wastedRate = r.wastedRate != null ? `${r.wastedRate.toFixed(1)}%` : '—';
    console.log(
      `${String(r.fraction).padEnd(9)}${String(r.totalRetractions).padEnd(13)}${String(r.wrongCallRetractions).padEnd(12)}${medConf.padEnd(27)}${medDwell.padEnd(18)}${medFlipGap.padEnd(21)}${wastedRate}`
    );
  });

  console.log('\n=== Guidance ===');
  console.log('median-retract-confidence is the primary tuning signal: it is how far above 0 (the organic leader-flip');
  console.log('point calculateConfidence() always crosses through) each retraction actually fires at - low values mean');
  console.log('retraction is still landing right on top of the flip, same as the original bug. Prefer the lowest');
  console.log('fraction whose median-retract-confidence clears a comfortable margin above 0 without pushing wasted-rate');
  console.log('up much (wasted-rate should stay close to its pre-change baseline, since correct-call retractions use the');
  console.log('separate, unaffected RETRACTION_THRESHOLD_FRACTION). median-flip-gap is a secondary sanity check only -');
  console.log('it tends to land around the same value across fractions because the post-retraction "surge toward the');
  console.log('true winner" bias curve re-paces relative to when retraction happened, not a fixed clock.');
  console.log(`Current shipped default: WRONG_CALL_RETRACTION_THRESHOLD_FRACTION = 0.85 (see docs/election-night.js).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
