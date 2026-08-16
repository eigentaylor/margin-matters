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
//     accentColor, previousCandidateName (correction only), runningEv,
//     runningEvBefore, dVotes, rVotes, reportingText, marginText }
//   { kind: 'outcome', candidateName, portraitUrl, accentColor }

const CALL_SLIDE_MS = 3400;
const CORRECTION_SLIDE_MS = 4000;
const OUTCOME_SLIDE_MS = 4500;
const EV_COUNTER_MS = 900;

let overlayEl = null;
let cardEl = null;
let progressEl = null;
let hintEl = null;
let advanceTimer = null;
let activeSlides = null;
let activeIndex = -1;
let activeOnComplete = null;

function durationFor(slide) {
  if (slide.kind === 'outcome') return OUTCOME_SLIDE_MS;
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

function formatVotes(n) {
  return isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
}

// Small circular avatar for the D/R vote-count row (distinct from the main
// buildPhotoMarkup() photo, which is bigger and always the slide's winner).
function buildMiniAvatar(portraitUrl, name, partyCode) {
  if (portraitUrl) {
    return `<img class="en-cp-mini-avatar" src="${portraitUrl}" alt="${name || ''}" />`;
  }
  return `<span class="en-cp-mini-avatar en-cp-mini-avatar-fallback">${partyCode || ''}</span>`;
}

function buildVotesRowMarkup(slide) {
  if (!isFinite(slide.dVotes) && !isFinite(slide.rVotes)) return '';
  const dPortrait = slide.leader === 'D' ? slide.portraitUrl : (slide.oppositeLeader === 'D' ? slide.oppositePortraitUrl : null);
  const rPortrait = slide.leader === 'R' ? slide.portraitUrl : (slide.oppositeLeader === 'R' ? slide.oppositePortraitUrl : null);
  const dName = slide.leader === 'D' ? slide.candidateName : (slide.oppositeLeader === 'D' ? slide.oppositeCandidateName : 'D');
  const rName = slide.leader === 'R' ? slide.candidateName : (slide.oppositeLeader === 'R' ? slide.oppositeCandidateName : 'R');
  return `
    <div class="en-cp-votes-row">
      <div class="en-cp-votes-side en-cp-votes-d${slide.leader === 'D' ? ' en-cp-votes-leading' : ''}">
        ${buildMiniAvatar(dPortrait, dName, 'D')}
        <span class="en-cp-votes-num">${formatVotes(slide.dVotes)}</span>
      </div>
      <div class="en-cp-votes-side en-cp-votes-r${slide.leader === 'R' ? ' en-cp-votes-leading' : ''}">
        <span class="en-cp-votes-num">${formatVotes(slide.rVotes)}</span>
        ${buildMiniAvatar(rPortrait, rName, 'R')}
      </div>
    </div>`;
}

function buildStatsMarkup(slide) {
  const evTotalLine = (slide.leader === 'D' || slide.leader === 'R') && isFinite(slide.runningEv)
    ? `<div class="en-cp-evtotal">
        <span class="en-cp-evtotal-label">${(slide.candidateName || '').split(/\s+/).pop()}'s electoral vote total</span>
        <span class="en-cp-evtotal-num" data-count-from="${slide.runningEvBefore}" data-count-to="${slide.runningEv}">${slide.runningEvBefore}</span>
      </div>`
    : '';
  const votesRow = buildVotesRowMarkup(slide);
  const statsLine = [slide.marginText, slide.reportingText].filter(Boolean).join(' · ');
  if (!evTotalLine && !votesRow && !statsLine) return '';
  return `<div class="en-cp-stats">
    ${evTotalLine}
    ${votesRow}
    ${statsLine ? `<div class="en-cp-stats-line">${statsLine}</div>` : ''}
  </div>`;
}

// Animates a counter element's text from data-count-from to data-count-to,
// e.g. a state's electoral votes landing and the total visibly ticking up
// by that state's own count. Plain rAF + easing, no dependency.
function animateEvCounters(root) {
  const els = root.querySelectorAll('.en-cp-evtotal-num[data-count-to]');
  els.forEach(el => {
    const from = Number(el.dataset.countFrom) || 0;
    const to = Number(el.dataset.countTo);
    if (!isFinite(to) || to === from) { el.textContent = String(isFinite(to) ? to : from); return; }
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / EV_COUNTER_MS);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const value = Math.round(from + (to - from) * eased);
      el.textContent = String(value);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
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
    ${buildStatsMarkup(slide)}`;
  animateEvCounters(cardEl);
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
 * calling options.onComplete().
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
  renderSlide(0);
}

/** True while a checkpoint popup is currently being shown. */
export function isCheckpointActive() {
  return !!activeSlides;
}
