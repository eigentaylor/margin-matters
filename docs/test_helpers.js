// Pure helper functions extracted from tester.js for unit testing
function leanStr(x) {
  if (!isFinite(x)) return '';
  if (Math.abs(x) < 0.000005) return 'EVEN';
  const s = (Math.abs(x) * 100).toFixed(1);
  return (x > 0 ? 'D+' : 'R+') + s;
}

function clampMargin(value) {
  if (!isFinite(value)) return 0;
  const LIMIT = 1 - 1e-9;
  if (value > LIMIT) return LIMIT;
  if (value < -LIMIT) return -LIMIT;
  return value;
}

function totalVotesFromRow(row) {
  const direct = +row.total;
  if (isFinite(direct) && direct > 0) return direct;
  const fallback = (+row.dVotes || 0) + (+row.rVotes || 0) + (+row.tVotes || 0);
  return fallback > 0 ? fallback : 0;
}

function computePvAdjustedBreakdown(row, pvShift = 0, natActualMargin = 0) {
  const EPS = 1e-8;
  const pv = isFinite(pvShift) ? 1 * (pvShift - natActualMargin) : 0;
  const totalVotes = totalVotesFromRow(row);
  let dVotesBase = Math.max(0, +row.dVotes || 0);
  let rVotesBase = Math.max(0, +row.rVotes || 0);
  let totalThirdVotes = +row.tVotes;
  if (!isFinite(totalThirdVotes) || totalThirdVotes < 0) {
    totalThirdVotes = Math.max(0, totalVotes - dVotesBase - rVotesBase);
  }
  if (totalVotes > 0) totalThirdVotes = Math.min(totalVotes, totalThirdVotes);
  else totalThirdVotes = 0;
  let topThirdVotes = +row.topThirdVotes;
  if (!isFinite(topThirdVotes) || topThirdVotes < 0) topThirdVotes = totalThirdVotes;
  topThirdVotes = Math.max(0, Math.min(totalThirdVotes, topThirdVotes));
  const otherThirdVotes = Math.max(0, totalThirdVotes - topThirdVotes);
  const twoPartyVotes = Math.max(0, totalVotes - totalThirdVotes);
  const twoPartyDenom = twoPartyVotes > EPS ? twoPartyVotes : 0;
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
    twoPartyShareOfTotal: totalVotes > EPS ? twoPartyVotes / totalVotes : 0,
    topThirdShareOfTotal: totalVotes > EPS ? topThirdVotes / totalVotes : 0,
    totalThirdShareOfTotal: totalVotes > EPS ? totalThirdVotes / totalVotes : 0
  };
}

function allocateProportionalEVs(dVotes, rVotes, oVotes, totalEVs) {
  // simplified allocation: largest remainder among D/R/O
  const total = dVotes + rVotes + oVotes;
  if (total <= 0 || totalEVs <= 0) return { D: 0, R: 0, O: 0, thirdParties: {} };
  const dShare = dVotes / total;
  const rShare = rVotes / total;
  const oShare = oVotes / total;
  const dQuota = Math.floor(dShare * totalEVs);
  const rQuota = Math.floor(rShare * totalEVs);
  const oQuota = Math.floor(oShare * totalEVs);
  let allocated = { D: dQuota, R: rQuota, O: oQuota };
  let remaining = totalEVs - (dQuota + rQuota + oQuota);
  if (remaining > 0) {
    const remainders = [
      { party: 'D', remainder: (dShare * totalEVs) - dQuota },
      { party: 'R', remainder: (rShare * totalEVs) - rQuota },
      { party: 'O', remainder: (oShare * totalEVs) - oQuota }
    ];
    remainders.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < remaining; i++) allocated[remainders[i].party]++;
  }
  return { ...allocated, thirdParties: {} };
}

module.exports = { leanStr, clampMargin, computePvAdjustedBreakdown, allocateProportionalEVs };
