'use strict';

// DOM + animation layer for the election-night "state call update" popup.
// Pure presentation: election-night.js builds a list of already-resolved
// slide descriptors (portrait URL, names, colors already looked up) and
// hands them to showCheckpoint(); this module just cycles through them with
// CSS-driven reveals and calls back when the whole batch has been shown.
//
// Slide shapes (all fields plain strings/numbers, no DOM):
//   { kind: 'call'|'correction', stateName, ev, leader, oppositeLeader,
//     candidateName, portraitUrl, oppositeCandidateName, oppositePortraitUrl,
//     accentColor, previousCandidateName (correction only),
//     tallyAfter: {D,R,O}, dVotes, rVotes, countedVotes, reportingText,
//     marginText }
//   { kind: 'outcome', candidateName, portraitUrl, accentColor }
//   { kind: 'races', candidates: [{ displayLabel, ev, marginText,
//     confidenceText, reportingText, accentColor }] }
//
// showCheckpoint(slides, options) options:
//   onComplete, startingTally: {D,R,O}, winProb: number|null (national D
//   win probability, 0..1), panelInfo: { D: {name, portraitUrl}, R: {...} }

const CALL_SLIDE_MS = 3400;
const CORRECTION_SLIDE_MS = 4000;
const OUTCOME_SLIDE_MS = 4500;
const RACES_SLIDE_MS = 6000;
const COUNTER_MS = 900;

let overlayEl = null;
let cardEl = null;
let tallyEl = null;
let tallyBoxes = null; // { D: {root, num}, R: {root, num} }
let progressEl = null;
let hintEl = null;
let advanceTimer = null;
let activeSlides = null;
let activeIndex = -1;
let activeOnComplete = null;
let displayedTally = { D: 0, R: 0 };

