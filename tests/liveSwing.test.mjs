import assert from 'assert';
import { solveLiveSwing, sampleSwing, unitSwingDelta, makeNormalizedTDraw } from '../docs/utils/electionNight/liveSwing.js';
import { POLL_ERROR_SPEC } from '../docs/utils/sim2028/pollCalibration.js';
import { mulberry32 } from '../docs/utils/randomUtils.js';

const spec = POLL_ERROR_SPEC;
const regionShare = Math.max(0, Math.min(1, spec.regionShare));
const tVarFactor = spec.df > 2 ? spec.df / (spec.df - 2) : 1;
const inflate = Math.sqrt(tVarFactor);

function fakeRegionOf(u) {
  if (u.startsWith('PA') || u.startsWith('MI') || u.startsWith('WI')) return 'rustBelt';
  if (u.startsWith('CA') || u.startsWith('OR')) return 'pacific';
  return null;
}

// --- 1. sigma decomposition identity -------------------------------------
(function testSigmaIdentity() {
  const solved = solveLiveSwing([], spec, fakeRegionOf);
  const nominalSum = (solved.sigmaN / inflate) ** 2 + (solved.sigmaR / inflate) ** 2 + (solved.sigmaI / inflate) ** 2;
  const priorSigmaNominal2 = spec.nationalSigma ** 2 + spec.unitSigmas ** 2;
  assert.ok(Math.abs(nominalSum - priorSigmaNominal2) < 1e-12,
    `sigmaN^2+sigmaR^2+sigmaI^2 (nominal) should equal nationalSigma^2+unitSigmas^2, got ${nominalSum} vs ${priorSigmaNominal2}`);
  console.log('PASS: sigmaN^2+sigmaR^2+sigmaI^2 == priorSigma^2 identity');
})();

// --- 2. zero-observation boundary: reproduces the pre-live-data prior ----
(function testZeroObservationBoundary() {
  const solved = solveLiveSwing([], spec, fakeRegionOf);
  assert.strictEqual(solved.national.mean, 0, 'national mean should be 0 with no observations');
  assert.ok(Math.abs(solved.national.sigma - spec.nationalSigma * inflate) < 1e-9,
    'national sigma should equal the (t-inflated) nationalSigma with no observations');
  assert.strictEqual(solved.regions.size, 0, 'no regions should have stats with no observations');

  const rng = mulberry32(12345);
  const drawFn = () => 0; // deterministic zero draw
  const sample = sampleSwing(solved, ['rustBelt', 'pacific'], rng, drawFn);
  assert.strictEqual(sample.N, 0, 'sampled N should be 0 with zero draws and no data');
  // An unobserved region still gets its own (here zero, since drawFn=0) shock
  assert.ok(sample.regionDraws.has('rustBelt') && sample.regionDraws.has('pacific'));

  const delta = unitSwingDelta(solved, 'PA', 'rustBelt', sample, rng, () => 0);
  assert.strictEqual(delta, 0, 'delta should be 0 for an unobserved unit given all-zero draws');
  console.log('PASS: zero-observation boundary matches the frozen prior with no adjustment');
})();

// --- 3. full-reporting boundary: delta collapses exactly to d_u ----------
(function testFullReportingBoundary() {
  const observations = [
    { unitKey: 'PA', priorMargin: 0.02, observedMargin: -0.03, obsSigma: 0 } // fully reported, priorMargin - observedMargin = 0.05
  ];
  const solved = solveLiveSwing(observations, spec, fakeRegionOf);
  const obs = solved.byUnit.get('PA');
  assert.ok(obs, 'PA observation should be recorded');
  assert.ok(Math.abs(obs.a - 1) < 1e-9, `shrinkage a should be ~1 at full reporting, got ${obs.a}`);

  const rng = mulberry32(999);
  // Use nonzero N/R draws to confirm the delta is independent of them once obsSigma=0
  const sample = { N: 0.5, regionDraws: new Map([['rustBelt', -0.3]]) };
  const delta1 = unitSwingDelta(solved, 'PA', 'rustBelt', sample, rng, () => 5); // even a wild noise draw shouldn't matter
  const expectedD = observations[0].priorMargin - observations[0].observedMargin;
  assert.ok(Math.abs(delta1 - expectedD) < 1e-9,
    `delta should collapse to priorMargin-observedMargin (${expectedD}) regardless of N/R/noise draws, got ${delta1}`);
  console.log('PASS: full-reporting boundary collapses to the observed margin exactly');
})();

