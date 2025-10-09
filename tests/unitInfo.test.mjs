import assert from 'assert';
import { readFileSync } from 'fs';

// Small harness: set up minimal globals window.getRowsForYear and window.getNatMargin
globalThis.window = globalThis.window || {};

// Load a minimal rows dataset for 2020-like structure containing FL
const rows = [
  { unit: 'FL', dVotes: 2927282, rVotes: 2897761, tVotes: 97488, topThirdVotes: 97488, ev: 29, rm: -0.0001 }
];

window.getRowsForYear = (y) => rows;
window.getNatMargin = (y) => 0; // nat margin set to 0 for this test
window._curYear = 2020;

// Set PV equal to natMargin to trigger raw CSV branch
window._curPv = 0;
// make the test environment look like index.html so calculateUnitVoteTallies proceeds
window.location = { pathname: '/index.html' };

(async function run() {
  const mod = await import('../docs/utils/unitInfo.js');
  const tallies = mod.calculateUnitVoteTallies('FL');
  console.log('TEST: calculateUnitVoteTallies FL ->', tallies);
  assert(tallies, 'tallies should be returned');
  assert.strictEqual(tallies.D, 2927282, 'D should match CSV');
  assert.strictEqual(tallies.R, 2897761, 'R should match CSV');
  assert.strictEqual(tallies.O, 97488, 'O should match CSV');
  console.log('PASS: calculateUnitVoteTallies raw CSV branch');
})().catch(err => { console.error(err); process.exitCode = 2; });
