'use strict';

// DOM + animation layer for the election-night "state call update" popup.
// Pure presentation: election-night.js builds a list of already-resolved
// slide descriptors (portrait URL, names, colors already looked up) and
// hands them to showCheckpoint(); this module just cycles through them with
// CSS-driven reveals and calls back when the whole batch has been shown.
//
// Slide shapes (all fields plain strings/numbers, no DOM). Every kind can
// also carry `breaking` (set in election-night.js's buildCheckpointSlides) -
// true for a key race, any correction/retraction, the call that pushed the
// count across the majority threshold, or the outcome/final/uncalled
// capstones themselves; drives the flash, the "Breaking news" ribbon, the
// border-glow card styling, and (for call/correction/retraction/leadFlip) a
// longer on-screen duration - see isBreakingSlide()/renderSlide().
//   { kind: 'call'|'correction', stateName, ev, leader, candidateName,
//     portraitUrl, dCandidateName, dPortraitUrl, rCandidateName,
//     rPortraitUrl, oCandidateName?, oPortraitUrl?, oVotes? (third comparison
//     row - only present when a third party took a material share of this
//     unit), accentColor, previousCandidateName (correction only), isNpv
//     (national popular vote call/correction - hides the EV badge),
//     timeLabel, tallyAfter: {D,R,O}, dVotes, rVotes, countedVotes,
//     reportingPct, reportingText, marginText, marginPctText (plain "D+4.1"
//     form, no raw-vote suffix - used for the comparison row's colored
//     margin badge) }
//   { kind: 'retraction', stateName, ev, leader (the PREVIOUSLY called
//     leader - there's no new one yet), candidateName (ditto), portraitUrl,
//     accentColor, timeLabel, tallyAfter: {D,R,O}, reportingPct,
//     reportingText, isNpv? (national popular vote retraction - hides the
//     EV badge, always keyRace: true) } - a called unit's confidence
//     collapsed back below the retraction threshold before it finished
//     reporting ("too close to call"); no D/R comparison row since there's
//     no new leader to compare.
//   { kind: 'leadFlip', stateName, ev, leader (the NEW raw leader),
//     candidateName, portraitUrl, dCandidateName, dPortraitUrl,
//     rCandidateName, rPortraitUrl, oCandidateName?, oPortraitUrl?, oVotes?
//     (third comparison row - same O_ROW_THRESHOLD gating as call/
//     correction), accentColor, timeLabel, tallyAfter (same as tallyBefore -
//     carries no EV weight), dVotes, rVotes, countedVotes, reportingPct,
//     reportingText, marginText, marginPctText, keyRace: true (always -
//     only ever built for key races, or the national popular vote), isNpv?
//     (hides the EV badge) } - a key race's (or the national popular
//     vote's) raw vote lead changed hands while it's still uncalled
//     (pre-first-call, or during too-close-to-call limbo after a
//     retraction); shows the same D/R/O comparison row a call/correction
//     does, alongside its own still-uncalled margin line.
//   { kind: 'outcome', candidateName, portraitUrl, accentColor, timeLabel,
//     outcomeLabel? ("Elected Nth President" / "Reelected as Nth President" -
//     null when the winner's name couldn't be resolved, e.g. future.html's
//     synthetic years, in which case the generic "Elected President" label
//     is shown instead) }
//   { kind: 'uncalled', dCandidateName, rCandidateName, dPortraitUrl,
//     rPortraitUrl, dEv, rEv, accentColor, tallyAfter, timeLabel } - a
//     correction knocked the previously-projected majority holder back
//     below majority with nobody else reaching it either; mid-count
//     analogue of the 'final' no-majority case.
//   { kind: 'final', winner: 'D'|'R'|null (null = no majority reached),
//     dEv, rEv, oEv, majority, dCandidateName, rCandidateName,
//     dPortraitUrl, rPortraitUrl, accentColor, tallyAfter, timeLabel,
//     outcomeLabel? (same as the 'outcome' slide's field, above) }
//   { kind: 'races', candidates: [{ unitKey, displayLabel, ev, leader,
//     keyRace (pinned first in the list, gets a small "KEY" badge),
//     candidateName, portraitUrl, reporting, marginText, marginPctText,
//     rawMarginText, confidenceText, reportingText, accentColor }],
//     timeLabel, pageIndex, pageCount } - up to MAX_RACES_TO_WATCH_PAGES
//     pages (2) of the top uncalled races by importance, with the national
//     popular vote pinned first (unitKey 'NPV') and always key-race-flagged
//     whenever any national votes have been counted; page label only shown
//     when pageCount > 1.
//   { kind: 'pollClose', states: [{ abbr, name, ev }] (sorted by EV
//     descending), totalEv, timeLabel } - "polls just closed" marker built
//     straight from state.stateData (not a live call/correction), one per
//     distinct poll-closing time actually present in the loaded year. Purely
//     informational: no D/R comparison, never flagged breaking.
//   { kind: 'finalResults', candidates: [{ unitKey, displayLabel, ev, leader,
//     isTippingPoint (starred in the list), candidateName, portraitUrl,
//     marginPctText, rawMarginText, accentColor }], pageIndex, pageCount } -
//     final-tally key-races recap, R→D sorted by margin; same card layout as
//     'races' but without reporting bar/confidence. Non-breaking.
//   { kind: 'raceOverview', year, title ("2028 Presidential Election"),
//     dCandidateName, dPortraitUrl, rCandidateName, rPortraitUrl,
//     oCandidateName?, oPortraitUrl? (third-party candidate, smaller, shown
//     only in years with a real electoral-vote haul for one - see
//     computeHasThirdParty() in election-night.js), stats?: { probD, probTie
//     (both already 0.001-0.999 capped), medianDemEv, evRange90: [lo, hi],
//     npvMargin (pre-formatted "D+3.2"/"R+1.8"/"O+8.2"/"EVEN" string, naming
//     whoever's actually leading the national popular vote poll, not always
//     D-vs-R) } - present only for a sim2028-bridged
//     run (a historical replay's stats would read oddly for an outcome
//     that's already history), null otherwise } - the night's opening
//     "portrait of the race" title card, always the first slide of the very
//     first checkpoint (see buildCheckpointSlides()'s isFirstCheckpoint
//     param in election-night.js). Non-breaking.
//
// showCheckpoint(slides, options) options:
//   onComplete, startingTally: {D,R,O}, winProb: {probD, probTie}|null
//   (national D win probability and no-majority/tie probability, each
//   0..1), majority: number|null (EVs needed to win), panelInfo: { D:
//   {name, portraitUrl}, R: {...}, O: {...} }, hasThirdParty: boolean
//   (shows the scoreboard's third O box, always pinned at "0.0% to win" -
//   only years with a real third-party electoral vote haul set this)

const CALL_SLIDE_MS = 3400;
const CORRECTION_SLIDE_MS = 4000;
const OUTCOME_SLIDE_MS = 4500;
const FINAL_SLIDE_MS = 6000;
const RACES_SLIDE_MS = 6000;
const FINAL_RESULTS_SLIDE_MS = 6000;
const RACE_OVERVIEW_SLIDE_MS = 6500;
const COUNTER_MS = 900;
// How long the "BREAKING NEWS"/"FINAL" flash covers the card before fading
// to reveal it - added on top of that slide's own duration so a flashed
// slide still gets its normal full viewing time afterward.
const FLASH_MS = 900;

