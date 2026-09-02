#!/usr/bin/env node
'use strict';

/**
 * Records a GIF of the live flip-scenario UI (docs/index.html: the
 * "Flip winner"/"Break majority"/"Tie" buttons wired up by
 * docs/utils/flipScenarios.js) for a given year/mode/metric, for use as a
 * blog-post asset. This drives the real page headlessly and records the
 * real CSS/JS-driven transitions (the map recoloring, the EV bar resizing,
 * the summary numbers updating) rather than reimplementing the animation,
 * so the GIF stays honest to what a site visitor actually sees — just
 * stretched to `--transition-ms` (default 1200ms) instead of the live
 * site's native ~250-360ms, since real-time is too fast to read in a GIF.
 *
 * Requires:
 *   - `npm start` running in another terminal (serves docs/ on :8080)
 *   - `ffmpeg` installed and on PATH (used only as an external tool via
 *     execFileSync — not an npm dependency)
 *
 * Usage:
 *   node tools/generate_flip_gif.mjs --year 2000 --mode classic
 *   node tools/generate_flip_gif.mjs --year 1876 --mode classic --metric votes
 *   node tools/generate_flip_gif.mjs --year 2020 --mode no_majority --hold-ms 2500
 *   node tools/generate_flip_gif.mjs --year 2016 --mode no_majority --transition-ms 2000
 *   node tools/generate_flip_gif.mjs --year 2020 --mode no_majority --dim
 *   node tools/generate_flip_gif.mjs --year 2016 --mode classic --dim --rendervotes
 *
 * flip_scenarios.ipynb's Step 6 cell prints ready-to-run invocations of this
 * script for its top-10 "most fragile" elections.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { installCdnFallbacks, launchChromium } from '../docs/utils/electionNight/harness.mjs';

const MODE_TOKENS = ['classic', 'no_majority', 'tie'];
const MODE_BUTTON_ID = { classic: 'flipClassic', no_majority: 'flipNoMaj', tie: 'flipTie' };

const DEFAULT_CROP_SELECTORS = ['#map-wrap', '#evBar', '#evNeededToWin'];

// Copied from docs/utils/constants.js's ID_TO_ABBR - kept as a local copy
// (rather than importing the site module or exposing a new window global)
// so --rendervotes stays entirely contained to this script. Only used as a
// bbox-center fallback for the tiny states electionMap.js's own label layer
// skips (see renderVoteLabels below).
const FIPS_TO_ABBR = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };

function parseArgs(argv) {
  const args = {
    year: null, mode: null, metric: 'votes',
    baseUrl: 'http://127.0.0.1:8080',
    outDir: 'flip-gifs', out: null,
    gifWidth: 960, fps: 20,
    preRollMs: 500, holdMs: 1800, transitionMs: 1200,
    viewportWidth: 1100, viewportHeight: 1000,
    crop: true, include: [], dim: true, renderVotes: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--year': args.year = parseInt(next(), 10); break;
      case '--mode': args.mode = next(); break;
      case '--metric': args.metric = next(); break;
      case '--base-url': args.baseUrl = next(); break;
      case '--out-dir': args.outDir = next(); break;
      case '--out': args.out = next(); break;
      case '--gif-width': args.gifWidth = parseInt(next(), 10); break;
      case '--fps': args.fps = parseInt(next(), 10); break;
      case '--pre-roll-ms': args.preRollMs = parseInt(next(), 10); break;
      case '--hold-ms': args.holdMs = parseInt(next(), 10); break;
      case '--transition-ms': args.transitionMs = parseInt(next(), 10); break;
      case '--viewport-width': args.viewportWidth = parseInt(next(), 10); break;
      case '--viewport-height': args.viewportHeight = parseInt(next(), 10); break;
      case '--no-crop': args.crop = false; break;
      case '--include': args.include.push(next()); break;
      case '--dim': args.dim = true; break;
      case '--rendervotes': args.renderVotes = true; break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!Number.isFinite(args.year)) throw new Error('--year <int> is required');
  if (!MODE_TOKENS.includes(args.mode)) throw new Error(`--mode must be one of ${MODE_TOKENS.join('|')}`);
  if (args.metric !== 'votes' && args.metric !== 'margin') throw new Error('--metric must be votes or margin');
  if (!args.out) args.out = `${args.year}_${args.mode}_${args.metric}.gif`;
  if (!args.include.length) {
    // #flipVoteHeadline (renderVoteLabels' headline total) sits outside the
    // map/EV-bar crop box by design, so it needs to be pulled into the
    // default crop region explicitly when --rendervotes is on.
    args.include = args.renderVotes ? [...DEFAULT_CROP_SELECTORS, '#flipVoteHeadline'] : DEFAULT_CROP_SELECTORS;
  }

  return args;
}

function assertFfmpegAvailable() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
  } catch (err) {
    throw new Error('ffmpeg/ffprobe not found on PATH. Install ffmpeg (which bundles ffprobe) and make sure both `ffmpeg -version` and `ffprobe -version` work, then re-run.');
  }
}

/** Actual recorded duration of the video, in seconds. */
function probeDurationSec(webmPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', webmPath
  ]);
  return parseFloat(out.toString().trim());
}

