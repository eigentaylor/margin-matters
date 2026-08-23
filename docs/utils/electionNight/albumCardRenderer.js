'use strict';

// Renders one Election Night Album slide card as a PNG data URL, drawn
// entirely from the slide's own data (the same shapes updatePopup.js's
// render*() functions consume - see that file's header comment for the full
// catalogue) via Canvas2D. Deliberately independent of the live checkpoint
// popup DOM: no animation, no timing to race, no third-party CSS-parsing
// library, and a fixed output resolution regardless of the browser's current
// window size or zoom - see changelog/2026-08-18.md for why this replaced
// screenshotting the live popup.

import { blendColors } from '../colorUtils.js';

const CARD_W = 960;
const MARGIN = 20;
const CANVAS_W = CARD_W + MARGIN * 2;
const RADIUS = 16;
const FONT = "'Helvetica Neue', Arial, sans-serif";
const PARTY_TEXT_COLOR = { D: '#7fa8ff', R: '#ff9b9b', O: '#e8c565' };
const PARTY_LEAD_BADGE = { D: '#1e4bd1', R: '#b22222', O: '#C9A400' };

const HEADER_H = 84;
const RIBBON_H = 46;
const PHOTO_SIZE = 156;
const PHOTO_SIZE_BIG = 196;
const COMPARE_ROW_H = 74;
const BOTTOM_PAD = 26;
const RACE_ROW_H = 92;
const RACE_ROW_GAP = 12;
const FOOTER_MAJORITY_H = 30;
const FOOTER_PARTY_H = 84;
const FOOTER_H = FOOTER_MAJORITY_H + FOOTER_PARTY_H;

function partyLetter(leader) {
  return leader === 'D' ? 'D' : (leader === 'R' ? 'R' : 'O');
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
  return { first: '', last: parts[0] || '' };
}

function lastNameOf(fullName) {
  return splitName(fullName).last || fullName || '';
}

function formatVotes(n) {
  return isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
}

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function fitContain(natW, natH, boxW, boxH) {
  const scale = Math.min(boxW / natW, boxH / natH);
  return { w: natW * scale, h: natH * scale };
}

// object-fit:cover's source-crop rect, for the 9-arg drawImage form.
function fitCoverSource(natW, natH, boxW, boxH) {
  const scale = Math.max(boxW / natW, boxH / natH);
  const sw = boxW / scale, sh = boxH / scale;
  return { sx: (natW - sw) / 2, sy: (natH - sh) / 2, sw, sh };
}

