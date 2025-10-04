const { leanStr, clampMargin, computePvAdjustedBreakdown, allocateProportionalEVs } = require('./test_helpers');

test('leanStr formatting and thresholds', () => {
  expect(leanStr(0)).toBe('EVEN');
  expect(leanStr(0.000001)).toBe('EVEN');
  expect(leanStr(0.045)).toBe('D+4.5');
  expect(leanStr(-0.12)).toBe('R+12.0');
});

test('clampMargin respects limits', () => {
  expect(clampMargin(2)).toBeCloseTo(1 - 1e-9);
  expect(clampMargin(-2)).toBeCloseTo(-1 + 1e-9);
  expect(clampMargin(0.25)).toBe(0.25);
});

test('computePvAdjustedBreakdown basic', () => {
  const row = { dVotes: 600, rVotes: 400, tVotes: 0, total: 1000 };
  const res = computePvAdjustedBreakdown(row, 0.05, 0);
  // targetMargin increases by pvShift; base margin is 0.2 -> D strong
  expect(res.totalVotes).toBe(1000);
  expect(res.twoPartyVotes).toBe(1000);
  expect(res.dVotes).toBeGreaterThan(res.rVotes);
});

test('allocateProportionalEVs simple quotas', () => {
  const out = allocateProportionalEVs(600, 400, 0, 10);
  expect(out.D + out.R + out.O).toBe(10);
  expect(out.D).toBeGreaterThanOrEqual(0);
});