/**
 * Finds the timestamp where hideNonFlipUi's page mutation actually lands
 * in the recording, by scanning for frame-to-frame jumps (ffmpeg's
 * scene-change score) before `upperBoundSec` and taking the LAST one that
 * clears a threshold relative to the biggest jump found — not simply the
 * single biggest jump, because hiding several unrelated elements in one
 * synchronous DOM update doesn't always land in the compositor as one
 * atomic jump: on some captures it showed up as two, e.g. a big jump for
 * "the header disappears, the map jumps up" immediately followed by a
 * smaller one as an intro card beneath it also finishes collapsing.
 * Anchoring on the single max picked up that earlier, still-partially-
 * hidden frame in those cases; the last-above-threshold jump reliably
 * lands on the fully-settled frame instead.
 *
 * This replaced an earlier version that computed the trim point from
 * wall-clock Date.now() deltas plus a fixed safety pad. That was not
 * reliable enough in practice: direct testing (dumping every frame's
 * scene score across many real captures — see changelog for the date)
 * showed the underlying video is a faithful, constant-frame-rate
 * recording (confirmed via uniform PTS spacing), so the wall-clock math
 * itself wasn't fundamentally unsound — but small run-to-run jitter in
 * exactly how long setup took (page load, data fetch, D3 render) was
 * enough to occasionally land the fixed-size trim window a couple hundred
 * ms too early, showing stale pre-hide content for the first frame or
 * two. "Header visible -> hidden" is an abrupt, whole-page layout jump
 * and was consistently far and away the largest scene-score spike in
 * every real capture inspected — nothing else in the recording
 * (including the gradual, ~1.2s flip transition) comes remotely close —
 * so it's a reliable, content-anchored substitute for a timing estimate.
 *
 * `upperBoundSec` should be a value the true "ready" moment is
 * *guaranteed* to fall before, so a late-video artifact (e.g. some large
 * change during the flip transition on an unusual scenario) can't be
 * mistaken for it — see the call site for how that bound is derived from
 * fixed millisecond constants this script itself controls.
 */