// --- 4. one noisy early reporter barely moves the national estimate ------
(function testOneNoisyReporterDoesNotOverreact() {
  const REMAINING_DELTA_SIGMA_BASE = 0.12; // snapshot of docs/election-night.js's current constant
  const reporting = 0.02;
  const obsSigma = Math.max(0, 1 - reporting) * REMAINING_DELTA_SIGMA_BASE;
  const observations = [
    { unitKey: 'PA', priorMargin: 0, observedMargin: -0.10, obsSigma } // 10pt miss at 2% reporting
  ];
  const solved = solveLiveSwing(observations, spec, fakeRegionOf);
  // The national estimate should move only a small fraction of the raw 10pt miss.
  assert.ok(Math.abs(solved.national.mean) < 0.01,
    `one noisy early reporter should barely move the national estimate, got ${solved.national.mean}`);
  // The national uncertainty should barely shrink from its zero-observation baseline.
  const baselineSigma = spec.nationalSigma * inflate;
  assert.ok(solved.national.sigma > baselineSigma * 0.9,
    `national sigma should barely shrink from one noisy early reporter, got ${solved.national.sigma} vs baseline ${baselineSigma}`);
  console.log(`PASS: one noisy early reporter (10pt miss @ 2% reporting) moves national estimate by only ${(solved.national.mean * 100).toFixed(2)}pt`);
})();

// --- 5. many confirming, well-reported units collapse the uncertainty ----
(function testManyConfirmingReportersCollapseUncertainty() {
  const observations = [];
  const regions = ['rustBelt', 'pacific'];
  const unitsByRegion = { rustBelt: ['PA', 'MI', 'WI'], pacific: ['CA', 'OR'] };
  for (const region of regions) {
    for (const unit of unitsByRegion[region]) {
      observations.push({ unitKey: unit, priorMargin: 0, observedMargin: -0.05, obsSigma: 0.001 }); // consistently R+5 vs prior, near-fully reported
    }
  }
  const solved = solveLiveSwing(observations, spec, fakeRegionOf);
  const baselineSigma = spec.nationalSigma * inflate;
  assert.ok(solved.national.sigma < baselineSigma * 0.5,
    `national sigma should collapse well below baseline with many confirming reporters, got ${solved.national.sigma} vs baseline ${baselineSigma}`);
  // d_u = priorMargin - observedMargin = 0 - (-0.05) = +0.05 for every unit
  // (observed running R+5pt vs. an even prior) - a positive N subtracted
  // from priorMargin correctly pushes the effective outcome R-ward.
  assert.ok(solved.national.mean > 0.02,
    `national estimate should move decisively toward the confirmed (R) direction, got ${solved.national.mean}`);
  console.log(`PASS: many confirming reporters collapse national sigma from ${baselineSigma.toFixed(4)} to ${solved.national.sigma.toFixed(4)}, mean=${solved.national.mean.toFixed(4)}`);
})();

// --- 6. makeNormalizedTDraw realizes ~unit variance -----------------------
(function testNormalizedTDrawVariance() {
  const draw = makeNormalizedTDraw(spec.df);
  const rng = mulberry32(42);
  const n = 20000;
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const x = draw(rng);
    sum += x;
    sumSq += x * x;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(Math.abs(variance - 1) < 0.1, `normalized t-draw variance should be close to 1, got ${variance}`);
  console.log(`PASS: makeNormalizedTDraw realizes variance ~= 1 (measured ${variance.toFixed(3)} over ${n} draws)`);
})();

console.log('\nAll liveSwing.js tests passed.');