function durationFor(slide) {
  if (slide.kind === 'outcome') return OUTCOME_SLIDE_MS;
  if (slide.kind === 'races') return RACES_SLIDE_MS;
  if (slide.kind === 'correction') return CORRECTION_SLIDE_MS;
  return CALL_SLIDE_MS;
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
 * Two-row D-vs-R vote comparison (leader's row first), each with a photo
 * chip, name, raw vote count, and a big share-of-total percentage badge;
 * the leading row also gets an "ahead by" figure and a checkmark.
 */
function buildComparisonMarkup(slide) {
  if (!isFinite(slide.dVotes) && !isFinite(slide.rVotes)) return '';
  const total = isFinite(slide.countedVotes) && slide.countedVotes > 0
    ? slide.countedVotes
    : (isFinite(slide.dVotes) && isFinite(slide.rVotes) ? slide.dVotes + slide.rVotes : null);
  const pctOf = (votes) => (total && isFinite(votes)) ? (votes / total * 100) : null;
  const aheadBy = (isFinite(slide.dVotes) && isFinite(slide.rVotes)) ? Math.abs(slide.dVotes - slide.rVotes) : null;

  const sides = [
    {
      code: 'D',
      votes: slide.dVotes,
      pct: pctOf(slide.dVotes),
      portrait: slide.leader === 'D' ? slide.portraitUrl : (slide.oppositeLeader === 'D' ? slide.oppositePortraitUrl : null),
      name: slide.leader === 'D' ? slide.candidateName : (slide.oppositeLeader === 'D' ? slide.oppositeCandidateName : 'Democrat')
    },
    {
      code: 'R',
      votes: slide.rVotes,
      pct: pctOf(slide.rVotes),
      portrait: slide.leader === 'R' ? slide.portraitUrl : (slide.oppositeLeader === 'R' ? slide.oppositePortraitUrl : null),
      name: slide.leader === 'R' ? slide.candidateName : (slide.oppositeLeader === 'R' ? slide.oppositeCandidateName : 'Republican')
    }
  ];
  // Leader's row first, matching how a broadcast leaderboard reads. Sorts
  // on slide.leader itself (the authoritative call), not raw vote count -
  // they always agree in practice, but this guarantees the row order can
  // never visually contradict which row gets the checkmark/"ahead" badge.
  sides.sort((a, b) => (b.code === slide.leader ? 1 : 0) - (a.code === slide.leader ? 1 : 0));

  const rows = sides.map(side => {
    const isLeading = side.code === slide.leader;
    const aheadLine = (isLeading && aheadBy != null)
      ? `<div class="en-cp-compare-ahead">${formatVotes(aheadBy)} ahead</div>`
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

function buildStatsLineMarkup(slide) {
  const text = [slide.marginText, slide.reportingText].filter(Boolean).join(' · ');
  return text ? `<div class="en-cp-stats-line">${text}</div>` : '';
}

// Animates an element's displayed integer from `from` to `to` over
// COUNTER_MS, e.g. the scoreboard ticking up by a state's own EV count the
// moment its call slide starts. Plain rAF + easing, no dependency.
function animateCounter(el, from, to) {
  if (!el) return;
  if (!isFinite(to) || to === from) { el.textContent = String(isFinite(to) ? to : from); return; }
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / COUNTER_MS);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/** Build (once per checkpoint) the persistent scoreboard's two party boxes. */
function renderTallyPanelStructure(panelInfo, winProb) {
  const info = panelInfo || {};
  const partyBox = (code) => {
    const p = info[code] || {};
    const last = lastNameOf(p.name) || (code === 'D' ? 'Democrat' : 'Republican');
    const probText = (code === 'D' && isFinite(winProb)) ? `${(winProb * 100).toFixed(0)}% to win`
      : (code === 'R' && isFinite(winProb)) ? `${((1 - winProb) * 100).toFixed(0)}% to win`
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
  tallyEl.innerHTML = partyBox('D') + partyBox('R');
  tallyBoxes = {
    D: tallyEl.querySelector('.en-cp-tally-num[data-party="D"]'),
    R: tallyEl.querySelector('.en-cp-tally-num[data-party="R"]')
  };
}

function setTallyImmediate(tally) {
  displayedTally = { D: (tally && tally.D) || 0, R: (tally && tally.R) || 0 };
  if (tallyBoxes && tallyBoxes.D) tallyBoxes.D.textContent = String(displayedTally.D);
  if (tallyBoxes && tallyBoxes.R) tallyBoxes.R.textContent = String(displayedTally.R);
}

function animateTallyTo(tally) {
  if (!tally) return;
  const nextD = isFinite(tally.D) ? tally.D : displayedTally.D;
  const nextR = isFinite(tally.R) ? tally.R : displayedTally.R;
  if (tallyBoxes && tallyBoxes.D) animateCounter(tallyBoxes.D, displayedTally.D, nextD);
  if (tallyBoxes && tallyBoxes.R) animateCounter(tallyBoxes.R, displayedTally.R, nextR);
  displayedTally = { D: nextD, R: nextR };
}

function renderCallOrCorrection(slide) {
  const { first, last } = splitName(slide.candidateName);
  const isCorrection = slide.kind === 'correction';
  const badgeLabel = isCorrection ? 'CORRECTED' : 'WINNER';
  const badgeClass = isCorrection ? 'en-cp-badge-corrected' : 'en-cp-badge-winner';
  const prevLine = isCorrection && slide.previousCandidateName
    ? `<div class="en-cp-prev">Previously called for ${slide.previousCandidateName}</div>`
    : '';
  cardEl.innerHTML = `
    <div class="en-cp-header">
      <div class="en-cp-state">${(slide.stateName || '').toUpperCase()}</div>
      <div class="en-cp-ev">
        <span class="en-cp-ev-label">Electoral votes</span>
        <span class="en-cp-ev-num">${isFinite(slide.ev) ? slide.ev : '-'}</span>
      </div>
    </div>
    <div class="en-cp-body">
      ${buildPhotoMarkup(slide)}
      <div class="en-cp-result">
        <div class="en-cp-check ${badgeClass}"><span class="en-cp-checkmark">&#10003;</span> ${badgeLabel}</div>
        <div class="en-cp-name">
          ${first ? `<span class="en-cp-first">${first}</span>` : ''}
          <span class="en-cp-last">${last}</span>
        </div>
        ${prevLine}
      </div>
    </div>
    ${buildComparisonMarkup(slide)}
    ${buildStatsLineMarkup(slide)}`;
  animateTallyTo(slide.tallyAfter);
}

function renderOutcome(slide) {
  cardEl.innerHTML = `
    <div class="en-cp-breaking">Breaking news</div>
    <div class="en-cp-outcome-body">
      ${buildPhotoMarkup(slide)}
      <div class="en-cp-outcome-text">
        <div class="en-cp-outcome-name">${(slide.candidateName || '').toUpperCase()}</div>
        <div class="en-cp-outcome-label">Elected President</div>
      </div>
    </div>`;
}

function renderRaces(slide) {
  const candidates = Array.isArray(slide.candidates) ? slide.candidates : [];
  const rows = candidates.map(c => {
    const parts = [c.marginText && c.marginText !== 'None' ? `Margin ${c.marginText}` : null, c.confidenceText, c.reportingText]
      .filter(Boolean).join(' · ');
    const label = c.ev > 0 ? `${c.displayLabel} (${c.ev} EV)` : c.displayLabel;
    return `<div class="en-log-uncalled-card" style="border-left-color:${c.accentColor || 'transparent'}">${label} – ${parts}</div>`;
  }).join('');
  cardEl.innerHTML = `
    <div class="en-cp-header en-cp-races-header">
      <div class="en-cp-state">Races to watch</div>
    </div>
    <div class="en-cp-races-list">${rows}</div>`;
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
  cardEl.className = `en-checkpoint-card en-checkpoint-${slide.kind}`;
  const accent = slide.accentColor || '#2f2f2f';
  cardEl.style.setProperty('--en-cp-accent', accent);
  overlayEl.style.setProperty('--en-cp-accent', accent);
  if (slide.kind === 'outcome') renderOutcome(slide);
  else if (slide.kind === 'races') renderRaces(slide);
  else renderCallOrCorrection(slide);
  renderProgress(activeSlides.length, index);

  // Restart the CSS reveal animation on every slide (a class swap alone
  // won't retrigger keyframes on the same element, so force a reflow).
  cardEl.classList.remove('en-cp-reveal');
  void cardEl.offsetWidth; // eslint-disable-line no-void
  cardEl.classList.add('en-cp-reveal');

  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(skipToNext, durationFor(slide));
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
  renderTallyPanelStructure(options.panelInfo, options.winProb);
  setTallyImmediate(options.startingTally);
  renderSlide(0);
}

/** True while a checkpoint popup is currently being shown. */
export function isCheckpointActive() {
  return !!activeSlides;
}
