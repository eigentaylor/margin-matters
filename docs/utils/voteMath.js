'use strict';

export function totalVotesFromRow(row) {
  const direct = Number(row && row.total);
  if (isFinite(direct) && direct > 0) return direct;
  const d = Number(row && row.dVotes);
  const r = Number(row && row.rVotes);
  const t = Number(row && (row.tVotes != null ? row.tVotes : row.third_party_votes));
  const sum = (isFinite(d) ? Math.max(0, d) : 0) + (isFinite(r) ? Math.max(0, r) : 0) + (isFinite(t) ? Math.max(0, t) : 0);
  return sum > 0 ? sum : 0;
}

export function clampMargin(value) {
  if (!isFinite(value)) return 0;
  const LIMIT = 1 - 1e-9;
  if (value > LIMIT) return LIMIT;
  if (value < -LIMIT) return -LIMIT;
  return value;
}

export function computePvAdjustedBreakdown(row, pvShift = 0, natActualMargin = 0) {
  const pv = isFinite(pvShift) ? (pvShift - natActualMargin) : 0;
  // Debug trace: optional global flag to inspect PV arithmetic at runtime
  try {
    if (typeof window !== 'undefined' && window._pvTrace) {
      const unit = row && (row.unit || row.Unit || row.abbr) ? (row.unit || row.Unit || row.abbr) : '(unknown)';
      console.debug('[PV-TRACE] unit=', unit, 'pvShift=', pvShift, 'natActualMargin=', natActualMargin, 'pv(relative)=', pv);
    }
  } catch (e) { /* non-fatal debug error */ }
  const totalVotes = totalVotesFromRow(row);

  let dVotesBase = Math.max(0, Number(row && row.dVotes) || 0);
  let rVotesBase = Math.max(0, Number(row && row.rVotes) || 0);

  let totalThirdVotes = Number(row && row.tVotes);
  if (!isFinite(totalThirdVotes) || totalThirdVotes < 0) {
    totalThirdVotes = Math.max(0, totalVotes - dVotesBase - rVotesBase);
  }
  if (totalVotes > 0) totalThirdVotes = Math.min(totalVotes, totalThirdVotes);
  else totalThirdVotes = 0;

  let topThirdVotes = Number(row && row.topThirdVotes);
  if (!isFinite(topThirdVotes) || topThirdVotes < 0) topThirdVotes = totalThirdVotes;
  topThirdVotes = Math.max(0, Math.min(totalThirdVotes, topThirdVotes));

  const otherThirdVotes = Math.max(0, totalThirdVotes - topThirdVotes);
  const twoPartyVotes = Math.max(0, totalVotes - totalThirdVotes);

  const twoPartyDenom = twoPartyVotes > Number.EPSILON ? twoPartyVotes : 0;
  let baseDShareTwoParty = twoPartyDenom > 0 ? dVotesBase / twoPartyDenom : 0.5;
  if (!isFinite(baseDShareTwoParty)) baseDShareTwoParty = 0.5;
  baseDShareTwoParty = Math.max(0, Math.min(1, baseDShareTwoParty));

  const baseMargin = clampMargin(2 * baseDShareTwoParty - 1);
  const targetMargin = clampMargin(baseMargin + pv);
  const targetDShareTwoParty = (targetMargin + 1) / 2;
  const targetRShareTwoParty = 1 - targetDShareTwoParty;

  const adjustedDVotes = twoPartyVotes * targetDShareTwoParty;
  const adjustedRVotes = twoPartyVotes * targetRShareTwoParty;

  return {
    totalVotes,
    dVotes: adjustedDVotes,
    rVotes: adjustedRVotes,
    twoPartyVotes,
    totalThirdVotes,
    topThirdVotes,
    otherThirdVotes,
    baseMargin,
    targetMargin,
    twoPartyShareOfTotal: totalVotes > Number.EPSILON ? twoPartyVotes / totalVotes : 0,
    topThirdShareOfTotal: totalVotes > Number.EPSILON ? topThirdVotes / totalVotes : 0,
    totalThirdShareOfTotal: totalVotes > Number.EPSILON ? totalThirdVotes / totalVotes : 0
  };
}
