#!/usr/bin/env node
'use strict';

/**
 * Calibration/backtest script for the polling-bias mechanisms added to the 2028
 * sim (fat tails + per-cycle pollTurbulence — see errorModel.js/engine.js).
 *
 * Runs createSimulation() many times with skipForecasts:true (the cheap path —
 * no per-step Monte Carlo, just the truth + campaign) and compares the REALIZED
 * miss between each run's hidden truth and its final ("Election Eve") poll
 * against the empirical cheat-sheet from the research doc this was built from:
 *   national error, good/bad year:  ~2pt / ~4.5pt
 *   state MAE, good/bad year:       ~2.2-2.9pt / ~5.1pt
 *
 * This is a plain Node ESM script (.mjs) — it reads presidential_margins.csv
 * itself rather than going through dataLoader.js, which requires a browser d3
 * global. baseline.js's own field coercion (`+r.year` etc.) means the CSV can be
 * handed in as plain strings; no d3.autoType equivalent is needed.
 *
 * Also runs the same sweep with LEGACY_CALIBRATION applied (the toggle exposed
 * in the UI as "Confident forecasts" — the original, narrower assumptions from
 * before this doc-calibration pass), printed side by side with the new
 * default — the fast, numeric half of "try both and see which feels better,"
 * complementing the interactive UI toggle.
 *
 * Usage: node docs/utils/sim2028/calibrate.mjs [numRuns]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildBaseline } from './baseline.js';
import { createSimulation, PARAMS, LEGACY_CALIBRATION } from './engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', '..', 'presidential_margins.csv');

/** Minimal RFC4180-ish CSV parser — handles quoted fields with embedded commas
 * and doubled quotes (needed for the third_party_results JSON-ish column). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadRows(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const table = parseCsv(text);
  const header = table[0];
  return table.slice(1)
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / (xs.length || 1); }
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Run the sweep once under a given poll/forecast params override (mirrors the
 * merge sim2028.js's startCampaign() does for the "Confident forecasts" toggle:
 * poll spreads flat, forecast is rebuilt per-axis so floorScale can't wipe out
 * startScale). Note: `forecast` here only affects the (skipped) Monte Carlo
 * confidence band, not the truth-vs-poll gap this script measures — the
 * `forecast` override is accepted/threaded through for completeness/parity
 * with the UI toggle, but only the `poll` half (nationalSigma/regionShare)
 * moves these particular numbers. */
async function runSweep(numRuns, baseline, { poll = {}, forecast = {} } = {}) {
  const params = {
    poll: { ...PARAMS.poll, ...poll },
    forecast: {
      rel: { ...PARAMS.forecast.rel, ...(forecast.rel || {}) },
      npv: { ...PARAMS.forecast.npv, ...(forecast.npv || {}) },
    },
  };

  const nationalErrs = [];
  const stateMaes = [];
  const pollTurbulences = [];

  for (let i = 0; i < numRuns; i++) {
    const sim = await createSimulation({
      seed: 1_000_003 * (i + 1),
      baseline,
      skipForecasts: true,
      params,
    });

    const final = sim.snapshots[sim.snapshots.length - 1];
    nationalErrs.push(Math.abs(final.pollNpv - sim.truthNpv) * 100);

    const unitErrs = [];
    for (const unit of baseline.simUnits) {
      const beta = baseline.beta.get(unit) || 1;
      const pollMargin = (final.pollRel.get(unit) || 0) + beta * final.pollNpv;
      const truthMargin = (sim.truthRel.get(unit) || 0) + beta * sim.truthNpv;
      unitErrs.push(Math.abs(pollMargin - truthMargin) * 100);
    }
    stateMaes.push(mean(unitErrs));
    pollTurbulences.push(sim.pollTurbulence);
  }

  return { nationalErrs, stateMaes, pollTurbulences };
}

function report(label, { nationalErrs, stateMaes, pollTurbulences }) {
  console.log(`--- ${label} ---`);
  console.log(`  National error:  mean ${mean(nationalErrs).toFixed(2)}pt   median ${median(nationalErrs).toFixed(2)}pt`);
  console.log(`  State MAE:       mean ${mean(stateMaes).toFixed(2)}pt   median ${median(stateMaes).toFixed(2)}pt`);

  const idx = pollTurbulences.map((_, i) => i).sort((a, b) => pollTurbulences[a] - pollTurbulences[b]);
  const third = Math.floor(idx.length / 3);
  const buckets = [
    ['low (clean, ~2024-style)', idx.slice(0, third)],
    ['mid (typical)', idx.slice(third, 2 * third)],
    ['high (foggy, ~2016/2020-style)', idx.slice(2 * third)],
  ];
  for (const [bucketLabel, indices] of buckets) {
    const nat = mean(indices.map(i => nationalErrs[i]));
    const st = mean(indices.map(i => stateMaes[i]));
    const turb = mean(indices.map(i => pollTurbulences[i]));
    console.log(`    pollTurbulence ${bucketLabel}: ${turb.toFixed(2)}x | national ${nat.toFixed(2)}pt | state MAE ${st.toFixed(2)}pt`);
  }
  console.log('');
}

async function main() {
  const numRuns = parseInt(process.argv[2], 10) || 1500;

  const rows = loadRows(CSV_PATH);
  const baseline = buildBaseline(rows, PARAMS.baseline);

  console.log(`\n=== Calibration over ${numRuns} runs ===`);
  console.log('Doc cheat-sheet: national good/bad ~2/4.5pt | state MAE good/bad ~2.2-2.9/5.1pt\n');

  report('Default (doc-calibrated)', await runSweep(numRuns, baseline));
  report('Confident forecasts (legacy calibration)', await runSweep(numRuns, baseline, LEGACY_CALIBRATION));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
