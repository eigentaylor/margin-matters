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

function parseArgs(argv) {
  const args = {
    year: null, mode: null, metric: 'votes',
    baseUrl: 'http://127.0.0.1:8080',
    outDir: 'flip-gifs', out: null,
    gifWidth: 720, fps: 20,
    preRollMs: 500, holdMs: 1800, transitionMs: 1200,
    viewportWidth: 1100, viewportHeight: 1000,
    crop: true, include: []
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
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!Number.isFinite(args.year)) throw new Error('--year <int> is required');
  if (!MODE_TOKENS.includes(args.mode)) throw new Error(`--mode must be one of ${MODE_TOKENS.join('|')}`);
  if (args.metric !== 'votes' && args.metric !== 'margin') throw new Error('--metric must be votes or margin');
  if (!args.out) args.out = `${args.year}_${args.mode}_${args.metric}.gif`;
  if (!args.include.length) args.include = DEFAULT_CROP_SELECTORS;

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
  await page.addStyleTag({ content: `
    .state { transition-duration: ${transitionMs}ms !important; }
    #evFillD, #evFillU, #evFillO, #evFillR { transition-duration: ${transitionMs}ms !important; }
  ` });
}

// docs/index.html has a lot of UI sandwiched between the map/EV bar (what
// we actually crop to) and the flip buttons below them (the year slider,
// PV totals/slider, the election-night simulator card) - all irrelevant to
// this capture. Hiding it (display only, values/behavior untouched) pulls
// the flip buttons up close enough to the map/EV bar that a normal
// viewport height fits both without scrolling.
const HIDE_FOR_TIGHT_CAPTURE = ['.slider-control-row', '#candidateInfo', '#pvTotals', '#pvSliderLabel', '#quickButtons', '#electionNightCard'];

async function hideNonFlipUi(page) {
  await page.evaluate((selectors) => {
    selectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    });
    const pvSlider = document.getElementById('pvSlider');
    if (pvSlider && pvSlider.parentElement) pvSlider.parentElement.style.display = 'none';
  }, HIDE_FOR_TIGHT_CAPTURE);
}

/**
 * Scrolls so the capture region's top selector sits at the top of the
 * viewport, *before* recording starts. Without this, the page loads
 * scrolled to the very top (showing the site header/nav above the map),
 * and Playwright's page.click() auto-scrolls the flip button into view the
 * moment it's clicked — a visible mid-recording jump that also breaks a
 * single fixed ffmpeg crop rect, since the content moves within the frame.
 * Throws if the crop region or the button we're about to click still don't
 * fit within the viewport after scrolling (the button sits below the crop
 * region, so it's the real constraint on how short --viewport-height can
 * be) rather than silently getting a clipped or jumpy capture.
 */
async function scrollCaptureRegionIntoView(page, selectors, btnId, viewportHeight) {
  await page.evaluate((sels) => {
    const first = document.querySelector(sels[0]);
    if (first) first.scrollIntoView({ block: 'start' });
  }, selectors);
  await page.waitForTimeout(50);

  const { cropBottom, btnBottom } = await page.evaluate(({ sels, id }) => {
    let maxBottom = 0;
    sels.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom);
    });
    const btn = document.getElementById(id);
    return { cropBottom: maxBottom, btnBottom: btn ? btn.getBoundingClientRect().bottom : 0 };
  }, { sels: selectors, id: btnId });

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
  const palettePath = path.join(path.dirname(outPath), '.flip-gif-palette.png');

  // -ss/-t placed BEFORE their -i (fast/keyframe seeking): output-style
  // (post -i) seeking is more frame-accurate in principle, but combined
  // with palettegen's -update 1 it reliably produces zero output frames
  // with this ffmpeg build (tested directly — not just theoretical), so
  // this uses the same seek style for both passes. main() anchors
  // startOffsetSec off the video's actual probed length rather than
  // wall-clock timestamps, which is the precision that actually matters
  // here; keyframe-snap can shift the window by a fraction of a second,
  // which is immaterial next to the multi-second hold at the end.
  execFileSync('ffmpeg', [
    '-y', '-ss', String(startOffsetSec), '-t', String(durationSec), '-i', webmPath,
    '-vf', `${cropFilter}fps=${fps},scale=${gifWidth}:-1:flags=lanczos,palettegen=stats_mode=diff`,
    '-update', '1', palettePath
  ], { stdio: 'inherit' });

  execFileSync('ffmpeg', [
    '-y', '-ss', String(startOffsetSec), '-t', String(durationSec), '-i', webmPath, '-i', palettePath,
    '-lavfi', `${cropFilter}fps=${fps},scale=${gifWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    outPath
  ], { stdio: 'inherit' });

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
    await scrollCaptureRegionIntoView(page, args.include, btnId, args.viewportHeight);
  }
  await page.waitForTimeout(300); // let the page's own initial-draw transitions / reflow / scroll above finish (native speed - see below)

  // Stretched only now, after the initial draw above has already settled at
  // native speed, so it applies to just the recorded flip transition.
  if (args.transitionMs > 0) await slowTransitions(page, args.transitionMs);

  const preRollStart = Date.now();
  await page.waitForTimeout(args.preRollMs);
  console.log(`Clicking #${btnId} ...`);
  await page.click(`#${btnId}`);
  const clickSettleMs = (args.transitionMs > 0 ? args.transitionMs : 360) + 200; // 200ms buffer past the transition's own duration
  await page.waitForTimeout(clickSettleMs + args.holdMs);

  const cropRect = args.crop ? await computeCropRect(page, args.include) : null;
  const captureEnd = Date.now();

  const video = page.video();
  await context.close();
  await browser.close();

  const webmPath = await video.path();
  // Anchored off the video's own actual length (via ffprobe) rather than
  // wall-clock deltas from page-load time: browser-launch/context-creation
  // overhead happens before any Node timestamp we could capture here, so a
  // (preRollStart - t0)-style offset systematically undercounts how far
  // into the video our capture window really starts, front-loading the
  // GIF with stale pre-scroll/pre-load frames. The recorded window's own
  // *length* (captureEnd - preRollStart) is still reliable, since both
  // timestamps come from this same process with no such gap between them.
  const windowLenSec = (captureEnd - preRollStart) / 1000 + 0.4; // small lead+trail pad
  const totalDurationSec = probeDurationSec(webmPath);
  const startOffsetSec = Math.max(0, totalDurationSec - windowLenSec);
  const durationSec = totalDurationSec - startOffsetSec;

  fs.mkdirSync(args.outDir, { recursive: true });
  const outPath = path.join(args.outDir, args.out);
  console.log(`Converting to GIF (${startOffsetSec.toFixed(2)}s - ${(startOffsetSec + durationSec).toFixed(2)}s) ...`);
  convertToGif({ webmPath, startOffsetSec, durationSec, cropRect, gifWidth: args.gifWidth, fps: args.fps, outPath });

  fs.rmSync(videoDir, { recursive: true, force: true });
  console.log(`Wrote ${path.resolve(outPath)}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