let overlayEl = null;
let cardEl = null;
let flashEl = null;
let tallyEl = null;
let tallyBoxes = null; // { D: {root, num}, R: {root, num}, O?: {root, num} }
let progressEl = null;
let hintEl = null;
let advanceTimer = null;
let activeSlides = null;
let activeIndex = -1;
let activeOnComplete = null;
let displayedTally = { D: 0, R: 0, O: 0 };
// Per-party in-flight counter animation token, so a fast-advancing slide
// (e.g. two states called on the same tick) cancels the previous party's
// still-running requestAnimationFrame loop instead of letting both loops
// race to write the same element's textContent.
let counterAnimTokens = { D: 0, R: 0, O: 0 };
// Per-party active delta chip, so a new "+N" chip removes any still-visible
// chip for that same party instead of stacking on top of it (they're both
// absolutely positioned in the same corner).
let activeDeltaChips = { D: null, R: null, O: null };
// True while the caller (election-night.js, via the footer's Pause button)
// has asked the current slide to stop auto-advancing. Manual advance
// (skipToNext/skipToPrevious via click/tap/Space/Enter/ArrowLeft) ignores
// this flag entirely - it only gates the setTimeout in renderSlide().
let autoAdvancePaused = false;

// A beat longer than a plain call slide (PUNDIT_SLIDE_MS) - there's a full
// sentence of dialogue to read, not just a name and a margin. Shared by
// both pundit characters (Lickman, Sliver).
const PUNDIT_SLIDE_MS = 6000;

function durationFor(slide) {
  if (slide.kind === 'raceOverview') return RACE_OVERVIEW_SLIDE_MS;
  if (slide.kind === 'outcome') return OUTCOME_SLIDE_MS;
  if (slide.kind === 'final' || slide.kind === 'uncalled') return FINAL_SLIDE_MS;
  if (slide.kind === 'races' || slide.kind === 'pollClose' || slide.kind === 'finalResults') return RACES_SLIDE_MS;
  if (slide.kind === 'correction' || slide.kind === 'retraction' || slide.kind === 'leadFlip') return CORRECTION_SLIDE_MS;
  if (slide.kind === 'lickmanIntro' || slide.kind === 'lickmanClosing' || slide.kind === 'lickmanMidnight' || slide.kind === 'sliverSwing') return PUNDIT_SLIDE_MS;
  return CALL_SLIDE_MS;
}

// slide.breaking (set in election-night.js's buildCheckpointSlides - see its
// comment for the full definition: key races, any correction/retraction,
// the call that caused an outcome transition, and the outcome/final/
// uncalled capstones themselves) decides which slides also earn the flash
// below, on top of whatever kind-specific ribbon/border treatment they
// already get.
function isBreakingSlide(slide) {
  return !!slide.breaking;
}

function flashTextFor() {
  return 'Breaking News';
}

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.id = 'enCheckpointOverlay';
  overlayEl.className = 'en-checkpoint-overlay';
  overlayEl.hidden = true;
  overlayEl.setAttribute('role', 'dialog');
  overlayEl.setAttribute('aria-live', 'polite');

  tallyEl = document.createElement('div');
  tallyEl.className = 'en-cp-tally';
  overlayEl.appendChild(tallyEl);

  cardEl = document.createElement('div');
  cardEl.className = 'en-checkpoint-card';
  overlayEl.appendChild(cardEl);

  // Full-screen dramatic flash shown for a beat before the first slide of a
  // "breaking" run (key-race calls/corrections/retractions, or the outcome/
  // final/uncalled capstones) - see renderSlide()'s isBreakingSlide check.
  // The slide underneath is already fully rendered by the time this fades,
  // so it only delays the reveal rather than replacing it.
  flashEl = document.createElement('div');
  flashEl.className = 'en-cp-flash';
  flashEl.innerHTML = '<span class="en-cp-flash-text"></span>';
  overlayEl.appendChild(flashEl);

  progressEl = document.createElement('div');
  progressEl.className = 'en-checkpoint-progress';
  overlayEl.appendChild(progressEl);

  hintEl = document.createElement('div');
  hintEl.className = 'en-checkpoint-hint';
  hintEl.textContent = 'Click, tap, or press space to continue';
  overlayEl.appendChild(hintEl);

  overlayEl.addEventListener('click', skipToNext);
  document.addEventListener('keydown', (e) => {
    if (!overlayEl || overlayEl.hidden) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      skipToNext();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      skipToPrevious();
    }
  });

  document.body.appendChild(overlayEl);
  return overlayEl;
}

function partyLetter(leader) {
  return leader === 'D' ? 'D' : (leader === 'R' ? 'R' : 'O');
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
  }
  return { first: '', last: parts[0] || '' };
}

function lastNameOf(fullName) {
  return splitName(fullName).last || fullName || '';
}

function formatVotes(n) {
  return isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
}

function buildPhotoMarkup(slide) {
  const badge = `<div class="en-cp-party-badge en-cp-party-${partyLetter(slide.leader)}">${partyLetter(slide.leader)}</div>`;
  if (slide.portraitUrl) {
    return `<div class="en-cp-photo-wrap">
      <img class="en-cp-photo" src="${slide.portraitUrl}" alt="${slide.candidateName || ''}" />
      ${badge}
    </div>`;
  }
  return `<div class="en-cp-photo-wrap en-cp-photo-fallback">
    <div class="en-cp-photo-placeholder">${partyLetter(slide.leader)}</div>
    ${badge}
  </div>`;
}

// Small square avatar for a comparison row (distinct from the main
// buildPhotoMarkup() photo, which is bigger and always the slide's winner).
function buildMiniAvatar(portraitUrl, name, partyCode) {
  if (portraitUrl) {
    return `<img class="en-cp-mini-avatar" src="${portraitUrl}" alt="${name || ''}" />`;
  }
  return `<span class="en-cp-mini-avatar en-cp-mini-avatar-fallback">${partyCode || ''}</span>`;
}

/**
 * Two- or three-row vote comparison (leader's row first): D and R always,
 * plus a third O row whenever the slide carries an oCandidateName (a
 * third-party candidate who took a materially competitive share of this
 * unit - see O_ROW_THRESHOLD in election-night.js). Each row gets a photo
 * chip, name, raw vote count, and a big share-of-total percentage badge;
 * the leading row also gets a colored margin badge and an "ahead by"
 * figure plus a checkmark.
 */
