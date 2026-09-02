'use strict';

let flipByYear = new Map();
let metricsByYear = new Map();
let totalEvByYear = new Map();
let activeFlip = null;
let applyingFlip = false;
let updateAllFn = () => {};
let updateUrlFn = () => {};
let applyFlipPreDimFn = () => 0;

function syncWindowState() {
    if (typeof window === 'undefined') return;
    window._flipByYear = flipByYear;
    window._metricsByYear = metricsByYear;
    window._totalEvByYear = totalEvByYear;
    window._activeFlip = activeFlip;
    window._applyingFlip = applyingFlip;
}

function setActiveFlip(next) {
    activeFlip = next || null;
    if (typeof window !== 'undefined') {
        window._activeFlip = activeFlip;
    }
}

function setApplyingFlip(flag) {
    applyingFlip = !!flag;
    if (typeof window !== 'undefined') {
        window._applyingFlip = applyingFlip;
    }
}

export function setFlipDependencies(deps = {}) {
    if (typeof deps.updateAll === 'function') updateAllFn = deps.updateAll;
    if (typeof deps.updateUrl === 'function') updateUrlFn = deps.updateUrl;
    if (typeof deps.applyFlipPreDim === 'function') applyFlipPreDimFn = deps.applyFlipPreDim;
}

export function buildFlipScenarioMaps(flipDetails, flipResults) {
    flipByYear = new Map();
    metricsByYear = new Map();
    totalEvByYear = new Map();

    const groupFD = new Map();
    (flipDetails || []).forEach(r => {
        const y = +r.year;
        const mode = String(r.mode || '').toLowerCase();
        const metric = (r.metric && String(r.metric).toLowerCase()) || 'votes';
        if (!y || !mode) return;
        const key = `${y}:${metric}:${mode}`;
        const arr = groupFD.get(key) || [];
        arr.push({
            unit: r.abbr,
            ev: +r.ev || 0,
            votes_to_flip: +r.votes_to_flip || 0,
            pct_of_state_votes: +r.pct_of_state_votes || 0
        });
        groupFD.set(key, arr);
    });
    groupFD.forEach(arr => arr.sort((a, b) => (a.votes_to_flip || 0) - (b.votes_to_flip || 0)));

    const modes = ['classic', 'no_majority', 'tie'];
    const years = new Set((flipDetails || []).map(r => +r.year).filter(Boolean));
    years.forEach(y => {
        if (!flipByYear.has(y)) flipByYear.set(y, new Map());
        const byMetric = flipByYear.get(y);
        const metricsForYear = new Set();
        groupFD.forEach((_, key) => {
            const [ky, metric] = key.split(':');
            if (+ky === +y) metricsForYear.add(metric);
        });
        if (metricsForYear.size === 0) metricsForYear.add('votes');
        metricsForYear.forEach(metric => {
            const data = {};
            modes.forEach(m => { data[m] = groupFD.get(`${y}:${metric}:${m}`) || []; });
            byMetric.set(metric, data);
        });
    });

    (flipResults || []).forEach(r => {
        const y = +r.year;
        const tot = +r.total_ev || 0;
        if (y && isFinite(tot) && tot > 0) totalEvByYear.set(y, tot);
        if (!y) return;
        const metric = (r.metric && String(r.metric).toLowerCase()) || 'votes';
        if (!metricsByYear.has(y)) metricsByYear.set(y, new Set());
        metricsByYear.get(y).add(metric);
    });

    syncWindowState();
    return {
        flipByYear,
        metricsByYear,
        totalEvByYear
    };
}

export function getCurrentMetric() {
    const sel = document.getElementById('flipMetric');
    const val = sel ? String(sel.value || 'votes').toLowerCase() : 'votes';
    return (val === 'margin') ? 'margin' : 'votes';
}

export function updateFlipMetricOptionsForYear() {
    try {
        const yearEl = document.getElementById('yearSlider');
        const sel = document.getElementById('flipMetric');
        if (!yearEl || !sel) return;
        const y = +yearEl.value;
        const avail = (metricsByYear.get(y)) || new Set(['votes']);
        Array.from(sel.options).forEach(opt => {
            const m = String(opt.value || '').toLowerCase();
            opt.disabled = !avail.has(m);
        });
        const cur = String(sel.value || '').toLowerCase();
        if (!avail.has(cur)) {
            sel.value = avail.has('votes') ? 'votes' : Array.from(avail)[0] || 'votes';
        }
    } catch (e) { /* ignore */ }
}

export function getFlipScenariosForYearMetric(y) {
    const byMetric = flipByYear.get(y);
    const metric = getCurrentMetric();
    if (!byMetric) return null;
    if (typeof byMetric.get !== 'function') return byMetric;
    return byMetric.get(metric) || byMetric.get('votes') || null;
}