function findReadyOffsetSec(webmPath, upperBoundSec) {
  const out = execFileSync('ffmpeg', [
    '-i', webmPath, '-vf', "select='gt(scene,-1)',metadata=print:file=-", '-f', 'null', '-'
  ], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

  const samples = [];
  let pendingTime = null;
  for (const line of out.split('\n')) {
    const timeMatch = line.match(/pts_time:([\d.]+)/);
    if (timeMatch) { pendingTime = parseFloat(timeMatch[1]); continue; }
    const scoreMatch = line.match(/lavfi\.scene_score=([\d.]+)/);
    if (scoreMatch && pendingTime != null && pendingTime <= upperBoundSec) {
      samples.push({ time: pendingTime, score: parseFloat(scoreMatch[1]) });
    }
  }
  const bestScore = samples.reduce((m, s) => Math.max(m, s.score), -1);
  if (bestScore <= 0) {
    throw new Error(`Couldn't find a scene-change marker for the "hide the header" moment within the first ${upperBoundSec.toFixed(1)}s of the recording (best score ${bestScore}). Something in hideNonFlipUi() likely isn't taking effect — inspect the raw capture with FLIP_GIF_DEBUG=1.`);
  }
  const threshold = bestScore * 0.2;
  let lastTime = 0;
  for (const s of samples) {
    if (s.score >= threshold) lastTime = s.time;
  }
  return lastTime;
}

/**
 * Waits for the page to be ready to accept a flip click for this exact
 * (year, mode, metric): the async flip_results.csv/flip_details.csv fetch
 * has resolved into window._flipByYear (flipScenarios.js's
 * buildFlipScenarioMaps -> syncWindowState), the D3 map has rendered, the
 * sliders/select actually reflect what we asked for (guards against the
 * silent year-fallback in testerInit.js), and the requested flip button
 * isn't hidden (flipScenarios.js's updateFlipButtons hides e.g. "Break
 * majority" when it's identical to "Flip winner" for that year/metric).
 * Returns the button's DOM id to click.
 */
async function waitUntilReady(page, { year, mode, metric }) {
  await page.waitForFunction(
    (y) => window._flipByYear && window._flipByYear.get(y) &&
      document.querySelectorAll('#map path.state').length > 0,
    year,
    { timeout: 30000 }
  );

  const state = await page.evaluate(() => ({
    year: parseInt(document.getElementById('yearSlider').value, 10),
    metric: document.getElementById('flipMetric').value
  }));
  if (state.year !== year) throw new Error(`Page loaded year ${state.year}, not the requested ${year} (is it a valid election year?)`);
  if (state.metric !== metric) throw new Error(`Page loaded metric "${state.metric}", not the requested "${metric}"`);

  const btnId = MODE_BUTTON_ID[mode];
  const visible = await page.evaluate((id) => {
    const btn = document.getElementById(id);
    return !!btn && getComputedStyle(btn).display !== 'none';
  }, btnId);
  if (!visible) {
    throw new Error(`"${mode}" has no distinct scenario for ${year}/${metric} (its button is hidden on the live page — e.g. "no_majority" is identical to "classic" for this year). Try a different --mode.`);
  }

  return btnId;
}

/**
 * Stretches the flip transition to `transitionMs` for this capture only
 * (a <style> tag injected into the page, never touching the site's own
 * files). On the live site, the map-fill transition is 250ms
 * (docs/styles.css:1621-1624) and the EV bar's is a 360ms JS-driven
 * transition (docs/utils/testerUpdate.js:704-767) — both real, but too
 * fast to read clearly in a GIF. `transition-duration` in a stylesheet
 * with `!important` overrides the EV bar's inline `transition` style
 * (one of the few cases a stylesheet rule beats an inline one), so this
 * doesn't need to touch testerUpdate.js's JS at all.
 */
async function slowTransitions(page, transitionMs) {
  await page.addStyleTag({
    content: `
    .state, .district { transition-duration: ${transitionMs}ms !important; }
    #evFillD, #evFillU, #evFillO, #evFillR { transition-duration: ${transitionMs}ms !important; }
  ` });
}

/**
 * Experimental --rendervotes overlay: drops a small dark readable box on
 * each flipped state/district showing its raw vote delta (window._activeFlip.units[i]
 * .votes_to_flip / .pct_of_state_votes, already computed by flipScenarios.js's
 * applyFlip() - see docs/utils/flipScenarios.js:234-238), plus a headline
 * total (activeFlip.votesSum) above the EV bar. Entirely self-contained to
 * this script (no docs/ files touched) so it's a one-line removal if it
 * doesn't read well in practice.
 *
 * Positioning reuses docs/utils/electionMap.js's existing per-state label
 * placement cache (window.ElectionMap._visualCenterCache, populated as a
 * side effect of the normal render pipeline) rather than recomputing
 * "good interior point" geometry here. That cache has no entry for the tiny
 * states electionMap.js's own label layer skips (SMALL_STATES in
 * docs/utils/constants.js) or for ME/NE congressional districts (which have
 * no visual-center mechanism at all) - both fall back to a plain bbox
 * center of the relevant path element, via window._districtPaths for
 * districts and FIPS_TO_ABBR + a path.state scan for the tiny states.
 */
async function renderVoteLabels(page) {
  await page.evaluate((fipsToAbbr) => {
    document.querySelectorAll('g.flip-vote-labels, #flipVoteHeadline').forEach(el => el.remove());

    const flip = window._activeFlip;
    if (!flip || !Array.isArray(flip.units)) return;

    const svg = document.querySelector('#map-wrap svg');
    if (!svg) return;

    function anchorFor(unit) {
      if (unit.includes('-')) {
        const sel = window._districtPaths && window._districtPaths.get(unit);
        const node = sel && sel.node && sel.node();
        if (node) { const bb = node.getBBox(); return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }; }
        return null;
      }
      const cached = window.ElectionMap && window.ElectionMap._visualCenterCache && window.ElectionMap._visualCenterCache.get(unit);
      if (cached) return cached;
      let found = null;
      document.querySelectorAll('path.state').forEach(node => {
        if (found || !node.__data__) return;
        const id = String(node.__data__.id).padStart(2, '0');
        if (fipsToAbbr[id] === unit) found = node;
      });
      if (found) { const bb = found.getBBox(); return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }; }
      return null;
    }

    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('class', 'flip-vote-labels');
    svg.appendChild(layer);

    flip.units.forEach(u => {
      const anchor = anchorFor(u.unit);
      if (!anchor) { console.warn('[rendervotes] no anchor for unit', u.unit); return; }

      const lines = [];
      if (u.unit.includes('-')) lines.push(u.unit);
      lines.push(`Δ${(+u.votes_to_flip || 0).toLocaleString('en-US')}`);
      lines.push(`(${+u.pct_of_state_votes || 0}%)`);

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-family', "'Helvetica Neue', Arial, sans-serif");
      text.setAttribute('font-weight', '700');
      text.setAttribute('font-size', '11');
      text.setAttribute('fill', '#fff');
      // Each tspan gets an explicit absolute y (rather than a dy chain off
      // the <text> element's own y) so the whole block is centered on the
      // anchor point up front - lineHeight/fontSize*0.35 approximates the
      // baseline-to-visual-center offset for a single line.
      const fontSize = 11;
      const lineHeight = fontSize * 1.2;
      const startY = anchor.y - (lines.length - 1) * lineHeight / 2 + fontSize * 0.35;
      lines.forEach((line, i) => {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('x', String(anchor.x));
        tspan.setAttribute('y', String(startY + i * lineHeight));
        tspan.textContent = line;
        text.appendChild(tspan);
      });
      g.appendChild(text);
      layer.appendChild(g);

      const bb = text.getBBox();
      const pad = 5;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(bb.x - pad));
      rect.setAttribute('y', String(bb.y - pad));
      rect.setAttribute('width', String(bb.width + pad * 2));
      rect.setAttribute('height', String(bb.height + pad * 2));
      rect.setAttribute('rx', '4');
      rect.setAttribute('fill', '#1a1a1a');
      rect.setAttribute('fill-opacity', '0.85');
      rect.setAttribute('stroke', 'rgba(255,255,255,0.25)');
      g.insertBefore(rect, text);
    });

    const evBar = document.getElementById('evBar');
    if (evBar && flip.votesSum != null) {
      const r = evBar.getBoundingClientRect();
      const box = document.createElement('div');
      box.id = 'flipVoteHeadline';
      box.textContent = `Δ${(+flip.votesSum || 0).toLocaleString('en-US')} votes`;
      box.style.position = 'fixed';
      box.style.left = `${r.left + r.width / 2}px`;
      box.style.top = `${Math.max(0, r.top - 30)}px`;
      box.style.transform = 'translateX(-50%)';
      box.style.background = 'rgba(26,26,26,0.85)';
      box.style.color = '#fff';
      box.style.border = '1px solid rgba(255,255,255,0.25)';
      box.style.borderRadius = '4px';
      box.style.padding = '4px 8px';
      box.style.font = "700 12px 'Helvetica Neue', Arial, sans-serif";
      box.style.zIndex = '9999';
      document.body.appendChild(box);
    }
  }, FIPS_TO_ABBR);
}

