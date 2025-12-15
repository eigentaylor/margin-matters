(function () {
/**
 * PROBABILITIES MODEL
 * ====================
 * 
 * Each state's 2028 margin is modeled as:
 *   margin_2028[s] = relative_margin_2024[s] + national_swing + delta[s]
 * 
 * Where:
 *   - relative_margin_2024[s] is known (from 2024 results)
 *   - national_swing is unknown, shared by all states
 *   - delta[s] is a state-specific deviation from national swing
 * 
 * We model (national_swing, delta[1], ..., delta[N]) as a multivariate Gaussian.
 * 
 * When user says "Georgia goes blue", that means:
 *   margin_2028[GA] > 0  =>  national_swing + delta[GA] > -relative_margin_2024[GA]
 * 
 * This is an INEQUALITY constraint, not a point observation.
 * We use rejection sampling: draw from the prior, reject samples that violate constraints.
 * Probabilities are computed from the remaining valid samples.
 * 
 * Locking: If a state has P(blue) = 0 or P(blue) = 1 given constraints, it is locked.
 */

const COLORS = {
demSafe: '#4169E1',
demLean: '#87CEFA',
repSafe: '#B22222',
repLean: '#CD5C5C',
tossup: '#888888',
locked: '#333333'
};

const STATE_NAMES = {
AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia'
};

// Probability thresholds for coloring
let autoLeanThreshold = 0.70; // P(Dem) >= 70% => Lean D
const LOCK_THRESHOLD = 0.995; // P(Dem) >= 99.5% or P(Dem) <= 0.5% => locked

// State storage
const stateStore = new Map();
const unitStore = new Map();
const MODEL_UNITS = [];
let TOTAL_EV = 0;

// Constraints from manual picks: list of { id, direction: 'dem' | 'rep' }
// 'dem' means margin > 0, 'rep' means margin < 0
const constraints = [];

// Bayesian model
const BAYES = {
ready: false,
VAR_UNITS: [],   // List of unit IDs
IDX: new Map(),  // unit ID -> index in mu/Sigma (0 = national)
mu: [],          // Prior mean vector [national, delta_1, ..., delta_N]
Sigma: [],       // Prior covariance matrix
r2024: new Map(), // unit ID -> 2024 relative margin
EV: new Map(),   // unit ID -> electoral votes
};

// ===== Utility functions =====

function formatNumber(x) {
if (x == null || !isFinite(x)) return '0';
return Math.round(x).toLocaleString('en-US');
}

function formatPercent(x) {
if (!isFinite(x)) return '0%';
return (x * 100).toFixed(1) + '%';
}

function formatMargin(x) {
if (!isFinite(x)) return '';
if (Math.abs(x) < 1e-4) return 'EVEN';
const pct = (Math.abs(x) * 100).toFixed(1);
return (x > 0 ? 'D+' : 'R+') + pct;
}

function setText(id, value) {
const el = document.getElementById(id);
if (el) el.textContent = value;
}

// ===== Color functions =====

function colorForUnit(unit) {
if (!unit) return '#2f2f2f';
if (unit.locked) return unit.lockedStatus === 'dem' ? COLORS.demSafe : COLORS.repSafe;
if (unit.status === 'tossup') return COLORS.tossup;
if (unit.status === 'dem') return unit.strength === 'safe' ? COLORS.demSafe : COLORS.demLean;
return unit.strength === 'safe' ? COLORS.repSafe : COLORS.repLean;
}

function updateUnitColor(id) {
const unit = unitStore.get(id);
if (unit && window.ElectionMap) {
if (id.includes('-')) {
window.ElectionMap.setDistrictFill(id, colorForUnit(unit));
} else {
window.ElectionMap.setStateFill(id, colorForUnit(unit));
}
}
}

function updateAllColors() {
MODEL_UNITS.forEach(id => updateUnitColor(id));
stateStore.forEach((state, code) => {
if (window.ElectionMap) {
window.ElectionMap.setStateFill(code, colorForUnit(state));
}
});
}

// ===== Classification =====

function categorizeProbability(pDem, isLocked = false, lockedStatus = null) {
if (isLocked) {
return { status: lockedStatus, strength: 'safe' };
}
if (!isFinite(pDem)) return { status: 'tossup', strength: 'tossup' };
const lean = autoLeanThreshold;
const safe = Math.min(0.95, lean + 0.18);
if (pDem >= safe) return { status: 'dem', strength: 'safe' };
if (pDem >= lean) return { status: 'dem', strength: 'lean' };
if (pDem <= 1 - safe) return { status: 'rep', strength: 'safe' };
if (pDem <= 1 - lean) return { status: 'rep', strength: 'lean' };
return { status: 'tossup', strength: 'tossup' };
}

// ===== Data loading =====

function buildStateData(rows2024) {
stateStore.clear();
unitStore.clear();
MODEL_UNITS.length = 0;
TOTAL_EV = 0;
BAYES.EV.clear();
BAYES.r2024.clear();

const districtStates = new Set();
(rows2024 || []).forEach(row => {
if (!row || !row.abbr) return;
if (row.abbr.includes('-')) districtStates.add(row.abbr.slice(0, 2));
});

const byState = new Map();
(rows2024 || []).forEach(row => {
if (!row || !row.abbr || row.abbr === 'NATIONAL') return;
const unit = row.abbr.trim();
if (!unit) return;
// Skip aggregate row when districts exist
if (!unit.includes('-') && districtStates.has(unit)) return;
const stateCode = unit.slice(0, 2);
const ev = parseInt(row.ev || row.electoral_votes || row.electoral_Votes, 10);
if (!isFinite(ev) || ev <= 0) return;
const margin = parseFloat(row.margin != null ? row.margin : row.relative_margin);
if (!byState.has(stateCode)) byState.set(stateCode, { state: stateCode, units: [], evTotal: 0, weightedMargin: 0 });
const entry = byState.get(stateCode);
entry.units.push({ unit, ev, margin });
entry.evTotal += ev;
if (isFinite(margin)) entry.weightedMargin += margin * ev;

unitStore.set(unit, {
unit,
state: stateCode,
ev,
margin: isFinite(margin) ? margin : 0,
status: 'tossup',
strength: 'tossup',
manual: false,
locked: false,
lockedStatus: null,
lastProb: 0.5
});
BAYES.EV.set(unit, ev);
BAYES.r2024.set(unit, isFinite(margin) ? margin : 0);
});

byState.forEach(entry => {
const totalEv = entry.evTotal || 0;
TOTAL_EV += totalEv;
const margin = totalEv > 0 ? (entry.weightedMargin / totalEv) : 0;
entry.units.sort((a, b) => a.unit.localeCompare(b.unit));
stateStore.set(entry.state, {
state: entry.state,
ev: totalEv,
margin,
units: entry.units,
status: 'tossup',
strength: 'tossup',
manual: false,
locked: false,
lockedStatus: null,
lastProb: 0.5
});
});

MODEL_UNITS.push(...Array.from(unitStore.keys()).sort());
}
// ===== Prior construction =====

function buildBayesPrior(tsById) {
const VAR_UNITS = MODEL_UNITS.slice();
const deltasById = new Map();

// Compute cycle-to-cycle changes for each unit
VAR_UNITS.forEach(id => {
const arr = tsById.get(id) || [];
const deltas = [];
for (let i = 1; i < arr.length; i++) {
const curr = arr[i];
const prev = arr[i - 1];
if (isFinite(curr) && isFinite(prev)) deltas.push(curr - prev);
}
deltasById.set(id, deltas);
});

// Compute national swing for each cycle (median of state deltas)
let cycles = Infinity;
VAR_UNITS.forEach(id => {
const arr = deltasById.get(id) || [];
if (arr.length < cycles) cycles = arr.length;
});
if (!cycles || cycles < 1) cycles = 1;

const natSwing = new Array(cycles).fill(0);
for (let t = 0; t < cycles; t++) {
const vals = [];
VAR_UNITS.forEach(id => {
const arr = deltasById.get(id);
if (arr && isFinite(arr[t])) vals.push(arr[t]);
});
if (vals.length) {
vals.sort((a, b) => a - b);
const mid = vals.length >> 1;
natSwing[t] = vals.length % 2 ? vals[mid] : 0.5 * (vals[mid - 1] + vals[mid]);
}
}

// Compute variance of national swing
const meanNat = natSwing.reduce((a, b) => a + b, 0) / natSwing.length;
const varNat = natSwing.reduce((a, b) => a + (b - meanNat) ** 2, 0) / Math.max(1, natSwing.length - 1);
const sigmaNat = Math.sqrt(Math.max(1e-5, varNat || 0.0004)); // ~2% typical

// Compute state residual variance (delta variance after removing national swing)
const sigmaState = new Map();
VAR_UNITS.forEach(id => {
const deltas = deltasById.get(id) || [];
let sum = 0, count = 0;
for (let t = 0; t < Math.min(cycles, deltas.length); t++) {
const resid = deltas[t] - natSwing[t];
if (isFinite(resid)) {
sum += resid * resid;
count++;
}
}
const varResid = count > 1 ? (sum / (count - 1)) : 0.0009; // ~3% default
sigmaState.set(id, Math.sqrt(Math.max(0.0001, varResid)));
});

// Build covariance matrix
// Structure: [national, delta_1, delta_2, ..., delta_N]
// Cov(national, national) = sigmaNat^2
// Cov(delta_i, delta_i) = sigmaState_i^2
// Cov(national, delta_i) = 0 (independent)
const D = 1 + VAR_UNITS.length;
const Sigma = Array.from({ length: D }, () => Array(D).fill(0));
Sigma[0][0] = sigmaNat * sigmaNat;
for (let i = 0; i < VAR_UNITS.length; i++) {
const idxI = 1 + i;
const sigmaI = sigmaState.get(VAR_UNITS[i]) || 0.02;
Sigma[idxI][idxI] = sigmaI * sigmaI;
}

const mu = new Array(D).fill(0); // Prior mean is 0 (no expected change)

BAYES.ready = true;
BAYES.VAR_UNITS = VAR_UNITS;
const idxMap = new Map();
idxMap.set('NAT', 0);
VAR_UNITS.forEach((id, i) => idxMap.set(id, 1 + i));
BAYES.IDX = idxMap;
BAYES.mu = mu;
BAYES.Sigma = Sigma;

console.log('[BAYES] Built prior with sigmaNat =', sigmaNat.toFixed(4));
}

// ===== Random number generation =====

function drawZ() {
let u = 0, v = 0;
while (u === 0) u = Math.random();
while (v === 0) v = Math.random();
return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function choleskyDecomposition(matrix) {
const n = matrix.length;
const L = Array.from({ length: n }, () => Array(n).fill(0));
for (let i = 0; i < n; i++) {
for (let j = 0; j <= i; j++) {
let sum = matrix[i][j];
for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
if (i === j) {
if (sum <= 1e-12) return null;
L[i][j] = Math.sqrt(sum);
} else {
L[i][j] = sum / L[j][j];
}
}
}
return L;
}

function choleskyWithJitter(matrix) {
let jitter = 1e-6;
for (let attempt = 0; attempt < 5; attempt++) {
const adjusted = matrix.map((row, i) => row.map((val, j) => i === j ? val + jitter : val));
const L = choleskyDecomposition(adjusted);
if (L) return L;
jitter *= 10;
}
return null;
}
// ===== Simulation with constraint rejection =====

function runConstrainedSimulation(numSamples, maxAttempts = null) {
if (!BAYES.ready) return null;

const L = choleskyWithJitter(BAYES.Sigma);
if (!L) {
console.error('[BAYES] Cholesky decomposition failed');
return null;
}

const dim = BAYES.mu.length;
const validSamples = [];
let attempts = 0;
const maxTotal = maxAttempts || numSamples * 100;

// Build constraint list: { id, threshold, direction }
// direction: 'gt' means margin > 0, 'lt' means margin < 0
const constraintSpecs = constraints.map(c => {
const base = BAYES.r2024.get(c.id) || 0;
const idx = BAYES.IDX.get(c.id);
// margin = base + national + delta > 0 for dem
// margin = base + national + delta < 0 for rep
return {
id: c.id,
idx,
base,
direction: c.direction // 'dem' or 'rep'
};
});

while (validSamples.length < numSamples && attempts < maxTotal) {
attempts++;

// Draw from prior
const z = new Array(dim).fill(0).map(() => drawZ());
const draw = new Array(dim).fill(0);
for (let i = 0; i < dim; i++) {
let sum = 0;
for (let k = 0; k <= i; k++) sum += L[i][k] * z[k];
draw[i] = BAYES.mu[i] + sum;
}

// Check all constraints
let valid = true;
for (const c of constraintSpecs) {
if (c.idx == null) continue;
const national = draw[0];
const delta = draw[c.idx];
const margin = c.base + national + delta;
if (c.direction === 'dem' && margin <= 0) {
valid = false;
break;
}
if (c.direction === 'rep' && margin >= 0) {
valid = false;
break;
}
}

if (valid) {
validSamples.push(draw);
}
}

if (validSamples.length === 0) {
console.warn('[BAYES] No valid samples found with constraints - constraints may be impossible');
return null;
}

console.log('[BAYES] Got ' + validSamples.length + ' valid samples from ' + attempts + ' attempts (' + (100 * validSamples.length / attempts).toFixed(1) + '% acceptance)');

// Compute statistics from valid samples
let demEVSum = 0;
let natSum = 0;
let natSqSum = 0;
let demWins = 0, repWins = 0, ties = 0;
const perUnit = new Map();
MODEL_UNITS.forEach(id => perUnit.set(id, { dem: 0, total: 0 }));

for (const draw of validSamples) {
const nat = draw[0];
natSum += nat;
natSqSum += nat * nat;

let demEV = 0;
MODEL_UNITS.forEach(id => {
const idx = BAYES.IDX.get(id);
const delta = idx != null ? draw[idx] : 0;
const base = BAYES.r2024.get(id) || 0;
const ev = BAYES.EV.get(id) || 0;
const margin = base + nat + delta;
const demWinsUnit = margin > 0;
const entry = perUnit.get(id);
if (demWinsUnit) {
demEV += ev;
entry.dem++;
}
entry.total++;
});

demEVSum += demEV;
const repEV = TOTAL_EV - demEV;
if (demEV >= 270 && repEV < 270) demWins++;
else if (repEV >= 270 && demEV < 270) repWins++;
else if (demEV === 269 && repEV === 269) ties++;
else if (demEV > repEV) demWins++;
else if (repEV > demEV) repWins++;
else ties++;
}

const n = validSamples.length;
const natMean = natSum / n;
const natVar = Math.max(0, (natSqSum / n) - natMean * natMean);

return {
samples: n,
attempts,
acceptanceRate: n / attempts,
demEVMean: demEVSum / n,
repEVMean: TOTAL_EV - (demEVSum / n),
demWins,
repWins,
ties,
perUnit,
natMean,
natStd: Math.sqrt(natVar)
};
}
// ===== Apply results and lock states =====

function applySimulationResults(sim) {
if (!sim) return;

// Update unit probabilities and detect locks
sim.perUnit.forEach((counts, id) => {
const pDem = counts.total ? counts.dem / counts.total : 0.5;
const unit = unitStore.get(id);
if (unit) {
unit.lastProb = pDem;

// Check if locked due to impossibility
if (pDem >= LOCK_THRESHOLD) {
unit.locked = true;
unit.lockedStatus = 'dem';
} else if (pDem <= 1 - LOCK_THRESHOLD) {
unit.locked = true;
unit.lockedStatus = 'rep';
} else {
// Only unlock if not manually set
if (!unit.manual) {
unit.locked = false;
unit.lockedStatus = null;
}
}

// Update display status
if (!unit.manual) {
const cat = categorizeProbability(pDem, unit.locked, unit.lockedStatus);
unit.status = cat.status;
unit.strength = cat.strength;
}
updateUnitColor(id);
}
});

// Update state-level aggregates
stateStore.forEach(state => {
let p = 0.5;
let evTotal = 0;
if (state.units && state.units.length) {
let weighted = 0;
state.units.forEach(ref => {
const unit = unitStore.get(ref.unit);
const prob = unit ? unit.lastProb : 0.5;
weighted += prob * (unit ? unit.ev : ref.ev || 0);
evTotal += unit ? unit.ev : (ref.ev || 0);
});
p = evTotal ? weighted / evTotal : 0.5;
}
state.lastProb = p;

if (p >= LOCK_THRESHOLD) {
state.locked = true;
state.lockedStatus = 'dem';
} else if (p <= 1 - LOCK_THRESHOLD) {
state.locked = true;
state.lockedStatus = 'rep';
} else if (!state.manual) {
state.locked = false;
state.lockedStatus = null;
}

if (!state.manual) {
const cat = categorizeProbability(p, state.locked, state.lockedStatus);
state.status = cat.status;
state.strength = cat.strength;
}
});

refreshDecorations();
}

function updateSummaries(sim) {
if (!sim) return;
setText('expDemEV', formatNumber(sim.demEVMean));
setText('expGopEV', formatNumber(sim.repEVMean));
const demWinPct = sim.samples ? sim.demWins / sim.samples : 0;
const repWinPct = sim.samples ? sim.repWins / sim.samples : 0;
const tiePct = sim.samples ? sim.ties / sim.samples : 0;
setText('probDemWin', formatPercent(demWinPct));
setText('probGopWin', formatPercent(repWinPct));
setText('probTie', formatPercent(tiePct));
setText('natMean', formatMargin(sim.natMean));
const range68Low = sim.natMean - sim.natStd;
const range68High = sim.natMean + sim.natStd;
const range95Low = sim.natMean - 1.96 * sim.natStd;
const range95High = sim.natMean + 1.96 * sim.natStd;
setText('natRange68', formatMargin(range68Low) + ' - ' + formatMargin(range68High));
setText('natRange95', formatMargin(range95Low) + ' - ' + formatMargin(range95High));
}

function updateBuckets() {
const totals = { safeD: 0, leanD: 0, toss: 0, leanR: 0, safeR: 0 };
const counts = { safeD: 0, leanD: 0, toss: 0, leanR: 0, safeR: 0 };
MODEL_UNITS.forEach(id => {
const obj = unitStore.get(id);
if (!obj) return;
const ev = obj.ev || 0;
if (obj.status === 'dem' && obj.strength === 'safe') { totals.safeD += ev; counts.safeD++; }
else if (obj.status === 'dem' && obj.strength === 'lean') { totals.leanD += ev; counts.leanD++; }
else if (obj.status === 'rep' && obj.strength === 'safe') { totals.safeR += ev; counts.safeR++; }
else if (obj.status === 'rep' && obj.strength === 'lean') { totals.leanR += ev; counts.leanR++; }
else { totals.toss += ev; counts.toss++; }
});
setText('bucketSafeD', formatNumber(totals.safeD));
setText('bucketSafeDCount', counts.safeD.toString());
setText('bucketLeanD', formatNumber(totals.leanD));
setText('bucketLeanDCount', counts.leanD.toString());
setText('bucketToss', formatNumber(totals.toss));
setText('bucketTossCount', counts.toss.toString());
setText('bucketLeanR', formatNumber(totals.leanR));
setText('bucketLeanRCount', counts.leanR.toString());
setText('bucketSafeR', formatNumber(totals.safeR));
setText('bucketSafeRCount', counts.safeR.toString());
}

function renderProbabilityTable() {
const tbody = document.getElementById('probTableBody');
if (!tbody) return;
const records = [];
MODEL_UNITS.forEach(id => {
const unit = unitStore.get(id);
if (!unit) return;
const label = unit.unit.endsWith('-AL') ? 'AL' : unit.unit.split('-')[1];
const name = unit.unit.includes('-') ? (STATE_NAMES[unit.state] || unit.state) + ' ' + label : (STATE_NAMES[unit.state] || unit.state);
records.push({
id: unit.unit,
name,
ev: unit.ev,
margin: unit.margin,
prob: unit.lastProb != null ? unit.lastProb : 0.5,
manual: !!unit.manual,
locked: !!unit.locked
});
});

// Sort by closeness to 50%
records.sort((a, b) => {
const da = Math.abs(a.prob - 0.5);
const db = Math.abs(b.prob - 0.5);
if (da !== db) return da - db;
return b.ev - a.ev;
});

tbody.innerHTML = '';
records.slice(0, 20).forEach(rec => {
const tr = document.createElement('tr');
if (rec.locked) tr.style.opacity = '0.7';
const nameCell = document.createElement('td');
nameCell.textContent = rec.name;
const evCell = document.createElement('td');
evCell.textContent = formatNumber(rec.ev);
const marginCell = document.createElement('td');
marginCell.textContent = formatMargin(rec.margin);
const probCell = document.createElement('td');
probCell.textContent = formatPercent(rec.prob);
const manualCell = document.createElement('td');
manualCell.textContent = rec.locked ? '' : (rec.manual ? '' : '');
tr.appendChild(nameCell);
tr.appendChild(evCell);
tr.appendChild(marginCell);
tr.appendChild(probCell);
tr.appendChild(manualCell);
tbody.appendChild(tr);
});
}

// ===== Main recompute =====

function recomputePosterior() {
if (!BAYES.ready) return;

// Run simulation with current constraints
const sim = runConstrainedSimulation(4096);
if (!sim) {
// Constraints are impossible - show warning
console.warn('[BAYES] Constraints produced no valid samples');
// Could show UI warning here
return;
}

applySimulationResults(sim);
updateBuckets();
renderProbabilityTable();
updateSummaries(sim);
refreshDecorations();
}
// ===== Click handlers =====

function handleUnitClick(id, event) {
const unit = unitStore.get(id);
if (!unit) return;

// Don't allow changing locked states (unless shift-click to force reset)
if (unit.locked && !(event && event.shiftKey)) {
console.log('[UI] ' + id + ' is locked as ' + unit.lockedStatus);
return;
}

if (event && event.shiftKey) {
// Reset: remove constraint, clear manual
unit.manual = false;
unit.locked = false;
unit.lockedStatus = null;
// Remove from constraints
const idx = constraints.findIndex(c => c.id === id);
if (idx >= 0) constraints.splice(idx, 1);
console.log('[UI] Reset ' + id);
} else {
// Cycle through: tossup -> dem -> rep -> tossup
const existingIdx = constraints.findIndex(c => c.id === id);
if (existingIdx < 0) {
// Currently tossup, set to dem
constraints.push({ id, direction: 'dem' });
unit.manual = true;
unit.status = 'dem';
unit.strength = 'lean';
console.log('[UI] Set ' + id + ' to Dem');
} else if (constraints[existingIdx].direction === 'dem') {
// Currently dem, set to rep
constraints[existingIdx].direction = 'rep';
unit.status = 'rep';
unit.strength = 'lean';
console.log('[UI] Set ' + id + ' to Rep');
} else {
// Currently rep, reset to tossup
constraints.splice(existingIdx, 1);
unit.manual = false;
unit.status = 'tossup';
unit.strength = 'tossup';
console.log('[UI] Reset ' + id + ' to Tossup');
}
}

updateUnitColor(id);
recomputePosterior();
}

function handleStateClick(code, event) {
const state = stateStore.get(code);
if (!state) return;

// For multi-district states, handle state-level (affects all districts)
if (state.units && state.units.length > 1) {
// Just click the first district for now
const firstUnit = state.units[0].unit;
handleUnitClick(firstUnit, event);
return;
}

// For single-unit states, get the unit
const unitId = state.units && state.units.length === 1 ? state.units[0].unit : code;
handleUnitClick(unitId, event);
}

// ===== Hover handlers =====

function mapTip() { return document.getElementById('mapTip'); }
function mapWrap() { return document.getElementById('map-wrap'); }

function positionTip(evt) {
const tip = mapTip(); if (!tip) return;
const wrap = mapWrap(); if (!wrap) return;
const wrapRect = wrap.getBoundingClientRect();
let x = evt.clientX - wrapRect.left + 12;
let y = evt.clientY - wrapRect.top + 12;
tip.style.display = 'block';
const tipRect = tip.getBoundingClientRect();
x = Math.max(6, Math.min(wrapRect.width - 6 - tipRect.width, x));
y = Math.max(6, Math.min(wrapRect.height - 6 - tipRect.height, y));
tip.style.left = x + 'px';
tip.style.top = y + 'px';
}

function describeStatus(obj) {
if (!obj) return '';
if (obj.locked) return 'Locked ' + (obj.lockedStatus === 'dem' ? 'D' : 'R');
if (obj.status === 'tossup') return 'Toss-up';
const label = obj.strength === 'safe' ? 'Safe' : 'Lean';
const party = obj.status === 'dem' ? 'D' : 'R';
return label + ' ' + party;
}

function handleStateHover(evt, code) {
const state = stateStore.get(code);
if (!state) return;
const tip = mapTip(); if (!tip) return;
const name = STATE_NAMES[state.state] || state.state;
const probStr = formatPercent(state.lastProb);
let text = name + ' - ' + state.ev + ' EV - ' + formatMargin(state.margin) + ' - P(D)=' + probStr + ' - ' + describeStatus(state);
if (state.manual) text += ' - manual';
tip.textContent = text;
tip.style.display = 'block';
positionTip(evt);
}

function handleUnitHover(evt, unitKey) {
const unit = unitStore.get(unitKey);
if (!unit) return;
const tip = mapTip(); if (!tip) return;
const label = unit.unit.endsWith('-AL') ? 'AL' : unit.unit.split('-')[1];
const name = unit.unit.includes('-') ? (STATE_NAMES[unit.state] || unit.state) + ' ' + label : (STATE_NAMES[unit.state] || unit.state);
const probStr = formatPercent(unit.lastProb);
let text = name + ' - ' + unit.ev + ' EV - ' + formatMargin(unit.margin) + ' - P(D)=' + probStr + ' - ' + describeStatus(unit);
if (unit.manual) text += ' - manual';
tip.textContent = text;
tip.style.display = 'block';
positionTip(evt);
}

function hideTip() { const tip = mapTip(); if (tip) tip.style.display = 'none'; }
// ===== Map & decorations =====

function refreshDecorations() {
if (!window.ElectionMap) return;
const evLookup = function(abbr) {
if (unitStore.has(abbr)) return unitStore.get(abbr).ev;
if (stateStore.has(abbr)) return stateStore.get(abbr).ev;
return null;
};
const abbrColors = new Map();
stateStore.forEach(function(st) {
abbrColors.set(st.state, { color: colorForUnit(st) });
});
const unitColors = new Map();
unitStore.forEach(function(u) {
unitColors.set(u.unit, colorForUnit(u));
});
try { window.ElectionMap.refreshDecorations(2028, evLookup, abbrColors, unitColors); } catch (e) { }
}

async function buildMap() {
if (!window.ElectionMap) return;
await window.ElectionMap.build({
svgSelector: '#map',
topoUrl: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json',
districtGeoUrl: 'me_ne_districts.geojson',
stateHandlers: {
click: function(evt, abbr) { handleStateClick(abbr, evt); },
mouseenter: function(evt, abbr) { handleStateHover(evt, abbr); },
mousemove: function(evt) { positionTip(evt); },
mouseleave: function() { hideTip(); }
},
districtHandlers: {
click: function(evt, unit) { handleUnitClick(unit, evt); },
mouseenter: function(evt, unit) { handleUnitHover(evt, unit); },
mousemove: function(evt) { positionTip(evt); },
mouseleave: function() { hideTip(); }
}
});
refreshDecorations();
}

// ===== Controls =====

function initControls() {
const resetBtn = document.getElementById('resetStates');
if (resetBtn) resetBtn.addEventListener('click', function() {
// Clear all constraints
constraints.length = 0;
unitStore.forEach(function(unit) {
unit.manual = false;
unit.locked = false;
unit.lockedStatus = null;
});
stateStore.forEach(function(state) {
state.manual = false;
state.locked = false;
state.lockedStatus = null;
});
recomputePosterior();
});

const clearBtn = document.getElementById('clearManualStates');
if (clearBtn) clearBtn.addEventListener('click', function() {
constraints.length = 0;
unitStore.forEach(function(unit) { unit.manual = false; });
stateStore.forEach(function(state) { state.manual = false; });
recomputePosterior();
});

const thresholdSlider = document.getElementById('autoThreshold');
const thresholdValue = document.getElementById('autoThresholdValue');
if (thresholdSlider && thresholdValue) {
thresholdSlider.addEventListener('input', function() {
const val = parseInt(thresholdSlider.value, 10);
autoLeanThreshold = Math.max(0.5, Math.min(0.9, val / 100));
thresholdValue.textContent = Math.round(autoLeanThreshold * 100) + '%';
recomputePosterior();
});
thresholdValue.textContent = Math.round(autoLeanThreshold * 100) + '%';
}
}

// ===== Initialization =====

async function loadHistoricalAndBuildPrior() {
const needed = new Set(MODEL_UNITS);
const rows = await d3.csv('presidential_margins.csv', function(row) {
const year = +row.year;
if (!row.abbr || row.abbr === 'NATIONAL') return null;
if (year < 2000) return null;
if (!needed.has(row.abbr)) return null;
return {
year: year,
id: row.abbr,
rel: parseFloat(row.relative_margin)
};
});
const tsById = new Map();
rows.forEach(function(r) {
if (!tsById.has(r.id)) tsById.set(r.id, []);
tsById.get(r.id).push({ year: r.year, rel: isFinite(r.rel) ? r.rel : 0 });
});
const aligned = new Map();
tsById.forEach(function(arr, id) {
arr.sort(function(a, b) { return a.year - b.year; });
aligned.set(id, arr.map(function(x) { return x.rel; }));
});
buildBayesPrior(aligned);
}

async function init() {
initControls();
try {
const rows2024 = await d3.csv('presidential_margins.csv', function(row) {
if (+row.year !== 2024) return null;
if (!row.abbr || row.abbr === 'NATIONAL') return null;
return {
abbr: row.abbr,
ev: parseInt(row.electoral_votes || row.electoral_Votes || row.ev, 10),
margin: parseFloat(row.relative_margin)
};
});
buildStateData(rows2024);
await loadHistoricalAndBuildPrior();
await buildMap();
recomputePosterior();
console.log('[INIT] Probabilities page initialized');
} catch (err) {
console.error('[INIT] Failed to initialize:', err);
}
}

document.addEventListener('DOMContentLoaded', init);
})();