export function updateFlipButtons() {
    try {
        const yearEl = document.getElementById('yearSlider');
        const y = yearEl ? +yearEl.value : null;
        const btnClassic = document.getElementById('flipClassic');
        const btnNoMaj = document.getElementById('flipNoMaj');
        const btnTie = document.getElementById('flipTie');
        if (!btnNoMaj) return;
        const yearSc = (y != null) ? getFlipScenariosForYearMetric(y) : null;
        if (!yearSc || !yearSc.classic || !yearSc.no_majority) {
            btnNoMaj.style.display = '';
        } else {
            const a = (yearSc.classic || []).map(r => r.unit).join('|');
            const b = (yearSc.no_majority || []).map(r => r.unit).join('|');
            btnNoMaj.style.display = (a === b) ? 'none' : '';
        }
        if (btnTie) {
            if (!yearSc || !Array.isArray(yearSc.tie) || yearSc.tie.length === 0) {
                btnTie.style.display = 'none';
            } else {
                const sortUnits = (arr) => (arr || []).map(r => String(r.unit || r).trim()).filter(Boolean).sort().join('|');
                const tieUnits = sortUnits(yearSc.tie);
                const noMajUnits = sortUnits(yearSc.no_majority);
                btnTie.style.display = (tieUnits === '' || tieUnits === noMajUnits) ? 'none' : '';
            }
        }
        const active = (activeFlip && activeFlip.year === y) ? activeFlip.mode : null;
        [btnClassic, btnNoMaj, btnTie].forEach(b => {
            if (!b) return;
            const id = b.id || '';
            const should = (id === 'flipClassic' && active === 'classic') ||
                (id === 'flipNoMaj' && active === 'no_majority') ||
                (id === 'flipTie' && active === 'tie');
            if (should) b.classList.add('active'); else b.classList.remove('active');
        });
    } catch (e) { /* ignore */ }
}

export function isUnitFlipped(year, unit) {
    const f = activeFlip;
    if (!f || f.year !== year) return false;
    if (year === 1876 && (unit === 'CO' || unit === 'CO-AL')) return false;
    let key = unit;
    if (key === 'ME' || key === 'NE') key = key + '-AL';
    return !!(f._set && f._set.has(key));
}

export function clearFlips() {
    setActiveFlip(null);
    const wrap = document.getElementById('flipDetailsWrap'); if (wrap) wrap.style.display = 'none';
    const t = document.getElementById('flipDetails'); if (t) t.innerHTML = '';
    const votes = document.getElementById('flipVotes'); if (votes) votes.textContent = '0';
    const cnt = document.getElementById('flipCount'); if (cnt) cnt.textContent = '0';
    const pct = document.getElementById('flipVotesPct'); if (pct) pct.textContent = '0%';
    try {
        const yearEl = document.getElementById('yearSlider');
        const pvEl = document.getElementById('pvSlider');
        if (yearEl && pvEl) {
            const year = parseInt(yearEl.value, 10);
            const pvIndex = parseInt(pvEl.value, 10);
            if (typeof updateUrlFn === 'function') updateUrlFn(year, pvIndex, null);
        }
    } catch (e) { /* ignore */ }
    updateFlipButtons();
}

export async function applyFlip(mode) {
    console.log('applyFlip', mode);
    try {
        setApplyingFlip(true);
        const propEvToggle = document.getElementById('propEvToggle');
        if (propEvToggle && propEvToggle.checked) {
            propEvToggle.checked = false;
            console.log('applyFlip: disabled proportional EV mode for flip scenario');
        }
        const yearEl = document.getElementById('yearSlider');
        const year = +yearEl.value;
        const by = getFlipScenariosForYearMetric(year);
        if (!by) { console.log('applyFlip: no scenarios for year', year); return; }
        const rows = by[mode] || [];
        const curMetric = getCurrentMetric();
        if (activeFlip && activeFlip.year === year && activeFlip.mode === mode && activeFlip.metric === curMetric) {
            clearFlips();
            try { updateAllFn(); updateFlipButtons(); } catch (e) { }
            return;
        }
        try {
            const stopsNow = (window._stopsByYear) ? (window._stopsByYear.get(year) || [0]) : [0];
            const natNow = window._getNatMargin ? window._getNatMargin(year) : 0;
            const stopEps = window._STOP_EPS || 0.00005;
            let idx = stopsNow.findIndex(v => Math.abs(v - natNow) <= stopEps);
            if (idx < 0) idx = stopsNow.findIndex(v => Math.abs(v) <= stopEps);
            if (idx < 0) idx = 0;
            const pvEl = document.getElementById('pvSlider');
            if (pvEl) {
                pvEl.value = String(idx);
                console.log('applyFlip: set PV slider to actual stop', { idx, natNow, stopsLength: stopsNow.length });
            }
        } catch (e) {
            console.error('applyFlip: error setting PV to actual:', e);
        }
        const set = new Set(rows.map(r => r.unit));
        const votesSum = rows.reduce((s, r) => s + (r.votes_to_flip || 0), 0);
        const next = { year, mode, metric: curMetric, units: rows, votesSum, _set: set };
        setActiveFlip(next);
        console.log('applyFlip set state', { units: rows.map(r => r.unit).slice(0, 8), votesSum });
        renderFlipDetails();

        const dimMs = applyFlipPreDimFn(year);
        if (dimMs > 0) {
            await new Promise(resolve => setTimeout(resolve, dimMs + 30));
        }

        updateAllFn();
        const pvEl = document.getElementById('pvSlider');
        if (pvEl && typeof updateUrlFn === 'function') {
            updateUrlFn(year, parseInt(pvEl.value, 10), mode);
        }
        updateFlipButtons();
    } catch (e) {
        console.error('applyFlip error:', e);
    } finally {
        setApplyingFlip(false);
    }
}