function buildComparisonMarkup(slide) {
  if (!isFinite(slide.dVotes) && !isFinite(slide.rVotes)) return '';
  const total = isFinite(slide.countedVotes) && slide.countedVotes > 0
    ? slide.countedVotes
    : (isFinite(slide.dVotes) && isFinite(slide.rVotes) ? slide.dVotes + slide.rVotes : null);
  const pctOf = (votes) => (total && isFinite(votes)) ? (votes / total * 100) : null;

  const sides = [
    { code: 'D', votes: slide.dVotes, pct: pctOf(slide.dVotes), portrait: slide.dPortraitUrl, name: slide.dCandidateName || 'Democrat' },
    { code: 'R', votes: slide.rVotes, pct: pctOf(slide.rVotes), portrait: slide.rPortraitUrl, name: slide.rCandidateName || 'Republican' }
  ];
  if (slide.oCandidateName) {
    sides.push({ code: 'O', votes: slide.oVotes, pct: pctOf(slide.oVotes), portrait: slide.oPortraitUrl, name: slide.oCandidateName });
  }
  // Leader's row first, matching how a broadcast leaderboard reads. Sorts
  // on slide.leader itself (the authoritative call), not raw vote count -
  // they always agree in practice, but this guarantees the row order can
  // never visually contradict which row gets the checkmark/"ahead" badge.
  sides.sort((a, b) => (b.code === slide.leader ? 1 : 0) - (a.code === slide.leader ? 1 : 0));

  // "Ahead by" is the leader's margin over the strongest of the other rows
  // actually shown - not always D-vs-R, since a third row can be the
  // runner-up (or the leader) when it's present.
  const leaderSide = sides.find(s => s.code === slide.leader);
  const bestOtherVotes = sides.reduce((max, s) => (s.code !== slide.leader && isFinite(s.votes) && s.votes > max) ? s.votes : max, -Infinity);
  const aheadBy = (leaderSide && isFinite(leaderSide.votes) && bestOtherVotes > -Infinity)
    ? Math.abs(leaderSide.votes - bestOtherVotes) : null;

  const rows = sides.map(side => {
    const isLeading = side.code === slide.leader;
    const marginBadge = (isLeading && slide.marginPctText && slide.marginPctText !== 'None')
      ? `<span class="en-cp-compare-margin-badge" style="background:${slide.accentColor}">${slide.marginPctText}</span>`
      : '';
    const aheadLine = (isLeading && aheadBy != null)
      ? `<div class="en-cp-compare-ahead">${marginBadge}${formatVotes(aheadBy)} ahead</div>`
      : '';
    const check = isLeading ? '<span class="en-cp-compare-check">&#10003;</span>' : '';
    const pctText = side.pct != null ? `${side.pct.toFixed(1)}%` : '—';
    return `
      <div class="en-cp-compare-row en-cp-compare-${side.code.toLowerCase()}${isLeading ? ' en-cp-compare-leading' : ''}">
        ${buildMiniAvatar(side.portrait, side.name, side.code)}
        <div class="en-cp-compare-name">${lastNameOf(side.name).toUpperCase()}</div>
        <div class="en-cp-compare-votes">
          ${aheadLine}
          <span class="en-cp-compare-count">${formatVotes(side.votes)}</span>
          ${check}
        </div>
        <div class="en-cp-compare-pct en-cp-compare-pct-${side.code.toLowerCase()}">${pctText}</div>
      </div>`;
  }).join('');

  return `<div class="en-cp-compare">${rows}</div>`;
}

// Margin as a compact label plus a filled progress bar for percent-counted
// (no "votes left" - that's covered by the bar filling in over the night).
// When the slide carries a pre-election rating (sim2028 runs only - see
// election-night.js's isSim2028LiveRun()), a small colored pill rides along
// in the same row so a call can be read against what was expected of it.
function buildStatsLineMarkup(slide) {
  const pctNum = isFinite(slide.reportingPct) ? Math.max(0, Math.min(1, slide.reportingPct)) * 100 : null;
  if (pctNum == null) return '';
  const ratingBadge = slide.priorRatingLabel
    ? `<span class="en-cp-prior-badge" style="background:${slide.priorRatingColor}">Pre-election: ${slide.priorRatingLabel}</span>`
    : '';
  const barPart = `
      <div class="en-cp-stats-bar-track">
        <div class="en-cp-stats-bar-fill" style="width:${pctNum}%"></div>
      </div>
      <span class="en-cp-stats-bar-pct">${pctNum.toFixed(1)}% counted</span>
      ${ratingBadge}`;
  return `<div class="en-cp-stats-line">${barPart}</div>`;
}