// docs/index.html has a lot of UI both above the map (the site header/nav,
// "Margin Matters" title, intro cards) and between the map/EV bar (what we
// actually crop to) and the flip buttons below them (the year slider, PV
// totals/slider, the election-night simulator card) — all irrelevant to
// this capture. Hiding it (display only, values/behavior untouched) makes
// the map the first visible thing on the page and pulls the flip buttons
// up close enough that a normal viewport height fits everything with NO
// scrolling required at any point. That matters more than it sounds: an
// earlier version scrolled the map into view instead of hiding the header,
// and that was empirically unreliable — Playwright's recorded video
// intermittently failed to reflect the scroll (direct page.screenshot()
// calls at the same point always showed the correct, scrolled state, but
// the video sometimes opened on the stale unscrolled page anyway) — so
// this avoids scrolling during a recording altogether rather than trying
// to make scroll-during-recording trustworthy.
const HIDE_FOR_TIGHT_CAPTURE = ['.slider-control-row', '#candidateInfo', '#pvTotals', '#pvSliderLabel', '#quickButtons', '#electionNightCard'];

async function hideNonFlipUi(page) {
  await page.evaluate((selectors) => {
    const mapCard = document.querySelector('#map-wrap') && document.querySelector('#map-wrap').closest('.card');
    let sib = mapCard ? mapCard.previousElementSibling : null;
    while (sib) {
      sib.style.display = 'none';
      sib = sib.previousElementSibling;
    }
    selectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    });
    const pvSlider = document.getElementById('pvSlider');
    if (pvSlider && pvSlider.parentElement) pvSlider.parentElement.style.display = 'none';
  }, HIDE_FOR_TIGHT_CAPTURE);
}

