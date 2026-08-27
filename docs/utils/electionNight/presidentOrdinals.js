'use strict';

import { ordinalSuffix } from '../formatters.js';

// Which numbered presidency a given election year's winner would hold, and
// whether winning means becoming the next numbered president or being
// reelected as the same one. Table entry = [ordinalBase, incumbentParty,
// override]:
//   - ordinalBase: the presidency number a *new* (non-reelected) winner of
//     this year would become.
//   - incumbentParty: 'D'|'R' if that party's sitting president is running
//     for reelection this year, else null.
//   - override: for the three non-consecutive-term cases (a former
//     president winning years after leaving office - Cleveland 1892, T.
//     Roosevelt 1912, Trump 2024) where that specific party's win should
//     also read as a reelection even though incumbentParty doesn't capture
//     it (nobody of that party was the sitting president that year):
//     { candidate, party }, else null.
export const PRESIDENT_ORDINALS = {
  1864: [17, 'R', null],
  1868: [18, null, null],
  1872: [19, 'R', null],
  1876: [19, null, null],
  1880: [20, null, null],
  1884: [22, null, null],
  1888: [23, 'D', null],
  1892: [24, 'R', { candidate: 'Cleveland', party: 'D' }],
  1896: [25, null, null],
  1900: [26, 'R', null],
  1904: [27, 'R', null],
  1908: [27, null, null],
  1912: [28, 'R', { candidate: 'Roosevelt', party: 'P' }],
  1916: [29, 'D', null],
  1920: [29, null, null],
  1924: [31, 'R', null],
  1928: [31, null, null],
  1932: [32, 'R', null],
  1936: [33, 'D', null],
  1940: [33, 'D', null],
  1944: [33, 'D', null],
  1948: [34, 'D', null],
  1952: [34, null, null],
  1956: [35, 'R', null],
  1960: [35, null, null],
  1964: [37, 'D', null],
  1968: [37, null, null],
  1972: [38, 'R', null],
  1976: [39, 'R', null],
  1980: [40, 'D', null],
  1984: [41, 'R', null],
  1988: [41, null, null],
  1992: [42, 'R', null],
  1996: [43, 'D', null],
  2000: [43, null, null],
  2004: [44, 'R', null],
  2008: [44, null, null],
  2012: [45, 'D', null],
  2016: [45, null, null],
  2020: [46, 'R', null],
  2024: [47, null, { candidate: 'Trump', party: 'R' }],
  2028: [48, null, null],
};

// Returns null when the year isn't in the table (e.g. future.html's
// hypothetical years past 2028) or winnerParty isn't 'D'/'R'/'O', so callers
// can fall back to today's generic wording with no page-specific branching.
// A third-party ('O') winner needs no separate numbering scheme: incumbentParty
// and every override.party below are always 'D'/'R'/'P', never 'O', so an O
// winner can never match the reelection/non-consecutive-term branches - it
// always falls through to the plain "the number a brand-new winner would
// become" case, exactly as intended for a candidate who's never held the
// office before.
//
// isFinal distinguishes the night's one true final tally from every earlier
// clinch/correction moment - until every state is actually called, the
// winner is still a projection, so "Elected"/"Reelected" (settled fact) is
// reserved for isFinal and every other moment reads as "Projected to be
// elected/reelected" instead.
export function getPresidencyOutcomeLabel(year, winnerParty, isFinal = true) {
  const entry = PRESIDENT_ORDINALS[year];
  if (!entry || (winnerParty !== 'D' && winnerParty !== 'R' && winnerParty !== 'O')) return null;
  const [ordinalBase, incumbentParty, override] = entry;
  // A same-term incumbent winning reelection keeps their existing number
  // (ordinalBase - 1, since ordinalBase is "the number a brand-new winner
  // would become") - e.g. Coolidge succeeded to the 30th presidency in
  // 1923, so winning in 1924 keeps him the 30th, not the 31st.
  if (winnerParty === incumbentParty) {
    const ordinal = ordinalSuffix(ordinalBase - 1);
    return isFinal ? `Reelected as ${ordinal} President` : `Projected to be reelected as ${ordinal} President`;
  }
  // A former president winning a non-consecutive term (Cleveland 1892,
  // T. Roosevelt 1912, Trump 2024) genuinely starts a new, later-numbered
  // presidency, so ordinalBase itself is their number here.
  if (override != null && winnerParty === override.party) {
    const ordinal = ordinalSuffix(ordinalBase);
    return isFinal ? `Reelected as ${ordinal} President` : `Projected to be reelected as ${ordinal} President`;
  }
  const ordinal = ordinalSuffix(ordinalBase);
  return isFinal ? `Elected ${ordinal} President` : `Projected to be elected ${ordinal} President`;
}
