'use strict';

// DOM + animation layer for the election-night "state call update" popup.
// Pure presentation: election-night.js builds a list of already-resolved
// slide descriptors (portrait URL, names, colors already looked up) and
// hands them to showCheckpoint(); this module just cycles through them with
// CSS-driven reveals and calls back when the whole batch has been shown.
//
// Slide shapes (all fields plain strings/numbers, no DOM):
//   { kind: 'call', stateName, ev, leader, candidateName, portraitUrl, accentColor }
//   { kind: 'correction', stateName, ev, leader, candidateName, portraitUrl,
//     accentColor, previousCandidateName }
//   { kind: 'outcome', candidateName, portraitUrl, accentColor, outcomeText }

const CALL_SLIDE_MS = 2200;
const CORRECTION_SLIDE_MS = 2800;
const OUTCOME_SLIDE_MS = 4500;

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
    </div>`;
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
      if (overlayEl) {
        overlayEl.hidden = true;
        overlayEl.classList.remove('en-checkpoint-closing');
      }
    }, 220);
  }
  if (typeof cb === 'function') cb();
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
  overlayEl.hidden = false;
  renderSlide(0);
}

/** True while a checkpoint popup is currently being shown. */
export function isCheckpointActive() {
  return !!activeSlides;
}