/**
 * Verifies the crop region and the button we're about to click both land
 * within the viewport (top >= 0, bottom <= viewportHeight) now that
 * hideNonFlipUi has compacted the page — with nothing above the map
 * anymore, everything should already sit at the top with no scroll
 * needed. Throws with actionable guidance rather than silently producing
 * a clipped capture or (worse) letting Playwright's own click-triggered
 * auto-scroll kick in.
 */
async function verifyCaptureRegionFits(page, selectors, btnId, viewportHeight) {
  const { cropTop, cropBottom, btnBottom } = await page.evaluate(({ sels, id }) => {
    let minTop = Infinity, maxBottom = 0;
    sels.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      minTop = Math.min(minTop, r.top);
      maxBottom = Math.max(maxBottom, r.bottom);
    });
    const btn = document.getElementById(id);
    return { cropTop: isFinite(minTop) ? minTop : 0, cropBottom: maxBottom, btnBottom: btn ? btn.getBoundingClientRect().bottom : 0 };
  }, { sels: selectors, id: btnId });

  if (cropTop < 0) {
    throw new Error(`The capture region starts ${Math.ceil(-cropTop)}px above the viewport top — something wasn't hidden as expected. This is a bug in generate_flip_gif.mjs's hideNonFlipUi(), not something --viewport-height can fix.`);
  }
  const worstBottom = Math.max(cropBottom, btnBottom);
  if (worstBottom > viewportHeight) {
    const what = btnBottom > cropBottom ? `the "${btnId}" button (clicking it would auto-scroll and jump mid-recording)` : 'the capture region';
    throw new Error(`${what} sits ~${Math.ceil(worstBottom)}px down the page, taller than --viewport-height ${viewportHeight}. Re-run with a taller viewport, e.g. --viewport-height ${Math.ceil(worstBottom) + 40}.`);
  }
}