// Animates an element's displayed integer from `from` to `to` over
// COUNTER_MS, e.g. the scoreboard ticking up by a state's own EV count the
// moment its call slide starts. Plain rAF + easing, no dependency.
//
// `code` (D/R/O) lets this cancel any still-running animation for the same
// party: two states called on the same tick advance to their slides back to
// back, fast enough that the previous slide's rAF loop can still be mid-
// flight when the next one starts - without cancellation, both loops write
// the same element's textContent every frame and whichever fires last that
// frame wins, which can visibly stall or flicker the settled value.
function animateCounter(el, from, to, code) {
  if (!el) return;
  if (code) counterAnimTokens[code] = (counterAnimTokens[code] || 0) + 1;
  const myToken = code ? counterAnimTokens[code] : null;
  if (!isFinite(to) || to === from) { el.textContent = String(isFinite(to) ? to : from); return; }
  const start = performance.now();
  function step(now) {
    if (code && counterAnimTokens[code] !== myToken) return; // superseded by a newer animation
    const t = Math.min(1, (now - start) / COUNTER_MS);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/**
 * Build (once per checkpoint) the persistent scoreboard's party boxes - D
 * and R always, plus a third O box (a real, computed win probability from
 * winProb.probO - see state.nationalWinProb's fixedOEv/hardLockedO logic in
 * election-night.js) only in years with a real third-party electoral vote
 * haul, gated by the caller-supplied `hasThirdParty` flag so ordinary D/R-
 * only years render exactly as before.
 */
function renderTallyPanelStructure(panelInfo, winProb, majority, hasThirdParty) {
  const info = panelInfo || {};
  const probD = winProb && isFinite(winProb.probD) ? winProb.probD : null;
  const probO = winProb && isFinite(winProb.probO) ? winProb.probO : null;
  const probTie = winProb && isFinite(winProb.probTie) ? winProb.probTie : 0;
  const partyBox = (code) => {
    const p = info[code] || {};
    const fallbackName = code === 'D' ? 'Democrat' : (code === 'R' ? 'Republican' : 'Other');
    const last = lastNameOf(p.name) || fallbackName;
    const probText = code === 'O' ? (probO != null ? `${(probO * 100).toFixed(1)}% to win` : '0.0% to win')
      : (code === 'D' && probD != null) ? `${(probD * 100).toFixed(1)}% to win`
        : (code === 'R' && probD != null) ? `${(Math.max(0, 1 - probD - probTie - (probO || 0)) * 100).toFixed(1)}% to win`
          : '';
    return `<div class="en-cp-tally-box en-cp-tally-${code.toLowerCase()}">
      ${buildMiniAvatar(p.portraitUrl, p.name, code)}
      <div class="en-cp-tally-info">
        <div class="en-cp-tally-name">${last.toUpperCase()}</div>
        <div class="en-cp-tally-num" data-party="${code}">0</div>
        ${probText ? `<div class="en-cp-tally-prob">${probText}</div>` : ''}
      </div>
    </div>`;
  };
  const tieLine = probD != null ? `<div class="en-cp-tally-tie">Tie ${(probTie * 100).toFixed(1)}%</div>` : '';
  const majorityLine = (isFinite(majority) || tieLine)
    ? `<div class="en-cp-tally-majority">${isFinite(majority) ? `<div>${majority} to win</div>` : ''}${tieLine}</div>`
    : '';
  tallyEl.innerHTML = partyBox('D') + majorityLine + (hasThirdParty ? partyBox('O') : '') + partyBox('R');
  tallyBoxes = {
    D: tallyEl.querySelector('.en-cp-tally-num[data-party="D"]'),
    R: tallyEl.querySelector('.en-cp-tally-num[data-party="R"]'),
    O: hasThirdParty ? tallyEl.querySelector('.en-cp-tally-num[data-party="O"]') : null
  };
}

function setTallyImmediate(tally) {
  displayedTally = { D: (tally && tally.D) || 0, R: (tally && tally.R) || 0, O: (tally && tally.O) || 0 };
  if (tallyBoxes && tallyBoxes.D) tallyBoxes.D.textContent = String(displayedTally.D);
  if (tallyBoxes && tallyBoxes.R) tallyBoxes.R.textContent = String(displayedTally.R);
  if (tallyBoxes && tallyBoxes.O) tallyBoxes.O.textContent = String(displayedTally.O);
}

// A correction is a much bigger deal than a routine call, so on top of the
// tally panel's number actually counting down on one side and up on the
// other (already correct - animateCounter is direction-agnostic), flag a
// transient "+N"/"-N" chip next to whichever number just moved, so the
// swing itself is legible at a glance instead of only implied by the
// before/after numbers.
function showTallyDelta(code, delta) {
  if (!tallyBoxes || !tallyBoxes[code] || !delta) return;
  const numEl = tallyBoxes[code];
  const parent = numEl.parentElement;
  if (!parent) return;
  // A fast-advancing slide (e.g. two states called on the same tick) can
  // fire a second delta for the same party before the first chip's fade-out
  // timers finish - remove any still-visible chip outright instead of
  // letting both stack in the same absolutely-positioned corner, where
  // their overlapping text reads as one garbled/doubled number.
  if (activeDeltaChips[code]) {
    activeDeltaChips[code].remove();
    activeDeltaChips[code] = null;
  }
  const chip = document.createElement('span');
  chip.className = `en-cp-tally-delta ${delta > 0 ? 'en-cp-tally-delta-up' : 'en-cp-tally-delta-down'}`;
  chip.textContent = delta > 0 ? `+${delta}` : String(delta);
  parent.appendChild(chip);
  activeDeltaChips[code] = chip;
  requestAnimationFrame(() => chip.classList.add('en-cp-tally-delta-show'));
  setTimeout(() => chip.classList.add('en-cp-tally-delta-hide'), 2100);
  setTimeout(() => {
    chip.remove();
    if (activeDeltaChips[code] === chip) activeDeltaChips[code] = null;
  }, 2400);
}

function animateTallyTo(fromTally, toTally, showDelta) {
  if (!toTally) return;
  const fromD = (fromTally && isFinite(fromTally.D)) ? fromTally.D : 0;
  const fromR = (fromTally && isFinite(fromTally.R)) ? fromTally.R : 0;
  const fromO = (fromTally && isFinite(fromTally.O)) ? fromTally.O : 0;
  const toD = isFinite(toTally.D) ? toTally.D : fromD;
  const toR = isFinite(toTally.R) ? toTally.R : fromR;
  const toO = isFinite(toTally.O) ? toTally.O : fromO;
  if (showDelta) {
    showTallyDelta('D', toD - fromD);
    showTallyDelta('R', toR - fromR);
    showTallyDelta('O', toO - fromO);
  }
  if (tallyBoxes && tallyBoxes.D) animateCounter(tallyBoxes.D, fromD, toD, 'D');
  if (tallyBoxes && tallyBoxes.R) animateCounter(tallyBoxes.R, fromR, toR, 'R');
  if (tallyBoxes && tallyBoxes.O) animateCounter(tallyBoxes.O, fromO, toO, 'O');
  displayedTally = { D: toD, R: toR, O: toO };
}

function renderCallOrCorrection(slide) {
  const { first, last } = splitName(slide.candidateName);
  const isCorrection = slide.kind === 'correction';
  // A call/correction is a confidence-threshold projection, not a certainty
  // (unlike the outcome/final capstones, which only fire once the majority
  // is mathematically decided) - "PROJECTED WINNER" says so plainly, the
  // way a real broadcast distinguishes a projection from a certified result.
  const badgeLabel = isCorrection ? '&#9888; CORRECTION' : 'PROJECTED WINNER';
  const badgeClass = isCorrection ? 'en-cp-badge-corrected' : 'en-cp-badge-winner';
  const prevLine = isCorrection && slide.previousCandidateName
    ? `<div class="en-cp-prev">Previously called for ${slide.previousCandidateName}</div>`
    : '';
  // The national popular vote carries no EV weight of its own, so its slide
  // swaps the EV badge for a plain "informational" tag instead of a "0".
  const evBadge = slide.isNpv
    ? `<div class="en-cp-ev"><span class="en-cp-ev-label">National vote</span></div>`
    : `<div class="en-cp-ev">
        <span class="en-cp-ev-label">Electoral votes</span>
        <span class="en-cp-ev-num">${isFinite(slide.ev) ? slide.ev : '-'}</span>
      </div>`;
  const timeLabel = slide.timeLabel ? `<div class="en-cp-time">${slide.timeLabel} ET</div>` : '';
  const breakingNewsRibbon = slide.breaking ? '<div class="en-cp-breaking">Breaking news</div>' : '';
  cardEl.innerHTML = `
    ${breakingNewsRibbon}
    <div class="en-cp-header">
      <div class="en-cp-state">${(slide.stateName || '').toUpperCase()}${timeLabel}</div>
      ${evBadge}
    </div>
    <div class="en-cp-body">
      ${buildPhotoMarkup(slide)}
      <div class="en-cp-result">
        <div class="en-cp-check ${badgeClass}">${isCorrection ? '' : '<span class="en-cp-checkmark">&#10003;</span> '}${badgeLabel}</div>
        <div class="en-cp-name">
          ${first ? `<span class="en-cp-first">${first}</span>` : ''}
          <span class="en-cp-last">${last}</span>
        </div>
        ${prevLine}
      </div>
    </div>
    ${buildComparisonMarkup(slide)}
    ${buildStatsLineMarkup(slide)}`;
  animateTallyTo(slide.tallyBefore, slide.tallyAfter, true);
}

/**
 * A called state just got un-called mid-count ("too close to call") - not
 * the same thing as a 'correction' (which only fires once a unit hits 100%
 * reporting and states a real final winner). There's no new leader here yet,
 * just the previously-called candidate's name/portrait and a warning that
 * the race has narrowed back into uncertainty, so unlike
 * renderCallOrCorrection() this never shows a D/R comparison row.
 */
function renderRetraction(slide) {
  const { first, last } = splitName(slide.candidateName);
  const evBadge = slide.isNpv
    ? `<div class="en-cp-ev"><span class="en-cp-ev-label">National vote</span></div>`
    : `<div class="en-cp-ev">
      <span class="en-cp-ev-label">Electoral votes</span>
      <span class="en-cp-ev-num">${isFinite(slide.ev) ? slide.ev : '-'}</span>
    </div>`;
  const timeLabel = slide.timeLabel ? `<div class="en-cp-time">${slide.timeLabel} ET</div>` : '';
  const breakingNewsRibbon = slide.breaking ? '<div class="en-cp-breaking">Breaking news</div>' : '';
  cardEl.innerHTML = `
    ${breakingNewsRibbon}
    <div class="en-cp-header">
      <div class="en-cp-state">${(slide.stateName || '').toUpperCase()}${timeLabel}</div>
      ${evBadge}
    </div>
    <div class="en-cp-body">
      ${buildPhotoMarkup(slide)}
      <div class="en-cp-result">
        <div class="en-cp-check en-cp-badge-retracted">&#8634; TOO CLOSE TO CALL</div>
        <div class="en-cp-name">
          ${first ? `<span class="en-cp-first">${first}</span>` : ''}
          <span class="en-cp-last">${last}</span>
        </div>
        <div class="en-cp-prev">Previously called for ${slide.candidateName || 'the leader'} - race has narrowed</div>
      </div>
    </div>
    ${buildStatsLineMarkup(slide)}`;
  animateTallyTo(slide.tallyBefore, slide.tallyAfter, true);
}

/**
 * A key race's raw vote lead just changed hands while it's still uncalled
 * (pre-first-call, or during too-close-to-call limbo after a retraction) -
 * a live count update, not a call. Shows the same D/R/O comparison box
 * renderCallOrCorrection() does, plus (unlike renderRetraction()) a fresh
 * margin line, since the count is still actively moving.
 */
function renderLeadFlip(slide) {
  const { first, last } = splitName(slide.candidateName);
  const evBadge = slide.isNpv
    ? `<div class="en-cp-ev"><span class="en-cp-ev-label">National vote</span></div>`
    : `<div class="en-cp-ev">
      <span class="en-cp-ev-label">Electoral votes</span>
      <span class="en-cp-ev-num">${isFinite(slide.ev) ? slide.ev : '-'}</span>
    </div>`;
  const timeLabel = slide.timeLabel ? `<div class="en-cp-time">${slide.timeLabel} ET</div>` : '';
  const breakingNewsRibbon = slide.breaking ? '<div class="en-cp-breaking">Breaking news</div>' : '';
  const marginLine = slide.marginText ? `<div class="en-cp-prev">${slide.marginText} - still too close to call</div>` : '<div class="en-cp-prev">Still too close to call</div>';
  cardEl.innerHTML = `
    ${breakingNewsRibbon}
    <div class="en-cp-header">
      <div class="en-cp-state">${(slide.stateName || '').toUpperCase()}${timeLabel}</div>
      ${evBadge}
    </div>
    <div class="en-cp-body">
      ${buildPhotoMarkup(slide)}
      <div class="en-cp-result">
        <div class="en-cp-check en-cp-badge-leadflip">&#8593; TAKES THE LEAD</div>
        <div class="en-cp-name">
          ${first ? `<span class="en-cp-first">${first}</span>` : ''}
          <span class="en-cp-last">${last}</span>
        </div>
        ${marginLine}
      </div>
    </div>
    ${buildComparisonMarkup(slide)}
    ${buildStatsLineMarkup(slide)}`;
  animateTallyTo(slide.tallyBefore, slide.tallyAfter, true);
}

function renderOutcome(slide) {
  const timeLabel = slide.timeLabel ? `<div class="en-cp-time">${slide.timeLabel} ET</div>` : '';
  cardEl.innerHTML = `
    <div class="en-cp-breaking">Breaking news${timeLabel}</div>
    <div class="en-cp-outcome-body">
      ${buildPhotoMarkup(slide)}
      <div class="en-cp-outcome-text">
        <div class="en-cp-outcome-name">${(slide.candidateName || '').toUpperCase()}</div>
        <div class="en-cp-outcome-label">${slide.outcomeLabel || 'Elected President'}</div>
      </div>
    </div>`;
}

/**
 * The night's capstone slide - always shown once, after every other event
 * (see computePlannedCheckpoints()'s 'final' event in election-night.js).
 * Two variants: a clean final tally when someone reached a majority, or a
 * "no majority" result (covers both an exact tie and any other deadlock)
 * showing both candidates side by side with a House-of-Representatives note.
 */
function renderFinal(slide) {
  const timeLabel = slide.timeLabel ? `<div class="en-cp-time">${slide.timeLabel} ET</div>` : '';
  const dName = lastNameOf(slide.dCandidateName) || 'Democrat';
  const rName = lastNameOf(slide.rCandidateName) || 'Republican';
  const oName = lastNameOf(slide.oCandidateName) || 'Independent';
  // Named by candidate last name, not the D/R/O letter, so the tally reads
  // like the rest of the app's checkpoint slides rather than a scoreboard.
  const tallyMarkup = `
    <div class="en-cp-final-tally">
      <span class="en-cp-final-d">${slide.dEv} ${dName}</span>
      <span class="en-cp-final-sep">–</span>
      <span class="en-cp-final-r">${slide.rEv} ${rName}</span>
      ${slide.oEv ? `<span class="en-cp-final-sep">–</span><span class="en-cp-final-o">${slide.oEv} ${oName}</span>` : ''}
    </div>`;
  if (slide.winner) {
    const winnerName = slide.winner === 'D' ? dName : (slide.winner === 'O' ? oName : rName);
    const winnerPortrait = slide.winner === 'D' ? slide.dPortraitUrl : (slide.winner === 'O' ? slide.oPortraitUrl : slide.rPortraitUrl);
    cardEl.innerHTML = `
      <div class="en-cp-breaking en-cp-final-breaking">Final${timeLabel}</div>
      <div class="en-cp-outcome-body">
        ${buildPhotoMarkup({ leader: slide.winner, portraitUrl: winnerPortrait, candidateName: winnerName })}
        <div class="en-cp-outcome-text">
          <div class="en-cp-outcome-name">${winnerName.toUpperCase()}</div>
          <div class="en-cp-outcome-label">${slide.outcomeLabel || 'Elected President'}</div>
        </div>
      </div>
      ${tallyMarkup}`;
  } else {
    cardEl.innerHTML = `
      <div class="en-cp-breaking en-cp-final-breaking">Final${timeLabel}</div>
      <div class="en-cp-final-nomajority">
        <div class="en-cp-final-nomajority-photos">
          ${buildMiniAvatar(slide.dPortraitUrl, dName, 'D')}
          ${buildMiniAvatar(slide.rPortraitUrl, rName, 'R')}
        </div>
        <div class="en-cp-final-nomajority-text">
          <div class="en-cp-outcome-name">No majority</div>
          ${tallyMarkup}
          <div class="en-cp-outcome-label">Decided by the House of Representatives</div>
        </div>
      </div>`;
  }
  animateTallyTo(slide.tallyBefore, slide.tallyAfter);
}

/**
 * The night's opening title card - see this file's header comment for the
 * full 'raceOverview' shape. Big candidate photos (buildPhotoMarkup()'s
 * single-photo styling, sized up) side by side, with an optional smaller
 * third-party photo centered between them, and - sim2028 only - a row of
 * forecast stats below.
 */
// Solid party colors used for the raceOverview photo borders - the same
// values already used site-wide for a "this is D/R/O, at full saturation"
// treatment (e.g. .en-cp-compare-pct-d/-r/-o's leading-row fill, styles.css
// ~3437-3446), reused here rather than the softer .en-cp-tally-* text tint.
function partyBorderColor(code) {
  return code === 'D' ? '#1e4bd1' : (code === 'R' ? '#b22222' : '#C9A400');
}

function renderRaceOverview(slide) {
  const dName = lastNameOf(slide.dCandidateName) || 'Democrat';
  const rName = lastNameOf(slide.rCandidateName) || 'Republican';

  // The frame is the fixed-size layout box; the border lives on the <img>
  // itself, which is left to size itself down to its own aspect ratio
  // (max-width/max-height:100% + auto, centered by the frame's flex) rather
  // than stretching to fill the frame - so a non-square portrait's border
  // hugs the actual visible photo instead of tracing an oversized square
  // with empty letterboxed corners inside it. Only the placeholder fallback
  // (no photo at all) fills the full square, since there's no image edge to
  // hug there.
  const photo = (portraitUrl, name, code, frameClass) => portraitUrl
    ? `<div class="en-cp-overview-photo-frame ${frameClass}">
        <img class="en-cp-overview-photo" src="${portraitUrl}" alt="${name || ''}" />
      </div>`
    : `<div class="en-cp-overview-photo-frame ${frameClass}">
        <div class="en-cp-overview-photo en-cp-overview-photo-fallback">${code}</div>
      </div>`;

  // Full name + party letter (e.g. "Hubert Humphrey (D)"), not just the
  // last name - the stats row below still uses the terser last-name form,
  // where space is tighter. Skipped for a third-party candidate: they're
  // never "the O candidate" the way the other two are "the D/R candidate",
  // so a bare "(O)" after a real name (e.g. "George Wallace (O)") reads as
  // a label slapped on rather than a party affiliation.
  const candidateBlock = (portraitUrl, fullName, fallbackName, code, extraClass) => `
    <div class="en-cp-overview-candidate${code === 'O' ? ' en-cp-overview-candidate-o' : ''}" style="--en-overview-accent:${partyBorderColor(code)}">
      ${photo(portraitUrl, fullName, code, extraClass)}
      <div class="en-cp-overview-name">${fullName || fallbackName}${code === 'O' ? '' : ` (${code})`}</div>
    </div>`;

  const oBlock = slide.oCandidateName
    ? candidateBlock(slide.oPortraitUrl, slide.oCandidateName, '', 'O', 'en-cp-overview-frame-o')
    : '';

  let statsRow = '';
  if (slide.stats) {
    const s = slide.stats;
    const probD = Math.max(0.001, Math.min(0.999, s.probD));
    // Stays exactly 0 (not floored) with no third-party candidate at all -
    // only a genuine, currently-displayed O probability gets the same
    // never-claim-0%/100% treatment as D.
    const probO = slide.oCandidateName ? Math.max(0.001, Math.min(0.999, s.probO || 0)) : 0;
    const probTie = Math.max(0.001, Math.min(0.999, s.probTie || 0));
    const probR = Math.max(0.001, Math.min(0.999, 1 - probD - probTie - probO));
    const medianText = isFinite(s.medianDemEv)
      ? `${Math.round(s.medianDemEv)} D${Array.isArray(s.evRange90) ? ` (${Math.round(s.evRange90[0])}–${Math.round(s.evRange90[1])})` : ''}`
      : '—';
    const stat = (label, value) => `
      <div class="en-cp-overview-stat">
        <div class="en-cp-overview-stat-label">${label}</div>
        <div class="en-cp-overview-stat-value">${value}</div>
      </div>`;
    const oName = lastNameOf(slide.oCandidateName) || 'Independent';
    statsRow = `<div class="en-cp-overview-stats">
      ${stat(`${dName.toUpperCase()} TO WIN`, `${(probD * 100).toFixed(1)}%`)}
      ${stat(`${rName.toUpperCase()} TO WIN`, `${(probR * 100).toFixed(1)}%`)}
      ${slide.oCandidateName ? stat(`${oName.toUpperCase()} TO WIN`, `${(probO * 100).toFixed(1)}%`) : ''}
      ${stat('NO MAJORITY', `${(probTie * 100).toFixed(1)}%`)}
      ${stat('EST. NPV', s.npvMargin || '—')}
      ${stat('MEDIAN EV', medianText)}
    </div>`;
  }

  cardEl.innerHTML = `
    <div class="en-cp-overview-title">${slide.title || 'Presidential Election'}</div>
    <div class="en-cp-overview-photos${slide.oCandidateName ? ' en-cp-overview-photos-3' : ''}">
      ${candidateBlock(slide.dPortraitUrl, slide.dCandidateName, 'Democrat', 'D', '')}
      ${oBlock}
      ${candidateBlock(slide.rPortraitUrl, slide.rCandidateName, 'Republican', 'R', '')}
    </div>
    ${statsRow}`;
}

/**
 * Shared "portrait + speech bubble" shell for a pundit-commentary slide -
 * used by both Aleck Lickman (renderLickman) and Nathaniel Sliver
 * (renderSliver). `footerHtml` is optional extra markup inside the bubble,
 * below the dialogue text (Lickman's false-beets pill; Sliver has none).
 */
function renderPunditBubble(labelText, photoUrl, photoAlt, dialogueText, footerHtml) {
  cardEl.innerHTML = `
    <div class="en-cp-pundit-label">${labelText}</div>
    <div class="en-cp-pundit-body">
      <img class="en-cp-pundit-photo" src="${photoUrl}" alt="${photoAlt}" />
      <div class="en-cp-pundit-bubble">
        <div class="en-cp-pundit-text">${dialogueText || ''}</div>
        ${footerHtml || ''}
      </div>
    </div>`;
}

/**
 * Aleck Lickman's opening prediction ('lickmanIntro'), closing reaction
 * ('lickmanClosing'), and midnight reaction ('lickmanMidnight') slides -
 * same layout for all three, distinguished only by slide.label. See
 * election-night.js's buildLickmanIntroSpec()/buildLickmanClosingSpec()/
 * buildLickmanMidnightSpec() for how slide.dialogueText gets picked/filled.
 */
function renderLickman(slide) {
  const footerHtml = `<div class="en-cp-lickman-beets">${slide.falseBeets} / 13 beets false</div>`;
  renderPunditBubble(slide.label || 'Aleck Lickman', slide.portraitUrl, 'Aleck Lickman', slide.dialogueText, footerHtml);
}

/**
 * Nathaniel Sliver's live swing-narration slide ('sliverSwing') - same
 * portrait/bubble shell as Lickman's, no footer pill. See
 * election-night.js's buildSliverSwingSpec() for how slide.dialogueText
 * gets picked/filled.
 */
function renderSliver(slide) {
  renderPunditBubble(slide.label || 'Nathaniel Sliver', slide.portraitUrl, 'Nathaniel Sliver', slide.dialogueText, '');
}

/**
 * Mid-count analogue of renderFinal()'s no-majority branch: a correction
 * just knocked the previously-projected majority holder back below majority
 * with nobody else reaching it, so the race is undecided again - but unlike
 * 'final', this isn't the end of the night, so it reads as "Breaking news"
 * (more to come) rather than "Final" (decided by the House).
 */
function renderUncalled(slide) {
  const timeLabel = slide.timeLabel ? `<div class="en-cp-time">${slide.timeLabel} ET</div>` : '';
  const dName = lastNameOf(slide.dCandidateName) || 'Democrat';
  const rName = lastNameOf(slide.rCandidateName) || 'Republican';
  cardEl.innerHTML = `
    <div class="en-cp-breaking">Breaking news${timeLabel}</div>
    <div class="en-cp-final-nomajority">
      <div class="en-cp-final-nomajority-photos">
        ${buildMiniAvatar(slide.dPortraitUrl, dName, 'D')}
        ${buildMiniAvatar(slide.rPortraitUrl, rName, 'R')}
      </div>
      <div class="en-cp-final-nomajority-text">
        <div class="en-cp-outcome-name">No longer decided</div>
        <div class="en-cp-final-tally">
          <span class="en-cp-final-d">${slide.dEv} D</span>
          <span class="en-cp-final-sep">–</span>
          <span class="en-cp-final-r">${slide.rEv} R</span>
        </div>
        <div class="en-cp-outcome-label">No candidate currently has a projected majority</div>
      </div>
    </div>`;
  animateTallyTo(slide.tallyBefore, slide.tallyAfter, true);
}

// Each race gets a colorful mini-card: leader portrait, state + EVs, a
// percent-counted progress bar, confidence, and margin (both percent and
// raw vote figure - formatMarginText() already combines those into one
// string upstream). Inspired by a broadcast "key race alert" panel, not a
// copy of one - one card per race rather than a dense table.
function renderRaces(slide) {
  const candidates = Array.isArray(slide.candidates) ? slide.candidates : [];
  const pageLabel = slide.pageCount > 1 ? `<div class="en-cp-page-label">Page ${slide.pageIndex + 1} of ${slide.pageCount}</div>` : '';
  const cards = candidates.map(c => {
    const pct = isFinite(c.reporting) ? Math.max(0, Math.min(1, c.reporting)) * 100 : 0;
    const accent = c.accentColor || '#8a8a8a';
    const marginPctText = c.marginPctText && c.marginPctText !== 'None' ? c.marginPctText : 'EVEN';
    const rawMarginText = c.rawMarginText || '';
    return `
      <div class="en-cp-race-card" style="--en-race-accent:${accent}">
        <div class="en-cp-race-info">
          <div class="en-cp-race-top">
            <span class="en-cp-race-name-group">
              ${c.keyRace ? '<span class="en-cp-race-key-badge">KEY</span>' : ''}
              <span class="en-cp-race-state">${c.displayLabel}</span>
            </span>
            ${c.ev > 0 ? `<span class="en-cp-race-ev">${c.ev} EV</span>` : ''}
          </div>
          <div class="en-cp-race-bar-track">
            <div class="en-cp-race-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="en-cp-race-meta">
            <span class="en-cp-race-pct">${pct.toFixed(1)}% in</span>
            <span class="en-cp-race-confidence">${c.confidenceText || ''}</span>
            ${c.priorRatingLabel ? `<span class="en-cp-prior-badge" style="background:${c.priorRatingColor}">${c.priorRatingLabel}</span>` : ''}
          </div>
        </div>
        ${c.portraitUrl
          ? `<img class="en-cp-race-portrait" src="${c.portraitUrl}" alt="${c.candidateName || ''}" />`
          : `<span class="en-cp-race-portrait en-cp-race-portrait-fallback">${partyLetter(c.leader)}</span>`}
        <div class="en-cp-race-margin-block">
          <div class="en-cp-race-margin-pct" style="background:${accent}">${marginPctText}</div>
          ${rawMarginText ? `<div class="en-cp-race-margin-raw">${rawMarginText}</div>` : ''}
        </div>
      </div>`;
  }).join('');
  cardEl.innerHTML = `
    <div class="en-cp-header en-cp-races-header">
      <div class="en-cp-state">Races to watch</div>
      ${pageLabel}
    </div>
    <div class="en-cp-races-list">${cards}</div>`;
}

// A "polls just closed" marker: one pill per state, EV badge for the total.
// No portraits or D/R comparison - it's a schedule beat, not a result.
function renderPollClose(slide) {
  const states = Array.isArray(slide.states) ? slide.states : [];
  const timeLabel = slide.timeLabel ? `<div class="en-cp-time">${slide.timeLabel} ET</div>` : '';
  const chips = states.map(s => `
      <span class="en-cp-pollclose-chip">
        ${s.name}${s.ev > 0 ? `<span class="en-cp-pollclose-chip-ev">${s.ev}</span>` : ''}
      </span>`).join('');
  cardEl.innerHTML = `
    <div class="en-cp-header">
      <div class="en-cp-state">Polls just closed${timeLabel}</div>
      <div class="en-cp-ev">
        <span class="en-cp-ev-label">Electoral votes</span>
        <span class="en-cp-ev-num">${isFinite(slide.totalEv) ? slide.totalEv : '-'}</span>
      </div>
    </div>
    <div class="en-cp-pollclose-list">${chips}</div>`;
}

function renderFinalResults(slide) {
  const candidates = Array.isArray(slide.candidates) ? slide.candidates : [];
  const pageLabel = slide.pageCount > 1 ? `<div class="en-cp-page-label">Page ${slide.pageIndex + 1} of ${slide.pageCount}</div>` : '';
  const cards = candidates.map(c => {
    const accent = c.accentColor || '#8a8a8a';
    const marginPctText = c.marginPctText && c.marginPctText !== 'None' ? c.marginPctText : 'EVEN';
    const rawMarginText = c.rawMarginText || '';
    return `
      <div class="en-cp-race-card" style="--en-race-accent:${accent}">
        <div class="en-cp-race-info">
          <div class="en-cp-race-top">
            <span class="en-cp-race-name-group">
              ${c.isTippingPoint ? '<span class="en-cp-race-tipping-star">★ Tipping point</span>' : ''}
              <span class="en-cp-race-state">${c.displayLabel}</span>
            </span>
            ${c.ev > 0 ? `<span class="en-cp-race-ev">${c.ev} EV</span>` : ''}
          </div>
          ${c.priorRatingLabel ? `<div class="en-cp-race-meta"><span class="en-cp-prior-badge" style="background:${c.priorRatingColor}">${c.priorRatingLabel}</span></div>` : ''}
        </div>
        ${c.portraitUrl
          ? `<img class="en-cp-race-portrait" src="${c.portraitUrl}" alt="${c.candidateName || ''}" />`
          : `<span class="en-cp-race-portrait en-cp-race-portrait-fallback">${partyLetter(c.leader)}</span>`}
        <div class="en-cp-race-margin-block">
          <div class="en-cp-race-margin-pct" style="background:${accent}">${marginPctText}</div>
          ${rawMarginText ? `<div class="en-cp-race-margin-raw">${rawMarginText}</div>` : ''}
        </div>
      </div>`;
  }).join('');
  cardEl.innerHTML = `
    <div class="en-cp-header en-cp-races-header">
      <div class="en-cp-state">Final Results: Key Races</div>
      ${pageLabel}
    </div>
    <div class="en-cp-races-list">${cards}</div>`;
}

function renderProgress(total, index) {
  if (total <= 1) { progressEl.innerHTML = ''; return; }
  let dots = '';
  for (let i = 0; i < total; i++) {
    dots += `<span class="en-cp-dot${i === index ? ' en-cp-dot-active' : ''}"></span>`;
  }
  progressEl.innerHTML = dots;
}

function renderSlide(index) {
  const slide = activeSlides[index];
  const breakingClass = slide.breaking ? ' en-cp-key-race' : '';
  cardEl.className = `en-checkpoint-card en-checkpoint-${slide.kind}${breakingClass}`;
  const accent = slide.accentColor || '#2f2f2f';
  cardEl.style.setProperty('--en-cp-accent', accent);
  overlayEl.style.setProperty('--en-cp-accent', accent);
  if (slide.kind === 'raceOverview') renderRaceOverview(slide);
  else if (slide.kind === 'outcome') renderOutcome(slide);
  else if (slide.kind === 'final') renderFinal(slide);
  else if (slide.kind === 'uncalled') renderUncalled(slide);
  else if (slide.kind === 'races') renderRaces(slide);
  else if (slide.kind === 'pollClose') renderPollClose(slide);
  else if (slide.kind === 'finalResults') renderFinalResults(slide);
  else if (slide.kind === 'retraction') renderRetraction(slide);
  else if (slide.kind === 'leadFlip') renderLeadFlip(slide);
  else if (slide.kind === 'lickmanIntro' || slide.kind === 'lickmanClosing' || slide.kind === 'lickmanMidnight') renderLickman(slide);
  else if (slide.kind === 'sliverSwing') renderSliver(slide);
  else renderCallOrCorrection(slide);
  renderProgress(activeSlides.length, index);

  // Restart the CSS reveal animation on every slide (a class swap alone
  // won't retrigger keyframes on the same element, so force a reflow).
  cardEl.classList.remove('en-cp-reveal');
  void cardEl.offsetWidth; // eslint-disable-line no-void
  cardEl.classList.add('en-cp-reveal');

  // Flash once per contiguous run of "breaking" slides (election-night.js
  // groups them together at the front of the batch precisely so this fires
  // just once for the whole run, not once per key race) - trigger only on
  // the transition into such a run, not on every slide within it.
  flashEl.classList.remove('en-cp-flash-show');
  const shouldFlash = isBreakingSlide(slide) && (index === 0 || !isBreakingSlide(activeSlides[index - 1]));
  if (shouldFlash) {
    flashEl.querySelector('.en-cp-flash-text').textContent = flashTextFor(slide);
    void flashEl.offsetWidth; // eslint-disable-line no-void
    flashEl.classList.add('en-cp-flash-show');
  }

  clearTimeout(advanceTimer);
  const baseDuration = durationFor(slide);
  const emphasisDuration = slide.breaking && (slide.kind === 'call' || slide.kind === 'correction' || slide.kind === 'retraction' || slide.kind === 'leadFlip')
    ? baseDuration * 1.2
    : baseDuration;
  const duration = emphasisDuration + (shouldFlash ? FLASH_MS : 0);
  advanceTimer = autoAdvancePaused ? null : setTimeout(skipToNext, duration);
}

function skipToNext() {
  if (!activeSlides) return;
  clearTimeout(advanceTimer);
  activeIndex += 1;
  if (activeIndex >= activeSlides.length) {
    finishCheckpoint();
    return;
  }
  renderSlide(activeIndex);
}

// Left-arrow: step back to re-watch a call already shown within this
// checkpoint's own batch (the common case being "I blinked and missed one"
// during a burst of near-simultaneous calls). Scoped to the current
// checkpoint only - it doesn't reach back into a previously closed one.
function skipToPrevious() {
  if (!activeSlides || activeIndex <= 0) return;
  clearTimeout(advanceTimer);
  activeIndex -= 1;
  renderSlide(activeIndex);
}

function finishCheckpoint() {
  clearTimeout(advanceTimer);
  advanceTimer = null;
  const cb = activeOnComplete;
  activeSlides = null;
  activeIndex = -1;
  activeOnComplete = null;
  if (overlayEl) {
    overlayEl.classList.add('en-checkpoint-closing');
    setTimeout(() => {
      if (overlayEl) overlayEl.hidden = true;
      // cb() (which resumes the sim) only runs once the overlay is
      // actually hidden, not before - otherwise a checkpoint that fires
      // again immediately on resume would call showCheckpoint() while this
      // timeout is still pending, and this timeout would then stomp the
      // brand new popup by forcing it hidden out from under itself.
      if (typeof cb === 'function') cb();
    }, 220);
  } else if (typeof cb === 'function') {
    cb();
  }
}

/**
 * Show a batch of slides in sequence, pausing here (the caller is
 * responsible for actually pausing the simulation) until every slide has
 * been shown (auto-advancing) or skipped (click/tap/space/enter), then
 * calling options.onComplete(). See the top of the file for the full
 * options shape (startingTally/winProb/panelInfo drive the persistent
 * scoreboard panel).
 */
export function showCheckpoint(slides, options = {}) {
  if (!Array.isArray(slides) || !slides.length) {
    if (typeof options.onComplete === 'function') options.onComplete();
    return;
  }
  ensureOverlay();
  activeSlides = slides;
  activeIndex = 0;
  activeOnComplete = options.onComplete || null;
  // Clear any leftover closing state from a previous checkpoint (defensive
  // - finishCheckpoint() no longer removes it itself, so a fresh open is
  // the single place this ever gets cleared) before revealing, so the
  // entrance animation on the base .en-checkpoint-overlay rule plays clean.
  overlayEl.classList.remove('en-checkpoint-closing');
  overlayEl.hidden = false;
  counterAnimTokens = { D: 0, R: 0, O: 0 };
  activeDeltaChips = { D: null, R: null, O: null };
  renderTallyPanelStructure(options.panelInfo, options.winProb, options.majority, options.hasThirdParty);
  setTallyImmediate(options.startingTally);
  renderSlide(0);
}

/** True while a checkpoint popup is currently being shown. */
export function isCheckpointActive() {
  return !!activeSlides;
}

/**
 * Pause or resume the current slide's automatic advance (the footer's
 * Pause button during a state call). Manual advance keeps working either
 * way. Resuming with a slide already on screen restarts that slide's full
 * duration rather than tracking elapsed time - simple, and these slides are
 * short enough that it isn't noticeable.
 */
export function setCheckpointAutoAdvance(enabled) {
  autoAdvancePaused = !enabled;
  clearTimeout(advanceTimer);
  advanceTimer = null;
  if (!autoAdvancePaused && activeSlides && activeIndex >= 0) {
    advanceTimer = setTimeout(skipToNext, durationFor(activeSlides[activeIndex]));
  }
}

/**
 * Immediately tear down any in-progress checkpoint popup with no closing
 * animation and no onComplete callback - for Reset, which is discarding the
 * whole simulation anyway and shouldn't wait on or trigger a resume.
 */
export function forceCloseCheckpoint() {
  clearTimeout(advanceTimer);
  advanceTimer = null;
  autoAdvancePaused = false;
  activeSlides = null;
  activeIndex = -1;
  activeOnComplete = null;
  if (overlayEl) {
    overlayEl.classList.remove('en-checkpoint-closing');
    overlayEl.hidden = true;
  }
}