export function renderFlipDetails() {
    try {
        const f = activeFlip; if (!f) return;
        const wrap = document.getElementById('flipDetailsWrap'); if (wrap) wrap.style.display = '';
        const title = document.getElementById('flipDetailsTitle');
        if (title) {
            const m = (f.metric === 'margin') ? 'min margin' : 'min votes';
            title.textContent = `Applied flips (optimize: ${m})`;
        }
        const t = document.getElementById('flipDetails'); if (!t) return;
        const year = f.year;
        const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : [];
        const byUnit = new Map(); rows.forEach(r => byUnit.set(r.unit, r));
        let html = '';
        f.units.forEach(u => {
            const unit = u.unit;
            const row = byUnit.get(unit);
            if (!row) return;
            const ev = +u.ev || +row.ev || 0;
            const d0 = +row.dVotes || 0;
            const r0 = +row.rVotes || 0;
            const vt = Math.max(0, +u.votes_to_flip || 0);
            let d1 = d0;
            let r1 = r0;
            if (d0 >= r0) {
                d1 = Math.max(0, d0 - vt);
                r1 = r0 + vt;
            } else {
                d1 = d0 + vt;
                r1 = Math.max(0, r0 - vt);
            }
            html += `<tr><td>${unit}</td><td>${ev}</td><td>${d0.toLocaleString('en-US')}<br/>→ ${d1.toLocaleString('en-US')}</td>` +
                `<td>${r0.toLocaleString('en-US')}<br/>→ ${r1.toLocaleString('en-US')}</td><td>${(+u.votes_to_flip || 0).toLocaleString('en-US')} (${+u.pct_of_state_votes || 0}%)</td></tr>`;
        });
        t.innerHTML = html;
        const votes = document.getElementById('flipVotes'); if (votes) votes.textContent = (f.votesSum || 0).toLocaleString('en-US');
        const cnt = document.getElementById('flipCount'); if (cnt) cnt.textContent = String(f.units.length);
        const pctEl = document.getElementById('flipVotesPct');
        if (pctEl) {
            const rowsForYear = rows || [];
            const natRow = rowsForYear.find(rr => rr && (rr.unit === 'NATIONAL' || rr.unit === 'NAT'));
            const total = natRow ? (+natRow.total || (+natRow.dVotes + +natRow.rVotes + +natRow.tVotes) || 0) : 0;
            let pct = (total > 0) ? ((f.votesSum || 0) / total * 100) : 0;
            let txt = '0%';
            if (isFinite(pct) && total > 0) {
                if (Math.abs(pct) < 0.01) txt = pct.toExponential(2) + '%';
                else txt = pct.toFixed(4) + '%';
            }
            pctEl.textContent = txt;
        }
    } catch (e) { /* ignore */ }
}

export function getActiveFlip() {
    return activeFlip;
}

syncWindowState();

try { window.getCurrentMetric = getCurrentMetric; } catch (e) { }
try { window.updateFlipMetricOptionsForYear = updateFlipMetricOptionsForYear; } catch (e) { }
try { window.getFlipScenariosForYearMetric = getFlipScenariosForYearMetric; } catch (e) { }
try { window.updateFlipButtons = updateFlipButtons; } catch (e) { }
try { window.isUnitFlipped = isUnitFlipped; } catch (e) { }
try { window.clearFlips = clearFlips; } catch (e) { }
try { window.applyFlip = applyFlip; } catch (e) { }
try { window.renderFlipDetails = renderFlipDetails; } catch (e) { }
try { window.buildFlipScenarioMaps = buildFlipScenarioMaps; } catch (e) { }
try { window.setFlipDependencies = setFlipDependencies; } catch (e) { }