async function computeCropRect(page, selectors) {
  const rect = await page.evaluate((sels) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top);
      x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
    }
    if (!isFinite(x1)) return null;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }, selectors);
  if (!rect) throw new Error(`None of the crop selectors matched: ${selectors.join(', ')}`);

  const pad = 12;
  const x = Math.max(0, Math.floor(rect.x - pad));
  const y = Math.max(0, Math.floor(rect.y - pad));
  let width = Math.ceil(rect.width + pad * 2);
  let height = Math.ceil(rect.height + pad * 2);
  if (width % 2 !== 0) width += 1;
  if (height % 2 !== 0) height += 1;
  return { x, y, width, height };
}

function convertToGif({ webmPath, startOffsetSec, durationSec, cropRect, gifWidth, fps, outPath }) {
  const cropFilter = cropRect ? `crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y},` : '';
  const outDir = path.dirname(outPath);
  const trimmedPath = path.join(outDir, '.flip-gif-trimmed.mp4');
  const palettePath = path.join(outDir, '.flip-gif-palette.png');

  // Three stages, not two, because of two ffmpeg quirks discovered by
  // testing directly against real captures (not just in theory):
  //   1. -ss/-t placed BEFORE -i ("fast"/keyframe seeking) snaps to the
  //      nearest preceding keyframe, which can land noticeably earlier
  //      than intended (e.g. before the pre-capture scroll had settled,
  //      putting the site header at the front of the GIF) — how far off
  //      depends on keyframe spacing, which varies run to run, so this
  //      failure mode is intermittent rather than consistent.
  //   2. -ss/-t placed AFTER -i ("accurate"/decode seeking) fixes that,
  //      but combined with palettegen's -update 1 it reliably produces
  //      zero output frames on this ffmpeg build.
  // So: do the accurate trim+crop+scale ONCE as plain re-encoded video
  // (no palettegen involved, so accurate seeking works fine), then run
  // palettegen/paletteuse against that already-trimmed clip with no
  // seeking at all — sidesteps both quirks at once.
  execFileSync('ffmpeg', [
    '-y', '-i', webmPath, '-ss', String(startOffsetSec), '-t', String(durationSec),
    // scale's auto dimension must be -2, not -1: -1 just preserves aspect
    // ratio (and can land on an odd number, e.g. 495), but libx264 with
    // yuv420p requires even width/height — -2 rounds to the nearest even.
    '-vf', `${cropFilter}fps=${fps},scale=${gifWidth}:-2:flags=lanczos`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    trimmedPath
  ], { stdio: 'inherit' });

  execFileSync('ffmpeg', [
    '-y', '-i', trimmedPath, '-vf', 'palettegen=stats_mode=diff', '-update', '1', palettePath
  ], { stdio: 'inherit' });

  execFileSync('ffmpeg', [
    '-y', '-i', trimmedPath, '-i', palettePath,
    '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    outPath
  ], { stdio: 'inherit' });

  fs.rmSync(trimmedPath, { force: true });
  fs.rmSync(palettePath, { force: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertFfmpegAvailable();

  const url = `${args.baseUrl}/index.html?year=${args.year}&metric=${args.metric}`;
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flip-gif-'));
  const viewport = { width: args.viewportWidth, height: args.viewportHeight };

  const browser = await launchChromium();
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: viewport }
  });
  const page = await context.newPage();
  page.on('pageerror', err => console.error('[page exception]', err));
  await installCdnFallbacks(page);

  console.log(`Loading ${url} ...`);
  await page.goto(url, { waitUntil: 'load' });

  const btnId = await waitUntilReady(page, args);
  if (args.crop) {
    await hideNonFlipUi(page);
    await verifyCaptureRegionFits(page, args.include, btnId, args.viewportHeight);
  }
  await page.waitForTimeout(300); // let the page's own initial-draw transitions / reflow / scroll above finish (native speed - see below)

  // Checked before the flip click (not after) so it's already on by the
  // time applyFlip's own re-render runs — matches how a real user would
  // use it, and avoids an extra render pass. The checkbox's own 'change'
  // listener (docs/utils/testerInit.js) calls updateAll(), which is a
  // no-op visually right now since no flip is active yet.
  if (args.dim) {
    await page.check('#flipDimToggle');
    await page.waitForTimeout(50);
  }

  // Stretched only now, after the initial draw above has already settled at
  // native speed, so it applies to just the recorded flip transition.
  if (args.transitionMs > 0) await slowTransitions(page, args.transitionMs);

  const preRollStart = Date.now();
  await page.waitForTimeout(args.preRollMs);
  console.log(`Clicking #${btnId} ...`);
  await page.click(`#${btnId}`);
  // With --dim, applyFlip() now stages the dim fade BEFORE the flip's own
  // color/glow transition (docs/utils/flipScenarios.js) instead of running
  // them simultaneously, so the recording needs to hold through both phases.
  const baseTransitionMs = args.transitionMs > 0 ? args.transitionMs : 360;
  const dimStageMs = args.dim ? baseTransitionMs + 30 : 0; // matches applyFlip's own "+30" buffer
  const clickSettleMs = baseTransitionMs + dimStageMs + 200; // 200ms buffer past the transition's own duration
  await page.waitForTimeout(clickSettleMs);
  // Injected only once the flip has visually settled, so the labels appear
  // as a "reveal" rather than popping in mid-transition; total wait time
  // below is unchanged from before this existed.
  if (args.renderVotes) await renderVoteLabels(page);
  await page.waitForTimeout(args.holdMs);

  const cropRect = args.crop ? await computeCropRect(page, args.include) : null;
  const captureEnd = Date.now();

  const video = page.video();
  await context.close();
  await browser.close();

  const webmPath = await video.path();
  if (process.env.FLIP_GIF_DEBUG) {
    console.log('[debug] preRollStart', preRollStart, 'captureEnd', captureEnd);
    console.log('[debug] webmPath', webmPath, 'exists', fs.existsSync(webmPath), 'size', fs.existsSync(webmPath) ? fs.statSync(webmPath).size : -1);
  }

  const totalDurationSec = probeDurationSec(webmPath);
  let startOffsetSec;
  if (args.crop) {
    // Bound the scene-change search using fixed millisecond constants this
    // script controls (not a wall-clock measurement, which is exactly what
    // proved unreliable here) — see findReadyOffsetSec's own comment.
    const minTailSec = (args.preRollMs + clickSettleMs + args.holdMs) / 1000;
    const searchBoundSec = Math.max(0, totalDurationSec - minTailSec);
    const readyOffsetSec = findReadyOffsetSec(webmPath, searchBoundSec);
    startOffsetSec = readyOffsetSec + 0.1; // land just past the jump itself, not on the transitional frame
    if (process.env.FLIP_GIF_DEBUG) console.log('[debug] searchBoundSec', searchBoundSec, 'readyOffsetSec', readyOffsetSec);
  } else {
    // --no-crop skips hideNonFlipUi, so there's no "header disappears" jump
    // for findReadyOffsetSec to anchor on — fall back to a wall-clock
    // estimate for this less common debug path.
    startOffsetSec = Math.max(0, totalDurationSec - ((captureEnd - preRollStart) / 1000 + 0.4));
  }
  const durationSec = totalDurationSec - startOffsetSec;
  if (process.env.FLIP_GIF_DEBUG) {
    console.log('[debug] totalDurationSec', totalDurationSec, 'startOffsetSec', startOffsetSec, 'durationSec', durationSec);
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  const outPath = path.join(args.outDir, args.out);
  console.log(`Converting to GIF (${startOffsetSec.toFixed(2)}s - ${(startOffsetSec + durationSec).toFixed(2)}s) ...`);
  convertToGif({ webmPath, startOffsetSec, durationSec, cropRect, gifWidth: args.gifWidth, fps: args.fps, outPath });

  if (!process.env.FLIP_GIF_DEBUG) fs.rmSync(videoDir, { recursive: true, force: true });
  console.log(`Wrote ${path.resolve(outPath)}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