// Canvas text doesn't wrap on its own - greedily breaks `str` into lines no
// wider than maxWidth at the given font, for drawLickman()'s speech bubble.
function wrapText(ctx, str, maxWidth, font) {
  ctx.font = font;
  const words = String(str || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach(word => {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function text(ctx, str, x, y, { font, color = '#fff', align = 'left' }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(str == null ? '' : String(str), x, y);
}

// Draws a pill and returns its measured width, so callers that need to place
// something after it (or center/right-align it) know its extent.
function pill(ctx, str, x, y, { font, textColor = '#1a1a1a', bg, padX = 10, height = 26, align = 'left' }) {
  ctx.font = font;
  const w = ctx.measureText(str).width + padX * 2;
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  roundRectPath(ctx, left, y, w, height, 6);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, left + w / 2, y + height / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  return w;
}

// `borderColor`, when passed, draws a solid-color ring on top of everything
// else - around the actual drawn image content (via fitContain's rect), not
// the full square, so a non-square portrait's border hugs the visible photo
// instead of tracing an oversized square with empty letterboxed corners
// inside it (there's no image content to hug for the no-photo fallback, so
// that case still rings the full square). `hideBadge` skips the usual
// bottom-left party-letter badge. Both are used by drawRaceOverview() only -
// every other caller omits them and gets the original plain-square,
// badge-always-on box.
function drawPhotoBox(ctx, img, x, y, size, leader, borderColor, hideBadge) {
  roundRectPath(ctx, x, y, size, size, 10);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x, y, size, size);
  let contentRect = null;
  if (img) {
    const { w, h } = fitContain(img.naturalWidth, img.naturalHeight, size, size);
    const ix = x + (size - w) / 2, iy = y + (size - h) / 2;
    ctx.drawImage(img, ix, iy, w, h);
    contentRect = { x: ix, y: iy, w, h };
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `900 ${size * 0.4}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(partyLetter(leader), x + size / 2, y + size / 2);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  if (borderColor) {
    const r = contentRect || { x, y, w: size, h: size };
    roundRectPath(ctx, r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3, 8);
    ctx.lineWidth = 3;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
  }
  if (hideBadge) return;
  // Party badge, bottom-left corner of the photo box.
  const bs = 30;
  roundRectPath(ctx, x + 7, y + size - bs - 7, bs, bs, 7);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.stroke();
  ctx.font = `900 15px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(partyLetter(leader), x + 7 + bs / 2, y + size - bs - 7 + bs / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawMiniAvatar(ctx, img, cx, cy, r, code) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const { sx, sy, sw, sh } = fitCoverSource(img.naturalWidth, img.naturalHeight, r * 2, r * 2);
    ctx.drawImage(img, sx, sy, sw, sh, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `900 ${r}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(code || '', cx, cy + 1);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawCardBackground(ctx, w, h, accent, breaking) {
  const top = blendColors(accent, '#000000', 0.08);
  const bottom = blendColors(accent, '#000000', 0.30);
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  roundRectPath(ctx, 0, 0, w, h, RADIUS);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
  if (breaking) {
    roundRectPath(ctx, 1.5, 1.5, w - 3, h - 3, RADIUS);
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.stroke();
  }
}

function drawBreakingRibbon(ctx, w, label) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, w, RIBBON_H);
  text(ctx, label.toUpperCase(), w / 2, RIBBON_H / 2 + 6, { font: `900 15px ${FONT}`, align: 'center' });
  return RIBBON_H;
}

function drawHeader(ctx, w, stateName, timeLabel, evLabel, evNum, top = 0) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, top, w, HEADER_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(0, top + HEADER_H);
  ctx.lineTo(w, top + HEADER_H);
  ctx.stroke();
  text(ctx, (stateName || '').toUpperCase(), 26, top + 50, { font: `900 32px ${FONT}` });
  if (timeLabel) text(ctx, timeLabel, 26, top + 70, { font: `600 13px ${FONT}`, color: 'rgba(255,255,255,0.55)' });
  if (evLabel) {
    text(ctx, evLabel.toUpperCase(), w - 26, top + 34, { font: `700 12px ${FONT}`, color: 'rgba(255,255,255,0.85)', align: 'right' });
    text(ctx, String(evNum), w - 26, top + 68, { font: `900 30px ${FONT}`, align: 'right' });
  }
  return top + HEADER_H;
}

// `rating`, when passed ({label, color}), draws a small "Pre-election: X"
// pill centered below the bar - only ever set for a real sim2028 run (see
// election-night.js's isSim2028LiveRun()), never a historical replay.
function drawStatsBar(ctx, x, y, w, reportingPct, rating) {
  if (!isFinite(reportingPct)) return y;
  const pct = Math.max(0, Math.min(1, reportingPct)) * 100;
  const barW = Math.min(220, w - 110);
  const barX = x + (w - barW - 110) / 2;
  const barY = y + 6;
  roundRectPath(ctx, barX, barY, barW, 9, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fill();
  roundRectPath(ctx, barX, barY, barW * (pct / 100), 9, 5);
  ctx.fillStyle = '#2ecc71';
  ctx.fill();
  text(ctx, `${pct.toFixed(1)}% counted`, barX + barW + 12, barY + 9, { font: `400 14px ${FONT}`, color: 'rgba(255,255,255,0.75)' });
  let bottom = y + 30;
  if (rating && rating.label) {
    pill(ctx, `Pre-election: ${rating.label}`, x + w / 2, bottom, { font: `800 12px ${FONT}`, bg: rating.color, textColor: '#fff', height: 22, align: 'center' });
    bottom += 30;
  }
  return bottom;
}

// Two- or three-row D/R(/O) vote comparison. The leading row also carries a
// margin readout above the vote count - both the percent form ("D+0.2") and
// the raw-vote form ("D+11,002") together, e.g. "D+0.2 (D+11,002)".
async function drawComparisonRows(ctx, slide, x, y, w) {
  if (!isFinite(slide.dVotes) && !isFinite(slide.rVotes)) return y;
  const total = isFinite(slide.countedVotes) && slide.countedVotes > 0
    ? slide.countedVotes
    : (isFinite(slide.dVotes) && isFinite(slide.rVotes) ? slide.dVotes + slide.rVotes : null);
  const pctOf = (v) => (total && isFinite(v)) ? (v / total * 100) : null;
  const sides = [
    { code: 'D', votes: slide.dVotes, pct: pctOf(slide.dVotes), portrait: slide.dPortraitUrl, name: slide.dCandidateName || 'Democrat' },
    { code: 'R', votes: slide.rVotes, pct: pctOf(slide.rVotes), portrait: slide.rPortraitUrl, name: slide.rCandidateName || 'Republican' }
  ];
  if (slide.oCandidateName) sides.push({ code: 'O', votes: slide.oVotes, pct: pctOf(slide.oVotes), portrait: slide.oPortraitUrl, name: slide.oCandidateName });
  sides.sort((a, b) => (b.code === slide.leader ? 1 : 0) - (a.code === slide.leader ? 1 : 0));

  const leaderSide = sides.find(s => s.code === slide.leader);
  const bestOtherVotes = sides.reduce((max, s) => (s.code !== slide.leader && isFinite(s.votes) && s.votes > max) ? s.votes : max, -Infinity);
  const aheadBy = (leaderSide && isFinite(leaderSide.votes) && bestOtherVotes > -Infinity) ? Math.abs(leaderSide.votes - bestOtherVotes) : null;
  const hasMargin = slide.marginPctText && slide.marginPctText !== 'None';
  const marginLine = hasMargin
    ? `${slide.marginPctText}${aheadBy != null ? ` (${slide.leader}+${formatVotes(aheadBy)})` : ''}`
    : null;

  const boxTop = y;
  const boxH = COMPARE_ROW_H * sides.length;
  roundRectPath(ctx, x, boxTop, w, boxH, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fill();

  const images = await Promise.all(sides.map(s => loadImage(s.portrait)));

  sides.forEach((side, i) => {
    const rowY = boxTop + i * COMPARE_ROW_H;
    const isLeading = side.code === slide.leader;
    if (isLeading) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, rowY, w, COMPARE_ROW_H);
    }
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(x, rowY);
      ctx.lineTo(x + w, rowY);
      ctx.stroke();
    }
    const midY = rowY + (isLeading && marginLine ? COMPARE_ROW_H / 2 + 12 : COMPARE_ROW_H / 2);
    if (isLeading && marginLine) {
      pill(ctx, marginLine, x + 60, rowY + 10, { font: `900 12px ${FONT}`, bg: slide.accentColor || '#444', textColor: '#fff', height: 22, padX: 8 });
    }
    drawMiniAvatar(ctx, images[i], x + 30, midY, 17, side.code);
    text(ctx, lastNameOf(side.name).toUpperCase(), x + 60, midY + 6, { font: `800 18px ${FONT}` });

    const pctText = side.pct != null ? `${side.pct.toFixed(1)}%` : '—';
    const pctW = 74;
    roundRectPath(ctx, x + w - 24 - pctW, midY - 18, pctW, 36, 7);
    ctx.fillStyle = isLeading ? PARTY_LEAD_BADGE[side.code] : 'rgba(255,255,255,0.12)';
    ctx.fill();
    text(ctx, pctText, x + w - 24 - pctW / 2, midY + 7, { font: `900 18px ${FONT}`, align: 'center' });

    let rightEdge = x + w - 24 - pctW - 16;
    text(ctx, formatVotes(side.votes), rightEdge, midY + 6, { font: `800 18px ${FONT}`, align: 'right' });
    if (isLeading) {
      ctx.font = `800 18px ${FONT}`;
      rightEdge -= ctx.measureText(formatVotes(side.votes)).width + 20;
      text(ctx, '✓', rightEdge, midY + 6, { font: `900 18px ${FONT}`, color: '#f2dfa1', align: 'right' });
    }
  });

  return boxTop + boxH + 20;
}

function drawWinnerBadge(ctx, x, y, label, isCorrection) {
  const bg = isCorrection ? '#e6362c' : '#f2dfa1';
  const color = isCorrection ? '#fff' : '#1a1a1a';
  pill(ctx, label, x, y, { font: `800 16px ${FONT}`, bg, textColor: color, height: 30 });
}

async function drawCallOrCorrection(ctx, slide, w, headerBottom) {
  const isCorrection = slide.kind === 'correction';
  const photoImg = await loadImage(slide.portraitUrl);
  const bodyY = headerBottom + 24;
  drawPhotoBox(ctx, photoImg, 26, bodyY, PHOTO_SIZE, slide.leader);

  const textX = 26 + PHOTO_SIZE + 24;
  drawWinnerBadge(ctx, textX, bodyY + 6, isCorrection ? '⚠ CORRECTION' : '✓ PROJECTED WINNER', isCorrection);
  const { first, last } = splitName(slide.candidateName);
  let nameY = bodyY + 66;
  if (first) {
    text(ctx, first, textX, nameY, { font: `700 20px ${FONT}` });
    nameY += 38;
  }
  text(ctx, last, textX, nameY, { font: `900 40px ${FONT}` });
  if (isCorrection && slide.previousCandidateName) {
    text(ctx, `Previously called for ${slide.previousCandidateName}`, textX, nameY + 26, { font: `400 14px ${FONT}`, color: 'rgba(255,255,255,0.75)' });
  }

  let y = bodyY + PHOTO_SIZE + 24;
  y = await drawComparisonRows(ctx, slide, 26, y, w - 52);
  y = drawStatsBar(ctx, 26, y, w - 52, slide.reportingPct, slide.priorRatingLabel ? { label: slide.priorRatingLabel, color: slide.priorRatingColor } : null);
  return y + BOTTOM_PAD;
}

async function drawRetraction(ctx, slide, w, headerBottom) {
  const photoImg = await loadImage(slide.portraitUrl);
  const bodyY = headerBottom + 24;
  drawPhotoBox(ctx, photoImg, 26, bodyY, PHOTO_SIZE, slide.leader);
  const textX = 26 + PHOTO_SIZE + 24;
  pill(ctx, '↺ TOO CLOSE TO CALL', textX, bodyY + 6, { font: `800 16px ${FONT}`, bg: '#c0430f', textColor: '#fff', height: 30 });
  const { first, last } = splitName(slide.candidateName);
  let nameY = bodyY + 66;
  if (first) { text(ctx, first, textX, nameY, { font: `700 20px ${FONT}` }); nameY += 38; }
  text(ctx, last, textX, nameY, { font: `900 40px ${FONT}` });
  text(ctx, `Previously called for ${slide.candidateName || 'the leader'} — race has narrowed`, textX, nameY + 28, { font: `400 14px ${FONT}`, color: 'rgba(255,255,255,0.75)' });
  const y = drawStatsBar(ctx, 26, bodyY + PHOTO_SIZE + 24, w - 52, slide.reportingPct);
  return y + BOTTOM_PAD;
}

async function drawLeadFlip(ctx, slide, w, headerBottom) {
  const photoImg = await loadImage(slide.portraitUrl);
  const bodyY = headerBottom + 24;
  drawPhotoBox(ctx, photoImg, 26, bodyY, PHOTO_SIZE, slide.leader);
  const textX = 26 + PHOTO_SIZE + 24;
  pill(ctx, '↑ TAKES THE LEAD', textX, bodyY + 6, { font: `800 16px ${FONT}`, bg: '#2456c9', textColor: '#fff', height: 30 });
  const { first, last } = splitName(slide.candidateName);
  let nameY = bodyY + 66;
  if (first) { text(ctx, first, textX, nameY, { font: `700 20px ${FONT}` }); nameY += 38; }
  text(ctx, last, textX, nameY, { font: `900 40px ${FONT}` });
  const marginLine = slide.marginText ? `${slide.marginText} — still too close to call` : 'Still too close to call';
  text(ctx, marginLine, textX, nameY + 28, { font: `400 14px ${FONT}`, color: 'rgba(255,255,255,0.75)' });
  let y = bodyY + PHOTO_SIZE + 24;
  y = await drawComparisonRows(ctx, slide, 26, y, w - 52);
  y = drawStatsBar(ctx, 26, y, w - 52, slide.reportingPct, slide.priorRatingLabel ? { label: slide.priorRatingLabel, color: slide.priorRatingColor } : null);
  return y + BOTTOM_PAD;
}

// Signed margin (D-positive) -> "D+3.2" / "R+1.8" / "EVEN", matching
// docs/utils/formatters.js's fmtLean() - reimplemented locally like
// updatePopup.js's own copy, since this module is deliberately import-free
// apart from blendColors().
function formatSignedMargin(x) {
  if (!isFinite(x)) return '—';
  if (Math.abs(x) < 0.000005) return 'EVEN';
  return (x > 0 ? 'D+' : 'R+') + (Math.abs(x) * 100).toFixed(1);
}

// The night's opening "portrait of the race" title card - see
// updatePopup.js's header comment for the full 'raceOverview' shape. No
// header/ribbon (it's non-breaking, informational only): big D/R photos
// side by side, an optional smaller third-party photo bottom-aligned
// between them, and (sim2028 only) a row of forecast stat tiles below.
async function drawRaceOverview(ctx, slide, w) {
  let y = 34;
  text(ctx, slide.title || 'Presidential Election', w / 2, y + 26, { font: `900 30px ${FONT}`, align: 'center' });
  y += 26 + 28;

  const hasO = !!slide.oCandidateName;
  const [dImg, rImg, oImg] = await Promise.all([
    loadImage(slide.dPortraitUrl),
    loadImage(slide.rPortraitUrl),
    hasO ? loadImage(slide.oPortraitUrl) : Promise.resolve(null)
  ]);

  const bigSize = PHOTO_SIZE_BIG;
  const smallSize = 128;
  const gap = hasO ? 20 : 40;
  const totalW = hasO ? (bigSize * 2 + smallSize + gap * 2) : (bigSize * 2 + gap);
  let x = (w - totalW) / 2;
  const photosTop = y;
  const bigBottom = photosTop + bigSize;
  const nameY = bigBottom + 28;
  const partyLineY = nameY + 19;

  // Full name on one line, "(D)"/"(R)" on a smaller line beneath - skipped
  // for the third-party candidate (see updatePopup.js's renderRaceOverview
  // for why a bare "(O)" after a real name reads oddly). Canvas text
  // doesn't wrap on its own, so a long full name (unlike the live DOM
  // version's flexbox) gets one fixed-size line rather than shrinking to
  // fit; acceptable for how long real candidate names run.
  const caption = (fullName, fallback, code, cx, big) => {
    text(ctx, fullName || fallback, cx, nameY, { font: `800 ${big ? 16 : 13}px ${FONT}`, align: 'center' });
    if (code !== 'O') {
      text(ctx, `(${code})`, cx, partyLineY, { font: `700 ${big ? 12 : 11}px ${FONT}`, color: 'rgba(255,255,255,0.6)', align: 'center' });
    }
  };

  drawPhotoBox(ctx, dImg, x, photosTop, bigSize, 'D', PARTY_LEAD_BADGE.D, true);
  caption(slide.dCandidateName, 'Democrat', 'D', x + bigSize / 2, true);
  x += bigSize + gap;

  if (hasO) {
    // Bottom-aligned with the two big photos, so "smaller and between them"
    // reads as sitting slightly in front rather than just shrunk in place.
    drawPhotoBox(ctx, oImg, x, bigBottom - smallSize, smallSize, 'O', PARTY_LEAD_BADGE.O, true);
    caption(slide.oCandidateName, 'Other', 'O', x + smallSize / 2, false);
    x += smallSize + gap;
  }

  drawPhotoBox(ctx, rImg, x, photosTop, bigSize, 'R', PARTY_LEAD_BADGE.R, true);
  caption(slide.rCandidateName, 'Republican', 'R', x + bigSize / 2, true);

  let bottomY = partyLineY + 20;

  if (slide.stats) {
    const s = slide.stats;
    const probD = Math.max(0, Math.min(1, s.probD));
    const probTie = Math.max(0, Math.min(1, s.probTie || 0));
    const probR = Math.max(0, 1 - probD - probTie);
    const medianText = isFinite(s.medianDemEv)
      ? `${Math.round(s.medianDemEv)} D${Array.isArray(s.evRange90) ? ` (${Math.round(s.evRange90[0])}–${Math.round(s.evRange90[1])})` : ''}`
      : '—';
    const stats = [
      [`${lastNameOf(slide.dCandidateName).toUpperCase()} TO WIN`, `${(probD * 100).toFixed(1)}%`],
      [`${lastNameOf(slide.rCandidateName).toUpperCase()} TO WIN`, `${(probR * 100).toFixed(1)}%`],
      ['EC TIE', `${(probTie * 100).toFixed(1)}%`],
      ['EST. NPV', formatSignedMargin(s.npvMargin)],
      ['MEDIAN EV', medianText]
    ];
    bottomY += 16;
    const rowX = 26, rowW = w - 52;
    const tileW = rowW / stats.length;
    stats.forEach(([label, value], i) => {
      const tx = rowX + tileW * i;
      const cx = tx + tileW / 2;
      roundRectPath(ctx, tx + 4, bottomY, tileW - 8, 64, 10);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fill();
      text(ctx, label, cx, bottomY + 22, { font: `800 10px ${FONT}`, color: 'rgba(255,255,255,0.6)', align: 'center' });
      text(ctx, value, cx, bottomY + 46, { font: `900 18px ${FONT}`, align: 'center' });
    });
    bottomY += 64;
  }

  return bottomY + BOTTOM_PAD;
}

const LICKMAN_ACCENT = '#9b2f6b';

// Album analogue of updatePopup.js's renderLickman() - portrait + speech
// bubble, used for both 'lickmanIntro' and 'lickmanClosing'. No ribbon/header
// (mirrors the live popup, which is also chrome-free apart from the small
// label above the photo).
async function drawLickman(ctx, slide, w) {
  const img = await loadImage(slide.portraitUrl);
  let y = 30;
  text(ctx, (slide.label || 'ALECK LICKMAN').toUpperCase(), w / 2, y + 14, { font: `900 15px ${FONT}`, color: 'rgba(255,255,255,0.65)', align: 'center' });
  y += 40;

  const photoSize = 130;
  const photoX = 30;
  const bubbleX = photoX + photoSize + 24;
  const bubbleW = w - bubbleX - 26;

  ctx.save();
  ctx.beginPath();
  ctx.arc(photoX + photoSize / 2, y + photoSize / 2, photoSize / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const { sx, sy, sw, sh } = fitCoverSource(img.naturalWidth, img.naturalHeight, photoSize, photoSize);
    ctx.drawImage(img, sx, sy, sw, sh, photoX, y, photoSize, photoSize);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(photoX, y, photoSize, photoSize);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(photoX + photoSize / 2, y + photoSize / 2, photoSize / 2, 0, Math.PI * 2);
  ctx.strokeStyle = LICKMAN_ACCENT;
  ctx.lineWidth = 3;
  ctx.stroke();

  const font = `700 20px ${FONT}`;
  const lines = wrapText(ctx, slide.dialogueText, bubbleW - 32, font);
  const lineH = 27;
  const bubbleH = Math.max(photoSize, lines.length * lineH + 56);
  roundRectPath(ctx, bubbleX, y, bubbleW, bubbleH, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fill();

  let ty = y + 34;
  lines.forEach(line => {
    text(ctx, line, bubbleX + 16, ty, { font, color: '#fff' });
    ty += lineH;
  });
  text(ctx, `${slide.falseBeets} / 13 BEETS FALSE`, bubbleX + 16, y + bubbleH - 16, { font: `800 12px ${FONT}`, color: 'rgba(255,255,255,0.55)' });

  return y + Math.max(photoSize, bubbleH) + BOTTOM_PAD;
}

async function drawOutcome(ctx, slide, w, ribbonBottom) {
  const photoImg = await loadImage(slide.portraitUrl);
  const y = ribbonBottom + 34;
  drawPhotoBox(ctx, photoImg, (w - PHOTO_SIZE_BIG) / 2, y, PHOTO_SIZE_BIG, slide.leader);
  text(ctx, (slide.candidateName || '').toUpperCase(), w / 2, y + PHOTO_SIZE_BIG + 50, { font: `900 40px ${FONT}`, align: 'center' });
  text(ctx, (slide.outcomeLabel || 'Elected President').toUpperCase(), w / 2, y + PHOTO_SIZE_BIG + 78, { font: `800 17px ${FONT}`, color: 'rgba(255,255,255,0.9)', align: 'center' });
  return y + PHOTO_SIZE_BIG + 78 + BOTTOM_PAD;
}

async function drawFinal(ctx, slide, w, ribbonBottom) {
  const dName = lastNameOf(slide.dCandidateName) || 'Democrat';
  const rName = lastNameOf(slide.rCandidateName) || 'Republican';
  let y = ribbonBottom + 34;
  if (slide.winner) {
    const isD = slide.winner === 'D';
    const winnerName = isD ? dName : rName;
    const winnerPortrait = isD ? slide.dPortraitUrl : slide.rPortraitUrl;
    const img = await loadImage(winnerPortrait);
    drawPhotoBox(ctx, img, (w - PHOTO_SIZE_BIG) / 2, y, PHOTO_SIZE_BIG, slide.winner);
    text(ctx, winnerName.toUpperCase(), w / 2, y + PHOTO_SIZE_BIG + 50, { font: `900 40px ${FONT}`, align: 'center' });
    text(ctx, (slide.outcomeLabel || 'Elected President').toUpperCase(), w / 2, y + PHOTO_SIZE_BIG + 78, { font: `800 17px ${FONT}`, color: 'rgba(255,255,255,0.9)', align: 'center' });
    y = y + PHOTO_SIZE_BIG + 78;
  } else {
    const [dImg, rImg] = await Promise.all([loadImage(slide.dPortraitUrl), loadImage(slide.rPortraitUrl)]);
    drawMiniAvatar(ctx, dImg, w / 2 - 36, y + 36, 36, 'D');
    drawMiniAvatar(ctx, rImg, w / 2 + 36, y + 36, 36, 'R');
    text(ctx, 'NO MAJORITY', w / 2, y + 100, { font: `900 34px ${FONT}`, align: 'center' });
    y += 116;
  }
  text(ctx, `${slide.dEv} D  –  ${slide.rEv} R${slide.oEv ? `  (${slide.oEv} Other)` : ''}`, w / 2, y + 34, { font: `900 26px ${FONT}`, align: 'center' });
  y += 48;
  if (!slide.winner) {
    text(ctx, 'Decided by the House of Representatives', w / 2, y + 22, { font: `800 14px ${FONT}`, color: 'rgba(255,255,255,0.9)', align: 'center' });
    y += 38;
  }
  return y + BOTTOM_PAD;
}

async function drawUncalled(ctx, slide, w, ribbonBottom) {
  const [dImg, rImg] = await Promise.all([loadImage(slide.dPortraitUrl), loadImage(slide.rPortraitUrl)]);
  let y = ribbonBottom + 34;
  drawMiniAvatar(ctx, dImg, w / 2 - 36, y + 36, 36, 'D');
  drawMiniAvatar(ctx, rImg, w / 2 + 36, y + 36, 36, 'R');
  text(ctx, 'NO LONGER DECIDED', w / 2, y + 100, { font: `900 30px ${FONT}`, align: 'center' });
  y += 116;
  text(ctx, `${slide.dEv} D  –  ${slide.rEv} R`, w / 2, y + 34, { font: `900 26px ${FONT}`, align: 'center' });
  y += 48;
  text(ctx, 'No candidate currently has a projected majority', w / 2, y + 22, { font: `800 14px ${FONT}`, color: 'rgba(255,255,255,0.9)', align: 'center' });
  y += 38;
  return y + BOTTOM_PAD;
}

async function drawRaces(ctx, slide, w, headerBottom) {
  const candidates = Array.isArray(slide.candidates) ? slide.candidates : [];
  const images = await Promise.all(candidates.map(c => loadImage(c.portraitUrl)));
  const rowX = 26, rowW = w - 52;
  let y = headerBottom + 18;
  candidates.forEach((c, i) => {
    const rowY = y + i * (RACE_ROW_H + RACE_ROW_GAP);
    const accent = c.accentColor || '#8a8a8a';
    roundRectPath(ctx, rowX, rowY, rowW, RACE_ROW_H, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    const pSize = 64;
    const px = rowX + 18;
    const img = images[i];
    if (img) {
      roundRectPath(ctx, px, rowY + (RACE_ROW_H - pSize) / 2, pSize, pSize, 9);
      ctx.save();
      ctx.clip();
      const { sx, sy, sw, sh } = fitCoverSource(img.naturalWidth, img.naturalHeight, pSize, pSize);
      ctx.drawImage(img, sx, sy, sw, sh, px, rowY + (RACE_ROW_H - pSize) / 2, pSize, pSize);
      ctx.restore();
    } else {
      roundRectPath(ctx, px, rowY + (RACE_ROW_H - pSize) / 2, pSize, pSize, 9);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      text(ctx, partyLetter(c.leader), px + pSize / 2, rowY + RACE_ROW_H / 2 + 7, { font: `900 22px ${FONT}`, align: 'center' });
    }

    // Middle column: state/EV, bar, reporting % - sized to leave room on the
    // right for the margin badge regardless of card width.
    let tx = px + pSize + 18;
    const rightColW = 150;
    const midColW = rowW - (tx - rowX) - rightColW - 18;
    if (c.keyRace) {
      const kw = pill(ctx, 'KEY', tx, rowY + 14, { font: `900 11px ${FONT}`, bg: accent, textColor: '#fff', height: 20, padX: 7 });
      tx += kw + 8;
    }
    text(ctx, c.displayLabel || '', tx, rowY + 30, { font: `900 18px ${FONT}` });
    if (c.ev > 0) text(ctx, `${c.ev} EV`, tx, rowY + 50, { font: `600 12px ${FONT}`, color: 'rgba(255,255,255,0.7)' });

    const barX = px + pSize + 18, barW = Math.max(80, midColW - 10), barY = rowY + RACE_ROW_H - 22;
    const pct = isFinite(c.reporting) ? Math.max(0, Math.min(1, c.reporting)) * 100 : 0;
    roundRectPath(ctx, barX, barY, barW, 7, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();
    roundRectPath(ctx, barX, barY, barW * (pct / 100), 7, 4);
    ctx.fillStyle = accent;
    ctx.fill();
    text(ctx, `${pct.toFixed(0)}% in`, barX, barY - 8, { font: `400 12px ${FONT}`, color: 'rgba(255,255,255,0.7)' });
    // Pre-election rating (sim2028 runs only - see updatePopup.js's
    // renderRaces() for the DOM equivalent), right-aligned to the bar's own
    // right edge so it never collides with the "% in" text on the left.
    if (c.priorRatingLabel) {
      pill(ctx, c.priorRatingLabel, barX + barW, barY - 20, { font: `800 10px ${FONT}`, bg: c.priorRatingColor, textColor: '#fff', height: 18, padX: 6, align: 'right' });
    }

    // Right column: margin badge + raw margin, right-aligned with margin
    // from the card edge so it can never run off the canvas.
    const rightX = rowX + rowW - 16;
    const marginText = c.marginPctText && c.marginPctText !== 'None' ? c.marginPctText : 'EVEN';
    pill(ctx, marginText, rightX, rowY + 16, { font: `900 14px ${FONT}`, bg: accent, textColor: '#fff', height: 26, align: 'right' });
    if (c.rawMarginText) text(ctx, c.rawMarginText, rightX, rowY + 62, { font: `400 12px ${FONT}`, color: 'rgba(255,255,255,0.65)', align: 'right' });
  });
  return y + candidates.length * (RACE_ROW_H + RACE_ROW_GAP) + BOTTOM_PAD;
}

// Simple wrapped row of state-name pills, each with an EV count - the album
// analogue of updatePopup.js's .en-cp-pollclose-chip list. No portraits or
// bars, since a poll-close marker isn't about any one candidate.
function drawPollClose(ctx, slide, w, headerBottom) {
  const states = Array.isArray(slide.states) ? slide.states : [];
  const padX = 26;
  const rightEdge = w - padX;
  const gapX = 10, gapY = 10, chipH = 34;
  const font = `700 15px ${FONT}`;
  ctx.font = font;
  let x = padX, y = headerBottom + 18;
  states.forEach(s => {
    const label = s.ev > 0 ? `${s.name} · ${s.ev} EV` : s.name;
    const chipW = ctx.measureText(label).width + 24;
    if (x > padX && x + chipW > rightEdge) { x = padX; y += chipH + gapY; }
    roundRectPath(ctx, x, y, chipW, chipH, chipH / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
    text(ctx, label, x + chipW / 2, y + chipH / 2 + 5, { font, align: 'center' });
    x += chipW + gapX;
  });
  return y + chipH + BOTTOM_PAD;
}

async function drawFinalResults(ctx, slide, w, headerBottom) {
  const candidates = Array.isArray(slide.candidates) ? slide.candidates : [];
  const images = await Promise.all(candidates.map(c => loadImage(c.portraitUrl)));
  const rowX = 26, rowW = w - 52;
  let y = headerBottom + 18;
  candidates.forEach((c, i) => {
    const rowY = y + i * (RACE_ROW_H + RACE_ROW_GAP);
    const accent = c.accentColor || '#8a8a8a';
    roundRectPath(ctx, rowX, rowY, rowW, RACE_ROW_H, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    const pSize = 64;
    const px = rowX + 18;
    const img = images[i];
    if (img) {
      roundRectPath(ctx, px, rowY + (RACE_ROW_H - pSize) / 2, pSize, pSize, 9);
      ctx.save();
      ctx.clip();
      const { sx, sy, sw, sh } = fitCoverSource(img.naturalWidth, img.naturalHeight, pSize, pSize);
      ctx.drawImage(img, sx, sy, sw, sh, px, rowY + (RACE_ROW_H - pSize) / 2, pSize, pSize);
      ctx.restore();
    } else {
      roundRectPath(ctx, px, rowY + (RACE_ROW_H - pSize) / 2, pSize, pSize, 9);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      text(ctx, partyLetter(c.leader), px + pSize / 2, rowY + RACE_ROW_H / 2 + 7, { font: `900 22px ${FONT}`, align: 'center' });
    }

    let tx = px + pSize + 18;
    const rightColW = 150;
    const midColW = rowW - (tx - rowX) - rightColW - 18;
    if (c.isTippingPoint) {
      const sw = pill(ctx, '★ Tipping point', tx, rowY + 14, { font: `900 11px ${FONT}`, bg: '#d4af37', textColor: '#000', height: 20, padX: 7 });
      tx += sw + 8;
    }
    text(ctx, c.displayLabel || '', tx, rowY + 30, { font: `900 18px ${FONT}` });
    if (c.ev > 0) text(ctx, `${c.ev} EV`, tx, rowY + 50, { font: `600 12px ${FONT}`, color: 'rgba(255,255,255,0.7)' });
    // Pre-election rating (sim2028 runs only) - the DOM equivalent of
    // updatePopup.js's renderFinalResults() new meta row.
    if (c.priorRatingLabel) {
      pill(ctx, c.priorRatingLabel, tx, rowY + 60, { font: `800 10px ${FONT}`, bg: c.priorRatingColor, textColor: '#fff', height: 18, padX: 6 });
    }

    const rightX = rowX + rowW - 16;
    const marginText = c.marginPctText && c.marginPctText !== 'None' ? c.marginPctText : 'EVEN';
    pill(ctx, marginText, rightX, rowY + 16, { font: `900 14px ${FONT}`, bg: accent, textColor: '#fff', height: 26, align: 'right' });
    if (c.rawMarginText) text(ctx, c.rawMarginText, rightX, rowY + 62, { font: `400 12px ${FONT}`, color: 'rgba(255,255,255,0.65)', align: 'right' });
  });
  return y + candidates.length * (RACE_ROW_H + RACE_ROW_GAP) + BOTTOM_PAD;
}

function drawTallyFooter(ctx, w, y, { panelInfo, majority, hasThirdParty, tallyBefore, tallyAfter, images }) {
  const info = panelInfo || {};
  const before = tallyBefore || { D: 0, R: 0, O: 0 };
  const after = tallyAfter || before;

  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillRect(0, y, w, FOOTER_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.stroke();

  if (isFinite(majority)) {
    text(ctx, `${majority} TO WIN`, w / 2, y + FOOTER_MAJORITY_H / 2 + 5, { font: `800 13px ${FONT}`, color: 'rgba(255,255,255,0.6)', align: 'center' });
  }

  const partyY = y + FOOTER_MAJORITY_H;
  const codes = hasThirdParty ? ['D', 'O', 'R'] : ['D', 'R'];
  const boxW = w / codes.length;
  codes.forEach((code, i) => {
    const cx0 = boxW * i;
    const cy = partyY + FOOTER_PARTY_H / 2;
    const p = info[code] || {};
    const name = lastNameOf(p.name) || (code === 'D' ? 'Democrat' : code === 'R' ? 'Republican' : 'Other');
    drawMiniAvatar(ctx, images && images[code], cx0 + 36, cy, 22, code);
    text(ctx, name.toUpperCase(), cx0 + 68, cy - 6, { font: `700 13px ${FONT}`, color: 'rgba(255,255,255,0.8)' });
    const val = isFinite(after[code]) ? after[code] : 0;
    text(ctx, String(val), cx0 + 68, cy + 26, { font: `900 28px ${FONT}`, color: PARTY_TEXT_COLOR[code] });

    const delta = val - ((before && isFinite(before[code])) ? before[code] : val);
    if (delta) {
      ctx.font = `900 28px ${FONT}`;
      const numW = ctx.measureText(String(val)).width;
      const chipText = delta > 0 ? `+${delta}` : String(delta);
      pill(ctx, chipText, cx0 + 68 + numW + 12, cy + 6, { font: `900 13px ${FONT}`, bg: delta > 0 ? '#2ecc71' : '#ff3b30', textColor: '#fff', height: 22 });
    }
  });
}

// Draws the card's whole body (everything above the tally footer) and
// returns the y-coordinate where it ends. Used twice by renderSlideCard()
// below - once against a tall scratch canvas purely to measure that
// coordinate, then again for real once the canvas is sized to fit exactly -
// so the layout math only has to live in one place and can never drift out
// of sync with a separately-hand-maintained height estimate.
async function drawBody(ctx, slide, w) {
  const spotlightKinds = ['call', 'correction', 'retraction', 'leadFlip'];
  if (spotlightKinds.includes(slide.kind)) {
    // Mirrors updatePopup.js's breakingNewsRibbon: any slide.breaking slide
    // gets the ribbon above its header, not just the outcome/final/uncalled
    // capstones below - a breaking key-race call should read as breaking
    // news in the album too, not just via the card's accent border.
    const ribbonBottom = slide.breaking
      ? drawBreakingRibbon(ctx, w, `Breaking news${slide.timeLabel ? ` — ${slide.timeLabel} ET` : ''}`)
      : 0;
    const headerBottom = drawHeader(ctx, w, slide.stateName, slide.timeLabel ? `${slide.timeLabel} ET` : '',
      slide.isNpv ? 'National vote' : 'Electoral votes', slide.isNpv ? '' : (isFinite(slide.ev) ? slide.ev : '-'), ribbonBottom);
    if (slide.kind === 'call' || slide.kind === 'correction') return drawCallOrCorrection(ctx, slide, w, headerBottom);
    if (slide.kind === 'retraction') return drawRetraction(ctx, slide, w, headerBottom);
    return drawLeadFlip(ctx, slide, w, headerBottom);
  }
  if (slide.kind === 'races') {
    const timeLabel = slide.timeLabel ? `${slide.timeLabel} ET` : '';
    const pageLabel = slide.pageCount > 1 ? ` (${slide.pageIndex + 1}/${slide.pageCount})` : '';
    const headerBottom = drawHeader(ctx, w, 'Races to watch', `${timeLabel}${pageLabel}`, '', '');
    return drawRaces(ctx, slide, w, headerBottom);
  }
  if (slide.kind === 'pollClose') {
    const headerBottom = drawHeader(ctx, w, 'Polls Just Closed', slide.timeLabel ? `${slide.timeLabel} ET` : '',
      'Electoral votes', isFinite(slide.totalEv) ? slide.totalEv : '-');
    return drawPollClose(ctx, slide, w, headerBottom);
  }
  if (slide.kind === 'finalResults') {
    const pageLabel = slide.pageCount > 1 ? ` (${slide.pageIndex + 1}/${slide.pageCount})` : '';
    const headerBottom = drawHeader(ctx, w, 'Final Results: Key Races', pageLabel, '', '');
    return drawFinalResults(ctx, slide, w, headerBottom);
  }
  if (slide.kind === 'raceOverview') return drawRaceOverview(ctx, slide, w);
  if (slide.kind === 'lickmanIntro' || slide.kind === 'lickmanClosing') return drawLickman(ctx, slide, w);
  const ribbonLabel = slide.kind === 'final' ? `Final${slide.timeLabel ? ` — ${slide.timeLabel} ET` : ''}` : `Breaking news${slide.timeLabel ? ` — ${slide.timeLabel} ET` : ''}`;
  const ribbonBottom = drawBreakingRibbon(ctx, w, ribbonLabel);
  if (slide.kind === 'outcome') return drawOutcome(ctx, slide, w, ribbonBottom);
  if (slide.kind === 'final') return drawFinal(ctx, slide, w, ribbonBottom);
  if (slide.kind === 'uncalled') return drawUncalled(ctx, slide, w, ribbonBottom);
  return ribbonBottom + BOTTOM_PAD;
}

/**
 * Draw one slide's card and return a PNG data URL.
 * `footer` = { panelInfo: {D,R,O: {name, portraitUrl}}, majority, hasThirdParty,
 *   tallyBefore: {D,R,O}, tallyAfter: {D,R,O} } - the running national tally
 * context, supplied by the caller (election-night.js tracks it across the
 * whole night) rather than read off the slide, since some kinds (races)
 * carry no tally of their own.
 */
export async function renderSlideCard(slide, footer) {
  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = CARD_W;
  measureCanvas.height = 4000;
  const bodyBottom = await drawBody(measureCanvas.getContext('2d'), slide, CARD_W);

  const totalH = bodyBottom + FOOTER_H;
  const canvas = document.createElement('canvas');
  const DPR = 2;
  canvas.width = CANVAS_W * DPR;
  canvas.height = (totalH + MARGIN * 2) * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  ctx.translate(MARGIN, MARGIN);

  const accent = slide.accentColor || '#2f2f2f';
  drawCardBackground(ctx, CARD_W, totalH, accent, !!slide.breaking);
  roundRectPath(ctx, 0, 0, CARD_W, totalH, RADIUS);
  ctx.save();
  ctx.clip();

  await drawBody(ctx, slide, CARD_W);

  const f = footer || {};
  const panelInfo = f.panelInfo || {};
  const images = {
    D: await loadImage(panelInfo.D && panelInfo.D.portraitUrl),
    R: await loadImage(panelInfo.R && panelInfo.R.portraitUrl),
    O: f.hasThirdParty ? await loadImage(panelInfo.O && panelInfo.O.portraitUrl) : null
  };
  drawTallyFooter(ctx, CARD_W, bodyBottom, { ...f, images });

  ctx.restore();
  return canvas.toDataURL('image/png');
}
