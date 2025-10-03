(function(){
	const STATUS_SEQUENCE = ['tossup','dem','rep'];
	const COLORS = {
		demSafe: '#4169E1',
		demLean: '#87CEFA',
		repSafe: '#B22222',
		repLean: '#CD5C5C',
		tossup: '#888888'
	};

	const STATE_NAMES = {
		AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut',
		DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa',
		KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan',
		MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire',
		NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma',
		OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas',
		UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', DC:'District of Columbia'
	};

	const DEFAULT_THRESHOLD = 0.06;
	let tossupBand = DEFAULT_THRESHOLD / 2;
	let autoLeanThreshold = 0.70; // probability threshold for lean classification
	// Locking logic: states whose posterior probability is extremely close to 0 or 1 are locked
	const LOCK_PROB_THRESHOLD = 0.985; // above this (or below 1 - this) treat as effectively certain
	const HARD_LOCK_PROB = 0.997; // stronger styling threshold (future use)

	const stateStore = new Map();
	const unitStore = new Map();
	const statePaths = new Map();
	const MODEL_UNITS = [];
	let TOTAL_EV = 0;

	const OBSERVE_TARGETS = {
		dem: {
			lean: { target: 0.02, sigma: 0.020 },
			safe: { target: 0.06, sigma: 0.010 }
		},
		rep: {
			lean: { target: -0.02, sigma: 0.020 },
			safe: { target: -0.06, sigma: 0.010 }
		}
	};

	const BAYES = {
		ready: false,
		VAR_UNITS: [],
		IDX: new Map(),
		mu: [],
		Sigma: [],
		baseMu: [],
		baseSigma: [],
		r2024: new Map(),
		EV: new Map(),
		sigmaNat: 0,
		salt: 0
	};

	// Diagnostics storage and helpers
	const DIAG = {
		priorMu: null,
		priorSigma: null,
		postMu: null,
		postSigma: null
	};

	function aVectorFor(id){
		const n = BAYES.baseMu.length;
		const a = new Array(n).fill(0);
		if (!BAYES.ready) return a;
		a[0] = 1; // national term
		const idx = BAYES.IDX.get(id);
		if (idx != null) a[idx] = 1;
		return a;
	}

	function quadForm(a, mu, Sigma){
		// returns {mean, var}
		let mean = 0;
		for (let i=0;i<a.length;i++) mean += a[i] * (mu[i] || 0);
		let v = 0;
		for (let i=0;i<a.length;i++){
			let rowDot = 0;
			for (let j=0;j<a.length;j++) rowDot += (Sigma[i] && Sigma[i][j] ? Sigma[i][j] : 0) * a[j];
			v += a[i] * rowDot;
		}
		return { mean, var: v };
	}

	function topCorrelationsWith(id, count){
		count = count || 12;
		if (!BAYES.ready) return [];
		const names = BAYES.VAR_UNITS.slice();
		const results = [];
		const baseSigma = BAYES.baseSigma;
		const idxI = BAYES.IDX.get(id);
		if (idxI == null) return [];
		for (let k=0;k<names.length;k++){
			const jIdx = BAYES.IDX.get(names[k]);
			if (jIdx == null) continue;
			const cov = baseSigma[idxI][jIdx] || 0;
			const varI = baseSigma[idxI][idxI] || 0;
			const varJ = baseSigma[jIdx][jIdx] || 0;
			const corr = (varI>0 && varJ>0) ? cov / Math.sqrt(varI * varJ) : 0;
			results.push({ abbr: names[k], corr, cov, varI, varJ });
		}
		results.sort((a,b)=>Math.abs(b.corr) - Math.abs(a.corr));
		return results.slice(0, count);
	}

	function buildDiagPanel(){
		if (document.getElementById('diagPanel')) return;
		const panel = document.createElement('div');
		panel.id = 'diagPanel';
		panel.style.position = 'fixed';
		panel.style.right = '12px';
		panel.style.bottom = '12px';
		panel.style.width = '360px';
		panel.style.maxHeight = '60vh';
		panel.style.overflow = 'auto';
		panel.style.background = '#0b0b0b';
		panel.style.border = '1px solid rgba(255,255,255,0.04)';
		panel.style.borderRadius = '8px';
		panel.style.padding = '8px';
		panel.style.zIndex = 2000;
		panel.style.fontSize = '12px';
		panel.style.color = '#ddd';

		const title = document.createElement('div'); title.textContent = 'Diagnostics'; title.style.fontWeight = '700'; title.style.marginBottom = '6px'; panel.appendChild(title);

		const select = document.createElement('select'); select.id = 'diagSelect'; select.style.width = '100%'; select.style.marginBottom = '6px'; panel.appendChild(select);
		const fillOptions = () => {
			select.innerHTML = '';
			const opts = Array.from(MODEL_UNITS);
			opts.sort();
			opts.forEach(o => { const el = document.createElement('option'); el.value = o; el.text = o; select.appendChild(el); });
		};
		fillOptions();

		const runBtn = document.createElement('button'); runBtn.textContent = 'Run diagnostics'; runBtn.className = 'btn'; runBtn.style.marginRight = '6px';
		runBtn.addEventListener('click', () => { const id = document.getElementById('diagSelect').value; runDiagnostics(id); });
		panel.appendChild(runBtn);

		const dumpBtn = document.createElement('button'); dumpBtn.textContent = 'Console dump'; dumpBtn.className = 'btn'; dumpBtn.addEventListener('click', () => { const id = document.getElementById('diagSelect').value; consoleDiagnostics(id); });
		panel.appendChild(dumpBtn);

		// Prob table sorting controls
		const sortWrap = document.createElement('div'); sortWrap.style.marginTop = '8px';
		const sortLabel = document.createElement('label'); sortLabel.textContent = 'Battleground sort:'; sortLabel.style.marginRight = '6px';
		const sortSelect = document.createElement('select'); sortSelect.id = 'probSortSelect';
		['tossup','pdesc','evimpact'].forEach(opt => { const e = document.createElement('option'); e.value = opt; e.text = opt === 'tossup' ? 'Tossup-first' : (opt === 'pdesc' ? 'P(D) descending' : 'EV impact'); sortSelect.appendChild(e); });
		sortWrap.appendChild(sortLabel); sortWrap.appendChild(sortSelect);
		const limitInput = document.createElement('input'); limitInput.type='number'; limitInput.id='probTableLimit'; limitInput.value='15'; limitInput.min='5'; limitInput.max='200'; limitInput.style.width='64px'; limitInput.style.marginLeft='8px';
		const limitLabel = document.createElement('span'); limitLabel.textContent='rows'; limitLabel.style.marginLeft='6px';
		sortWrap.appendChild(limitInput); sortWrap.appendChild(limitLabel);
		panel.appendChild(sortWrap);

		// Outlier toggle
		const outWrap = document.createElement('div'); outWrap.style.marginTop = '8px';
		const outCheckbox = document.createElement('input'); outCheckbox.type = 'checkbox'; outCheckbox.id = 'diagOutlierToggle'; outCheckbox.checked = true;
		const outLabel = document.createElement('label'); outLabel.htmlFor = 'diagOutlierToggle'; outLabel.style.marginLeft = '6px'; outLabel.textContent = 'Remove outliers when building prior';
		const outState = document.createElement('div'); outState.id = 'diagOutlierState'; outState.style.fontSize='11px'; outState.style.color='#9aa'; outState.style.marginTop='4px'; outState.textContent = outCheckbox.checked ? 'Outlier removal: ON' : 'Outlier removal: OFF';
		outWrap.appendChild(outCheckbox); outWrap.appendChild(outLabel);
		panel.appendChild(outWrap);
		panel.appendChild(outState);
		outCheckbox.addEventListener('change', () => { const s = document.getElementById('diagOutlierState'); if (s) s.textContent = outCheckbox.checked ? 'Outlier removal: ON' : 'Outlier removal: OFF'; });

		const rebuildBtn = document.createElement('button'); rebuildBtn.textContent = 'Rebuild prior'; rebuildBtn.className = 'btn'; rebuildBtn.style.marginTop = '6px';
		rebuildBtn.addEventListener('click', async () => {
			const doRemove = document.getElementById('diagOutlierToggle').checked;
			// Re-load historical with or without outlier removal: we control this by toggling a global flag
			window.PROB_REMOVE_OUTLIERS = !!doRemove;
			// rebuild prior and recompute
			await loadHistoricalAndBuildPrior();
			recomputePosterior();
			runDiagnostics(document.getElementById('diagSelect').value);
		});
		panel.appendChild(rebuildBtn);

		const out = document.createElement('pre'); out.id = 'diagOut'; out.style.background = '#060606'; out.style.padding = '8px'; out.style.borderRadius = '6px'; out.style.marginTop = '8px'; out.style.whiteSpace = 'pre-wrap'; out.style.maxHeight = '44vh'; out.style.overflow = 'auto'; panel.appendChild(out);

		document.body.appendChild(panel);
	}

	function formatNum(x, prec=3){ if (!isFinite(x)) return 'NA'; return (Math.round(x * Math.pow(10,prec)) / Math.pow(10,prec)).toString(); }

	function runDiagnostics(id){
		if (!BAYES.ready){ document.getElementById('diagOut').textContent = 'Bayes not ready'; return; }
		const outEl = document.getElementById('diagOut');
		let out = '';
		// prior nat
		const priorNat = quadForm(new Array(BAYES.baseMu.length).fill(0).map((_,i)=> i===0?1:0), BAYES.baseMu, BAYES.baseSigma);
		out += `Prior national mean: ${formatNum(priorNat.mean,4)} sd:${formatNum(Math.sqrt(priorNat.var),4)}\n`;
		// posterior nat
		const postNat = quadForm(new Array(BAYES.mu.length).fill(0).map((_,i)=> i===0?1:0), BAYES.mu, BAYES.Sigma);
		out += `Posterior national mean: ${formatNum(postNat.mean,4)} sd:${formatNum(Math.sqrt(postNat.var),4)}\n\n`;
		// selected id
		if (id){
			const a = aVectorFor(id);
			const priorMarg = quadForm(a, BAYES.baseMu, BAYES.baseSigma);
			const postMarg = quadForm(a, BAYES.mu, BAYES.Sigma);
			const base = BAYES.r2024.get(id) || 0;
			out += `Unit: ${id} base: ${formatNum(base,4)}\n`;
			out += ` Prior mean raw: ${formatNum(priorMarg.mean + base,4)} sd:${formatNum(Math.sqrt(priorMarg.var),4)}\n`;
			out += ` Post mean raw: ${formatNum(postMarg.mean + base,4)} sd:${formatNum(Math.sqrt(postMarg.var),4)}\n`;
			out += ` Posterior P(D): ${formatNum(bayesProbDem(id),4)}\n\n`;
			const tops = topCorrelationsWith(id, 12);
			out += 'Top correlations (abs) with ' + id + ':\n';
			tops.forEach(t => out += ` ${t.abbr}: corr=${formatNum(t.corr,4)} cov=${formatNum(t.cov,6)}\n`);
		}
		outEl.textContent = out;
	}

	function consoleDiagnostics(id){
		console.log('[diag] BAYES ready', BAYES.ready);
		if (!BAYES.ready) return;
		console.log('[diag] baseMu', BAYES.baseMu);
		console.log('[diag] baseSigma', BAYES.baseSigma);
		console.log('[diag] mu', BAYES.mu);
		console.log('[diag] Sigma', BAYES.Sigma);
		if (id){
			console.log('[diag] selected', id);
			console.log('[diag] prior/posterior marginals', quadForm(aVectorFor(id), BAYES.baseMu, BAYES.baseSigma), quadForm(aVectorFor(id), BAYES.mu, BAYES.Sigma));
			console.log('[diag] bayesProbDem', bayesProbDem(id));
			console.log('[diag] top corrs', topCorrelationsWith(id,30));
		}
	}

	function formatNumber(x){
		if (x == null || !isFinite(x)) return '0';
		return Math.round(x).toLocaleString('en-US');
	}

	function formatPercent(x){
		if (!isFinite(x)) return '0%';
		return (x * 100).toFixed(1) + '%';
	}

	function formatMargin(x){
		if (!isFinite(x)) return '—';
		if (Math.abs(x) < 1e-4) return 'EVEN';
		const pct = (Math.abs(x) * 100).toFixed(1);
		return (x > 0 ? 'D+' : 'R+') + pct;
	}

	function setText(id, value){
		const el = document.getElementById(id);
		if (el) el.textContent = value;
	}

	function colorForState(state){
		if (!state) return '#2f2f2f';
		if (state.status === 'tossup') return COLORS.tossup;
		if (state.status === 'dem') return state.strength === 'safe' ? COLORS.demSafe : COLORS.demLean;
		return state.strength === 'safe' ? COLORS.repSafe : COLORS.repLean;
	}

	function updateStateColor(code){
		const state = stateStore.get(code);
		if (state && window.ElectionMap) {
			window.ElectionMap.setStateFill(code, colorForState(state));
			// apply locked styling class if needed
			try {
				const sel = window.ElectionMap.statePaths && window.ElectionMap.statePaths.get(code);
				if (sel && sel.node){
					if (state.locked) sel.classed('locked', true); else sel.classed('locked', false);
				}
			} catch(e){}
		}
	}

	function updateUnitColor(unit){
		const u = unitStore.get(unit);
		if (!u || !window.ElectionMap) return;
		window.ElectionMap.setDistrictFill(unit, colorForState(u));
	}

	function updateAllColors(){
		stateStore.forEach((_, code) => updateStateColor(code));
		unitStore.forEach((_, unit) => updateUnitColor(unit));
	}

	function cycleState(obj){
		// If object is locked (extreme posterior probability), do not change
		if (obj && obj.locked) return;
		const ring = [
			{ status:'dem', strength:'lean' },
			{ status:'dem', strength:'safe' },
			{ status:'rep', strength:'safe' },
			{ status:'rep', strength:'lean' },
			{ status:'tossup', strength:'tossup' }
		];
		let idx = ring.findIndex(r => r.status === obj.status && r.strength === obj.strength);
		if (idx === -1) idx = ring.length - 1;
		const next = ring[(idx + 1) % ring.length];
		obj.status = next.status;
		obj.strength = next.strength;
	}

	function classifyMargin(margin){
		if (!isFinite(margin)) return { status:'tossup', strength:'tossup' };
		const abs = Math.abs(margin);
		if (abs < tossupBand) return { status:'tossup', strength:'tossup' };
		const status = margin >= 0 ? 'dem' : 'rep';
		const strength = abs >= DEFAULT_THRESHOLD ? 'safe' : 'lean';
		return { status, strength };
	}

	function categorizeProbability(pDem){
		if (!isFinite(pDem)) return { status:'tossup', strength:'tossup' };
		const lean = autoLeanThreshold;
		const safe = Math.min(0.95, lean + 0.18);
		if (pDem >= safe) return { status:'dem', strength:'safe' };
		if (pDem >= lean) return { status:'dem', strength:'lean' };
		if (pDem <= 1 - safe) return { status:'rep', strength:'safe' };
		if (pDem <= 1 - lean) return { status:'rep', strength:'lean' };
		return { status:'tossup', strength:'tossup' };
	}

	function buildStateData(rows2024){
		stateStore.clear();
		unitStore.clear();
		MODEL_UNITS.length = 0;
		TOTAL_EV = 0;
		BAYES.EV.clear();
		BAYES.r2024.clear();

		const districtStates = new Set();
		(rows2024 || []).forEach(row => {
			if (!row || !row.abbr) return;
			if (row.abbr.includes('-')) districtStates.add(row.abbr.slice(0,2));
		});

		const byState = new Map();
		(rows2024 || []).forEach(row => {
			if (!row || !row.abbr || row.abbr === 'NATIONAL') return;
			const unit = row.abbr.trim();
			if (!unit) return;
			if (!unit.includes('-') && districtStates.has(unit)) return; // skip aggregate row when districts exist
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
				baseStatus: 'tossup',
				baseStrength: 'tossup',
				manual: false,
				lastProb: 0.5
			});
			BAYES.EV.set(unit, ev);
			BAYES.r2024.set(unit, isFinite(margin) ? margin : 0);
		});

		byState.forEach(entry => {
			const totalEv = entry.evTotal || 0;
			TOTAL_EV += totalEv;
			const margin = totalEv > 0 ? (entry.weightedMargin / totalEv) : 0;
			entry.units.sort((a,b)=>a.unit.localeCompare(b.unit));
			stateStore.set(entry.state, {
				state: entry.state,
				ev: totalEv,
				margin,
				units: entry.units,
				status: 'tossup',
				strength: 'tossup',
				manual: false,
				lastProb: 0.5
			});
			BAYES.r2024.set(entry.state, margin);
		});

		MODEL_UNITS.push(...Array.from(unitStore.keys()).sort());
	}

	function applyBaselineClassification(){
		stateStore.forEach(state => {
			const cls = classifyMargin(state.margin);
			state.status = cls.status;
			state.strength = cls.strength;
			state.baseStatus = cls.status;
			state.baseStrength = cls.strength;
			state.manual = false;
			(state.units || []).forEach(ref => {
				const unit = unitStore.get(ref.unit);
				if (!unit) return;
				const ucls = classifyMargin(unit.margin);
				unit.status = ucls.status;
				unit.strength = ucls.strength;
				unit.baseStatus = ucls.status;
				unit.baseStrength = ucls.strength;
				unit.manual = false;
			});
		});
	}

	function handleStateClick(code, event){
		const state = stateStore.get(code);
		if (!state) return;
		if (state.locked) return; // ignore clicks on locked states
		if (event && event.shiftKey){
			state.status = 'tossup';
			state.strength = 'tossup';
			state.manual = false;
		} else {
			cycleState(state);
			state.manual = state.strength !== 'tossup';
		}
		(state.units || []).forEach(ref => {
			const unit = unitStore.get(ref.unit);
			if (!unit) return;
			unit.status = state.status;
			unit.strength = state.strength;
			unit.manual = state.manual;
			updateUnitColor(unit.unit);
		});
		updateStateColor(code);
		recomputePosterior();
	}

	function handleDistrictClick(unitKey, event){
		const unit = unitStore.get(unitKey);
		if (!unit) return;
		if (unit.locked) return; // locked units ignore clicks
		if (event && event.shiftKey){
			unit.status = 'tossup';
			unit.strength = 'tossup';
			unit.manual = false;
		} else {
			cycleState(unit);
			unit.manual = unit.strength !== 'tossup';
		}
		updateUnitColor(unitKey);
		const state = stateStore.get(unit.state);
		if (state){
			const units = state.units || [];
			state.manual = units.some(u => {
				const uu = unitStore.get(u.unit);
				return uu && uu.manual;
			});
		}
		recomputePosterior();
	}

	function describeStatus(state){
		if (!state) return '';
		if (state.status === 'tossup') return 'Toss-up';
		const label = state.strength === 'safe' ? 'Safe' : 'Lean';
		const party = state.status === 'dem' ? 'D' : 'R';
		return `${label} ${party}`;
	}

	function mapWrap(){ return document.getElementById('map-wrap'); }
	function mapTip(){ return document.getElementById('mapTip'); }

	function positionTip(evt){
		const tip = mapTip(); if (!tip) return;
		const wrap = mapWrap(); if (!wrap) return;
		const wrapRect = wrap.getBoundingClientRect();
		const offsetX = 12, offsetY = 12;
		let x = evt.clientX - wrapRect.left + offsetX;
		let y = evt.clientY - wrapRect.top + offsetY;
		tip.style.display = 'block';
		const tipRect = tip.getBoundingClientRect();
		const pad = 6;
		x = Math.max(pad, Math.min(wrapRect.width - pad - tipRect.width, x));
		y = Math.max(pad, Math.min(wrapRect.height - pad - tipRect.height, y));
		tip.style.left = `${x}px`;
		tip.style.top = `${y}px`;
	}

	function handleStateHover(evt, code){
		const state = stateStore.get(code);
		if (!state) return;
		const tip = mapTip(); if (!tip) return;
		const name = STATE_NAMES[state.state] || state.state;
		// Include aggregate Other EVs if present on the state object (oEV or thirdPartyEVs)
		let extraO = '';
		try {
			let others = 0;
			if (state.oEV != null && isFinite(state.oEV)) others += Number(state.oEV) || 0;
			if (state.thirdPartyEVs && typeof state.thirdPartyEVs === 'object') {
				Object.values(state.thirdPartyEVs).forEach(v => { if (isFinite(v)) others += Number(v) || 0; });
			}
			if (others > 0) extraO = ` · O: ${others}`;
		} catch(e) { /* ignore */ }
		tip.textContent = `${name} · ${state.ev} EV · ${formatMargin(state.margin)} · ${describeStatus(state)}` + (state.manual ? ' · manual' : '') + extraO;
		tip.style.display = 'block';
		positionTip(evt);
	}

	function handleDistrictHover(evt, unitKey){
		const unit = unitStore.get(unitKey);
		if (!unit) return;
		const tip = mapTip(); if (!tip) return;
		const label = unit.unit.endsWith('-AL') ? 'AL' : unit.unit.split('-')[1];
		const name = `${STATE_NAMES[unit.state] || unit.state} ${label}`;
		tip.textContent = `${unit.unit} · ${unit.ev} EV · ${formatMargin(unit.margin)} · ${describeStatus(unit)}` + (unit.manual ? ' · manual' : '');
		tip.style.display = 'block';
		positionTip(evt);
	}

	function hideTip(){ const tip = mapTip(); if (tip) tip.style.display = 'none'; }

	function updateBuckets(){
		const totals = { safeD:0, leanD:0, toss:0, leanR:0, safeR:0 };
		const counts = { safeD:0, leanD:0, toss:0, leanR:0, safeR:0 };
		MODEL_UNITS.forEach(id => {
			const obj = unitStore.get(id) || stateStore.get(id);
			if (!obj) return;
			const ev = obj.ev || 0;
			if (obj.status === 'dem' && obj.strength === 'safe'){ totals.safeD += ev; counts.safeD++; }
			else if (obj.status === 'dem' && obj.strength === 'lean'){ totals.leanD += ev; counts.leanD++; }
			else if (obj.status === 'rep' && obj.strength === 'safe'){ totals.safeR += ev; counts.safeR++; }
			else if (obj.status === 'rep' && obj.strength === 'lean'){ totals.leanR += ev; counts.leanR++; }
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

	function renderProbabilityTable(){
		const tbody = document.getElementById('probTableBody');
		if (!tbody) return;
		const records = [];
		// First, include individual units (districts and standalone units) from MODEL_UNITS
		MODEL_UNITS.forEach(id => {
			const unit = unitStore.get(id);
			if (!unit) return;
			const label = unit.unit.endsWith('-AL') ? 'AL' : unit.unit.split('-')[1];
			const name = unit.unit.includes('-') ? `${STATE_NAMES[unit.state] || unit.state} ${label}` : (STATE_NAMES[unit.state] || unit.state);
			records.push({
				id: unit.unit,
				name,
				ev: unit.ev,
				margin: unit.margin,
				prob: unit.lastProb != null ? unit.lastProb : 0.5,
				manual: !!unit.manual
			});
		});
		// Then include whole-state aggregates only for states that do not have unit-level rows
		stateStore.forEach(state => {
			if (unitStore.has(state.state)) return; // skip aggregate if units exist
			records.push({
				id: state.state,
				name: STATE_NAMES[state.state] || state.state,
				ev: state.ev,
				margin: state.margin,
				prob: state.lastProb != null ? state.lastProb : 0.5,
				manual: !!state.manual
			});
		});
		// Filter to 'interesting' battlegrounds: not utterly certain and either near 50% or non-trivial EV
		const filtered = records.filter(r => {
			if (!isFinite(r.prob)) return false;
			if (r.prob <= 0.001 || r.prob >= 0.999) return false;
			const dist = Math.abs(r.prob - 0.5);
			return dist <= 0.40 || (r.ev && r.ev >= 3);
		});
		// Sorting mode from diagnostics panel
		const sortModeEl = document.getElementById('probSortSelect');
		const sortMode = sortModeEl ? sortModeEl.value : 'tossup';
		if (sortMode === 'pdesc'){
			filtered.sort((a,b) => b.prob - a.prob || b.ev - a.ev);
		} else if (sortMode === 'evimpact'){
			// EV impact: sort by distance from 0.5 weighted by EV
			filtered.sort((a,b) => (Math.abs(b.prob-0.5)*b.ev) - (Math.abs(a.prob-0.5)*a.ev));
		} else {
			// default: tossup-first (closest to 0.5), tie-break on EV
			filtered.sort((a,b) => {
				const da = Math.abs(a.prob - 0.5);
				const db = Math.abs(b.prob - 0.5);
				if (da !== db) return da - db;
				return b.ev - a.ev;
			});
		}
		const limitEl = document.getElementById('probTableLimit');
		let limit = 15;
		if (limitEl) try { limit = Math.max(5, Math.min(200, parseInt(limitEl.value,10) || 15)); } catch(e){}
		tbody.innerHTML = '';
		filtered.slice(0, limit).forEach(rec => {
			const tr = document.createElement('tr');
			const nameCell = document.createElement('td');
			nameCell.textContent = rec.name;
			const evCell = document.createElement('td');
			evCell.textContent = formatNumber(rec.ev);
			const marginCell = document.createElement('td');
			marginCell.textContent = formatMargin(rec.margin);
			const probCell = document.createElement('td');
			probCell.textContent = formatPercent(rec.prob);
			const manualCell = document.createElement('td');
			manualCell.textContent = rec.manual ? '★' : '';
			tr.appendChild(nameCell);
			tr.appendChild(evCell);
			tr.appendChild(marginCell);
			tr.appendChild(probCell);
			tr.appendChild(manualCell);
			tbody.appendChild(tr);
		});
	}

	Math.erf = Math.erf || function(x){
		const sign = x >= 0 ? 1 : -1;
		x = Math.abs(x);
		const a1 = 0.254829592;
		const a2 = -0.284496736;
		const a3 = 1.421413741;
		const a4 = -1.453152027;
		const a5 = 1.061405429;
		const p = 0.3275911;
		const t = 1 / (1 + p * x);
		const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
		return sign * y;
	};

	function phiStd(x){
		return 0.5 * (1 + Math.erf(x / Math.SQRT2));
	}

	function kalmanUpdate(mu, Sigma, a, measurement, sigma){
		const n = mu.length;
		// compute a^T * Sigma * a
		let Sa = 0;
		for (let i=0;i<n;i++){
			let rowDot = 0;
			for (let j=0;j<n;j++) rowDot += Sigma[i][j] * a[j];
			Sa += a[i] * rowDot;
		}
		const S = Sa + sigma * sigma; // innovation covariance
		// K = Sigma * a / S
		const K = new Array(n).fill(0);
		for (let i=0;i<n;i++){
			let dot = 0;
			for (let j=0;j<n;j++) dot += Sigma[i][j] * a[j];
			K[i] = dot / S;
		}
		// a^T * mu
		let aTmu = 0;
		for (let i=0;i<n;i++) aTmu += a[i] * mu[i];
		const innov = measurement - aTmu;
		const muNew = mu.slice();
		for (let i=0;i<n;i++) muNew[i] += K[i] * innov;

		// Correct covariance update: Sigma_new = Sigma - K * (a^T * Sigma)
		const SigmaNew = Sigma.map(r => r.slice());
		// compute a^T * Sigma as a row vector (length n): aTSigma[j] = sum_k a[k] * Sigma[k][j]
		const aTSigma = new Array(n).fill(0);
		for (let j=0;j<n;j++){
			let sum = 0;
			for (let k=0;k<n;k++) sum += a[k] * Sigma[k][j];
			aTSigma[j] = sum;
		}
		for (let i=0;i<n;i++){
			for (let j=0;j<n;j++){
				SigmaNew[i][j] -= K[i] * aTSigma[j];
			}
		}
		// enforce symmetry / numerical floor
		for (let i=0;i<n;i++){
			for (let j=i+1;j<n;j++){
				const v = 0.5 * (SigmaNew[i][j] + SigmaNew[j][i]);
				SigmaNew[i][j] = SigmaNew[j][i] = v;
			}
			// floor diagonal
			if (SigmaNew[i][i] < 1e-12) SigmaNew[i][i] = 1e-12;
		}
		return { mu: muNew, Sigma: SigmaNew };
	}

	function buildBayesPrior(tsById){
		const VAR_UNITS = MODEL_UNITS.slice();
		const deltasById = new Map();
		let cycles = null;
		VAR_UNITS.forEach(id => {
			const arr = tsById.get(id) || [];
			const deltas = [];
			for (let i=1;i<arr.length;i++){
				const curr = arr[i];
				const prev = arr[i-1];
				if (isFinite(curr) && isFinite(prev)) deltas.push(curr - prev);
			}
			deltasById.set(id, deltas);
			if (cycles === null || deltas.length < cycles) cycles = deltas.length;
		});

		// Outlier removal: use MAD-based filter per-unit to remove extreme swings (e.g., Utah 2012/2016)
		if (window.PROB_REMOVE_OUTLIERS === undefined) window.PROB_REMOVE_OUTLIERS = true;
		if (window.PROB_REMOVE_OUTLIERS){
			const OUTLIER_MAD_MULT = 3; // multiplier for MAD to decide outliers
			const MIN_CUTOFF = 0.05; // minimum cutoff in raw margin (5 percentage points)
			VAR_UNITS.forEach(id => {
				const deltas = deltasById.get(id) || [];
				if (!deltas || deltas.length === 0) return;
				const sorted = deltas.slice().sort((a,b)=>a-b);
				const mid = sorted.length >> 1;
				const med = (sorted.length % 2) ? sorted[mid] : 0.5 * (sorted[mid-1] + sorted[mid]);
				const absDev = sorted.map(v => Math.abs(v - med)).sort((a,b)=>a-b);
				const mad = (absDev.length % 2) ? absDev[absDev.length >> 1] : (absDev.length ? 0.5 * (absDev[absDev.length/2 - 1] + absDev[absDev.length/2]) : 0);
				const madScaled = mad * 1.4826; // consistent estimator to approximate std
				const cutoff = Math.max(OUTLIER_MAD_MULT * madScaled, MIN_CUTOFF);
				const cleaned = deltas.filter(v => Math.abs(v - med) <= cutoff);
				// If cleaning removed everything (rare), keep original deltas
				if (cleaned.length > 0) deltasById.set(id, cleaned);
			});
		}

		// Recompute cycles to reflect any cleaned shorter series
		cycles = null;
		VAR_UNITS.forEach(id => { const arr = deltasById.get(id) || []; if (cycles === null || arr.length < cycles) cycles = arr.length; });
		if (!cycles || cycles < 1) cycles = 1;
		const natSwing = new Array(cycles).fill(0);
		for (let t=0;t<cycles;t++){
			const vals = [];
			VAR_UNITS.forEach(id => {
				const arr = deltasById.get(id);
				if (arr && isFinite(arr[t])) vals.push(arr[t]);
			});
			if (vals.length){
				vals.sort((a,b)=>a-b);
				const mid = vals.length >> 1;
				natSwing[t] = vals.length % 2 ? vals[mid] : 0.5 * (vals[mid-1] + vals[mid]);
			}
		}
		const meanNat = natSwing.reduce((a,b)=>a+b,0) / natSwing.length;
		const varNat = natSwing.reduce((a,b)=>a + (b - meanNat) * (b - meanNat), 0) / Math.max(1, natSwing.length - 1);
		const sigmaNat = Math.sqrt(Math.max(1e-5, varNat || 0.0004));
		const sigmaState = new Map();
		VAR_UNITS.forEach(id => {
			const deltas = deltasById.get(id) || [];
			let sum = 0, count = 0;
			for (let t=0;t<Math.min(cycles, deltas.length);t++){
				const resid = deltas[t] - natSwing[t];
				if (isFinite(resid)){
					sum += resid * resid;
					count++;
				}
			}
			const varResid = count > 1 ? (sum / (count - 1)) : 0.0009;
			sigmaState.set(id, Math.sqrt(Math.max(0.0001, varResid)));
		});
		const D = 1 + VAR_UNITS.length;
		const Sigma = Array.from({length:D}, () => Array(D).fill(0));
		Sigma[0][0] = sigmaNat * sigmaNat;
		for (let i=0;i<VAR_UNITS.length;i++){
			const idxI = 1 + i;
			const sigmaI = sigmaState.get(VAR_UNITS[i]) || 0.02;
			Sigma[0][idxI] = Sigma[idxI][0] = sigmaNat * sigmaNat;
			Sigma[idxI][idxI] = sigmaNat * sigmaNat + sigmaI * sigmaI;
			for (let j=i+1;j<VAR_UNITS.length;j++){
				const idxJ = 1 + j;
				Sigma[idxI][idxJ] = Sigma[idxJ][idxI] = sigmaNat * sigmaNat;
			}
		}
		const mu = new Array(D).fill(0);
		BAYES.ready = true;
		BAYES.VAR_UNITS = VAR_UNITS;
		const idxMap = new Map();
		idxMap.set('NAT', 0);
		VAR_UNITS.forEach((id,i)=> idxMap.set(id, 1 + i));
		BAYES.IDX = idxMap;
		BAYES.mu = mu.slice();
		BAYES.Sigma = Sigma.map(r => r.slice());
		BAYES.baseMu = mu.slice();
		BAYES.baseSigma = Sigma.map(r => r.slice());
		BAYES.sigmaNat = sigmaNat;
		BAYES.salt = 0;
	}

	function bayesResetPosterior(){
		if (!BAYES.ready) return;
		BAYES.mu = BAYES.baseMu.slice();
		BAYES.Sigma = BAYES.baseSigma.map(r => r.slice());
		BAYES.salt = 0;
	}

	function bayesObservePick(id, status, strength){
		if (!BAYES.ready) return;
		if (strength === 'tossup') return;
		const idx = BAYES.IDX.get(id);
		if (idx == null) return;
		const cfg = (status === 'dem' ? OBSERVE_TARGETS.dem[strength] : OBSERVE_TARGETS.rep[strength]);
		if (!cfg) return;
		const base = BAYES.r2024.get(id) || 0;
		const measurement = cfg.target - base;
		const a = new Array(BAYES.mu.length).fill(0);
		a[0] = 1;
		a[idx] = 1;
		const result = kalmanUpdate(BAYES.mu, BAYES.Sigma, a, measurement, cfg.sigma);
		BAYES.mu = result.mu;
		BAYES.Sigma = result.Sigma;
		BAYES.salt += strength === 'safe' ? 0.12 : 0.05;
	}

	function bayesProbDem(id){
		if (!BAYES.ready) return 0.5;
		const idx = BAYES.IDX.get(id);
		if (idx == null) return 0.5;
		const a = new Array(BAYES.mu.length).fill(0);
		a[0] = 1;
		a[idx] = 1;
		let mean = 0;
		for (let i=0;i<a.length;i++) mean += a[i] * BAYES.mu[i];
		let varv = 0;
		for (let i=0;i<a.length;i++){
			let rowDot = 0;
			for (let j=0;j<a.length;j++) rowDot += BAYES.Sigma[i][j] * a[j];
			varv += a[i] * rowDot;
		}
		const base = BAYES.r2024.get(id) || 0;
		const z = (mean + base) / Math.sqrt(Math.max(1e-8, varv));
		return phiStd(z);
	}

	function drawZ(){
		let u = 0, v = 0;
		while (u === 0) u = Math.random();
		while (v === 0) v = Math.random();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	}

	function choleskyDecomposition(matrix){
		const n = matrix.length;
		const L = Array.from({length:n}, () => Array(n).fill(0));
		for (let i=0;i<n;i++){
			for (let j=0;j<=i;j++){
				let sum = matrix[i][j];
				for (let k=0;k<j;k++) sum -= L[i][k] * L[j][k];
				if (i === j){
					if (sum <= 1e-12) return null;
					L[i][j] = Math.sqrt(sum);
				} else {
					L[i][j] = sum / L[j][j];
				}
			}
		}
		return L;
	}

	function choleskyWithJitter(matrix){
		let jitter = 1e-6;
		for (let attempt=0; attempt<5; attempt++){
			const adjusted = matrix.map((row,i)=> row.map((val,j)=> i===j ? val + jitter : val));
			const L = choleskyDecomposition(adjusted);
			if (L) return L;
			jitter *= 10;
		}
		return null;
	}

	function runPosteriorSimulation(samples){
		if (!BAYES.ready) return null;
		const L = choleskyWithJitter(BAYES.Sigma);
		if (!L) return null;
		const dim = BAYES.mu.length;
		let demEVSum = 0;
		let natSum = 0;
		let natSqSum = 0;
		let demWins = 0, repWins = 0, ties = 0;
		const perUnit = new Map();
		for (let s=0; s<samples; s++){
			const z = new Array(dim).fill(0).map(()=>drawZ());
			const draw = new Array(dim).fill(0);
			for (let i=0;i<dim;i++){
				let sum = 0;
				for (let k=0;k<=i;k++) sum += L[i][k] * z[k];
				draw[i] = BAYES.mu[i] + sum;
			}
			const nat = draw[0];
			natSum += nat;
			natSqSum += nat * nat;
			let demEV = 0;
			MODEL_UNITS.forEach(id => {
				const idx = BAYES.IDX.get(id);
				const delta = idx != null ? draw[idx] : 0;
				const base = BAYES.r2024.get(id) || 0;
				const ev = BAYES.EV.get(id) || 0;
				const raw = base + nat + delta;
				const demWinsUnit = raw >= 0;
				if (!perUnit.has(id)) perUnit.set(id, { dem:0, total:0 });
				const entry = perUnit.get(id);
				if (demWinsUnit) demEV += ev;
				if (demWinsUnit) entry.dem++;
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
		const natMean = natSum / samples;
		const natVar = Math.max(0, (natSqSum / samples) - natMean * natMean);
		return {
			samples,
			demEVMean: demEVSum / samples,
			repEVMean: TOTAL_EV - (demEVSum / samples),
			demWins,
			repWins,
			ties,
			perUnit,
			natMean,
			natStd: Math.sqrt(natVar)
		};
	}

	function applyProbabilitiesFromSimulation(sim){
		if (!sim) return;
		sim.perUnit.forEach((counts, id) => {
			const pDem = counts.total ? counts.dem / counts.total : 0.5;
			const unit = unitStore.get(id);
			if (unit){
				unit.lastProb = pDem;
				// Determine (un)lock status: extreme probabilities lock against opposite party manual changes
				unit.locked = (pDem >= LOCK_PROB_THRESHOLD && unit.status === 'rep') || (pDem <= (1-LOCK_PROB_THRESHOLD) && unit.status === 'dem');
				if (!unit.manual){
					const cat = categorizeProbability(pDem);
					unit.status = cat.status;
					unit.strength = cat.strength;
				}
				updateUnitColor(id);
			}
		});
		stateStore.forEach(state => {
			let p = 0.5;
			let evTotal = 0;
			if (state.units && state.units.length){
				let weighted = 0;
				state.units.forEach(ref => {
					const unit = unitStore.get(ref.unit);
					const prob = unit ? unit.lastProb : 0.5;
					weighted += prob * (unit ? unit.ev : ref.ev || 0);
					evTotal += unit ? unit.ev : (ref.ev || 0);
				});
				p = evTotal ? weighted / evTotal : 0.5;
			} else {
				const entry = sim.perUnit.get(state.state);
				if (entry && entry.total) p = entry.dem / entry.total;
			}
			state.lastProb = p;
			state.locked = (p >= LOCK_PROB_THRESHOLD && state.status === 'rep') || (p <= (1-LOCK_PROB_THRESHOLD) && state.status === 'dem');
			if (!state.manual){
				const cat = categorizeProbability(p);
				state.status = cat.status;
				state.strength = cat.strength;
			}
			updateStateColor(state.state);
		});
		refreshDecorations();
	}

	// Build color maps & label/EV updates using shared ElectionMap.refreshDecorations API
	function refreshDecorations(){
		if (!window.ElectionMap) return;
		const evLookup = abbr => {
			if (unitStore.has(abbr)) return unitStore.get(abbr).ev;
			if (stateStore.has(abbr)) return stateStore.get(abbr).ev;
			return null;
		};
		const abbrColors = new Map();
		stateStore.forEach(st => {
			abbrColors.set(st.state, { color: colorForState(st) });
		});
		const unitColors = new Map();
		unitStore.forEach(u => {
			unitColors.set(u.unit, colorForState(u));
		});
		try { window.ElectionMap.refreshDecorations(2028, evLookup, abbrColors, unitColors); } catch(e){}
	}

	function updateSummaries(sim){
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
		setText('natRange68', `${formatMargin(range68Low)} – ${formatMargin(range68High)}`);
		setText('natRange95', `${formatMargin(range95Low)} – ${formatMargin(range95High)}`);
	}

	function recomputePosterior(){
		if (!BAYES.ready) return;
		bayesResetPosterior();
		stateStore.forEach(state => {
			if (state.manual && state.strength !== 'tossup'){
				bayesObservePick(state.state, state.status, state.strength);
			}
		});
		unitStore.forEach(unit => {
			if (unit.manual && unit.strength !== 'tossup'){
				bayesObservePick(unit.unit, unit.status, unit.strength);
			}
		});
		const sim = runPosteriorSimulation(4096);
		applyProbabilitiesFromSimulation(sim);
		updateBuckets();
		renderProbabilityTable();
		updateSummaries(sim);
		refreshDecorations();
	}

	async function buildMap(){
		statePaths.clear();
		if (!window.ElectionMap) return;
		await window.ElectionMap.build({
			svgSelector: '#map',
			topoUrl: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json',
			districtGeoUrl: 'me_ne_districts.geojson',
			stateHandlers: {
				click: (evt, abbr) => { if (!abbr || !stateStore.has(abbr)) return; handleStateClick(abbr, evt); },
				mouseenter: (evt, abbr) => { if (!abbr) return; handleStateHover(evt, abbr); },
				mousemove: evt => { positionTip(evt); },
				mouseleave: () => { hideTip(); }
			},
			districtHandlers: {
				click: (evt, unit) => { if (!unitStore.has(unit)) return; handleDistrictClick(unit, evt); },
				mouseenter: (evt, unit) => { if (!unitStore.has(unit)) return; handleDistrictHover(evt, unit); },
				mousemove: evt => { positionTip(evt); },
				mouseleave: () => { hideTip(); }
			}
		});
		if (window.ElectionMap && window.ElectionMap.statePaths){
			window.ElectionMap.statePaths.forEach((sel, abbr) => statePaths.set(abbr, sel));
		}
		refreshDecorations();
	}

	function initControls(){
		const resetBtn = document.getElementById('resetStates');
		if (resetBtn) resetBtn.addEventListener('click', () => {
			applyBaselineClassification();
			updateAllColors();
			recomputePosterior();
		});
		const clearBtn = document.getElementById('clearManualStates');
		if (clearBtn) clearBtn.addEventListener('click', () => {
			stateStore.forEach(state => { state.manual = false; });
			unitStore.forEach(unit => { unit.manual = false; });
			recomputePosterior();
		});
		const thresholdSlider = document.getElementById('autoThreshold');
		const thresholdValue = document.getElementById('autoThresholdValue');
		if (thresholdSlider && thresholdValue){
			thresholdSlider.addEventListener('input', () => {
				const val = parseInt(thresholdSlider.value, 10);
				autoLeanThreshold = Math.max(0.5, Math.min(0.9, val / 100));
				thresholdValue.textContent = `${Math.round(autoLeanThreshold * 100)}%`;
				recomputePosterior();
			});
			thresholdValue.textContent = `${Math.round(autoLeanThreshold * 100)}%`;
		}
	}

	async function loadHistoricalAndBuildPrior(){
		const needed = new Set(MODEL_UNITS);
		const rows = await d3.csv('presidential_margins.csv', row => {
			const year = +row.year;
			if (!row.abbr || row.abbr === 'NATIONAL') return null;
			if (year < 2000) return null;
			if (!needed.has(row.abbr)) return null;
			return {
				year,
				id: row.abbr,
				rel: parseFloat(row.relative_margin)
			};
		});
		const tsById = new Map();
		rows.forEach(r => {
			if (!tsById.has(r.id)) tsById.set(r.id, []);
			tsById.get(r.id).push({ year: r.year, rel: isFinite(r.rel) ? r.rel : 0 });
		});
		const aligned = new Map();
		tsById.forEach((arr, id) => {
			arr.sort((a,b)=>a.year - b.year);
			aligned.set(id, arr.map(x => x.rel));
		});
		buildBayesPrior(aligned);
	}

	async function init(){
		initControls();
		try {
			const rows2024 = await d3.csv('presidential_margins.csv', row => {
				if (+row.year !== 2024) return null;
				if (!row.abbr || row.abbr === 'NATIONAL') return null;
				return {
					abbr: row.abbr,
					ev: parseInt(row.electoral_votes || row.electoral_Votes || row.ev, 10),
					margin: parseFloat(row.relative_margin)
				};
			});
			buildStateData(rows2024);
			applyBaselineClassification();
			// create diagnostics panel and populate select
			buildDiagPanel();
			const sel = document.getElementById('diagSelect'); if (sel){ sel.innerHTML = ''; Array.from(MODEL_UNITS).sort().forEach(o=>{ const el = document.createElement('option'); el.value=o; el.text=o; sel.appendChild(el); }); }
			await loadHistoricalAndBuildPrior();
			await buildMap();
			updateAllColors();
			recomputePosterior();
		} catch (err){
			console.error('[probabilities] failed to initialise', err);
		}
	}

	document.addEventListener('DOMContentLoaded', init);
})();
