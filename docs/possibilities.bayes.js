(function(){
	const STATUS_SEQUENCE = ['dem','tossup','rep'];
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

	const FIPS_TO_ABBR = {
		'01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY'
	};

	// State-level store (for labels, summaries) and unit-level store for ME/NE districts
	const stateStore = new Map(); // abbr -> { state, ev, margin, units, status, strength, baseStatus, baseStrength, manual }
	const unitStore = new Map();  // unit -> { unit, state, ev, margin, status, strength, baseStatus, baseStrength, manual }
	const statePaths = new Map(); // abbr -> d3 selection (proxied from ElectionMap)
	const DEFAULT_THRESHOLD = 0.05;
	let currentThreshold = DEFAULT_THRESHOLD;
	let tossupBand = Math.min(currentThreshold / 2, 0.025);

	// Enumeration guardrails
	const ENUMERATION_LIMIT = 16; // max tossup units to fully enumerate (2^16 = 65,536)
	const HARD_ENUMERATION_CAP = 18; // absolute hard cap (2^18=262k) for on-page attempt
	let lastEnumerated = { key:null, data:null }; // memoization

	// Probabilistic mode configuration (experimental)
	let probabilisticMode = false;
	let probApplying = false; // guard to avoid recursive scheduling while applying prob-derived coloring
	let probCacheKey = null;
	let lastProbResult = null;
	const PROB_MAX_SIMS = 20000; // total simulation attempts upper bound
	const PROB_TARGET_ACCEPT = 4000; // aim for this many accepted conditional sims
	const PV_STD = 0.03; // 3 percentage points national swing std dev (relative margin units)
	const STATE_STD = 0.04; // 4pp idiosyncratic state noise
	const SALT_CAP = 8; // cap salt score for display

	function encodeScenario(){
		// Encode threshold (percentage integer) + unit statuses.
		// Unit precedence: use unitStore entries for states with districts, else state.
		// Format: th=<int>&m=<RLE string>
		// Encoding: each unit/state -> code: XX or XX-YY; status char: D,R,T plus lean strength: S (safe) or L (lean) or X (toss) -> map to single symbol.
		// We'll compress as: token=ID:symbol separated by commas. Then base64url.
		try {
			const pieces = [];
			const used = new Set();
			unitStore.forEach(u => {
				pieces.push(`${u.unit}:${statusSymbol(u)}`);
				used.add(u.unit);
			});
			stateStore.forEach(s => {
				// skip states that have district AL unit already encoded
				if (s.units && s.units.some(u => used.has(u.unit))) return;
				pieces.push(`${s.state}:${statusSymbol(s)}`);
			});
			pieces.sort();
			const raw = pieces.join('|');
			const b64 = btoa(unescape(encodeURIComponent(raw))).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
			const th = Math.round(currentThreshold*100); // percent
			const sp = new URLSearchParams(location.search);
			sp.set('th', th.toString());
			sp.set('m', b64);
			const newUrl = `${location.pathname}?${sp.toString()}`;
			return newUrl;
		} catch(e) { /* ignore */ }
			return location.href;
	}

	function statusSymbol(obj){
		if (obj.status === 'tossup') return 'T';
		if (obj.status === 'dem') return obj.strength === 'safe' ? 'DS' : 'DL';
		if (obj.status === 'rep') return obj.strength === 'safe' ? 'RS' : 'RL';
		return 'T';
	}

	function applySymbol(target, symbol){
		if (!target) return;
		if (symbol === 'T'){ target.status='tossup'; target.strength='tossup'; target.manual=true; return; }
		const party = symbol[0];
		const strengthCode = symbol[1];
		if (party === 'D'){ target.status='dem'; target.strength = (strengthCode==='S')? 'safe':'lean'; }
		else if (party === 'R'){ target.status='rep'; target.strength = (strengthCode==='S')? 'safe':'lean'; }
		// mark as manual only if it differs from the base classification
		try {
			if (target.baseStatus != null && target.baseStrength != null) {
				target.manual = (target.status !== target.baseStatus) || (target.strength !== target.baseStrength);
			} else {
				// if no base known, mark manual conservatively
				target.manual = true;
			}
		} catch(e){ target.manual = true; }
	}

	function decodeScenarioFromURL(){
		try {
			const sp = new URLSearchParams(location.search);
			const thStr = sp.get('th');
			if (thStr){ const val = parseInt(thStr,10); if (isFinite(val)) currentThreshold = val/100; }
			const enc = sp.get('m');
			if (!enc) return; // nothing to decode
			let raw = enc.replace(/-/g,'+').replace(/_/g,'/');
			// pad base64
			while (raw.length %4) raw += '=';
			const decoded = decodeURIComponent(escape(atob(raw)));
			const parts = decoded.split('|');
			parts.forEach(p => {
				const [id,sym] = p.split(':');
				if (!id || !sym) return;
				if (unitStore.has(id)) applySymbol(unitStore.get(id), sym);
				else if (stateStore.has(id)) applySymbol(stateStore.get(id), sym);
			});
		} catch(e){ /* ignore */ }
	}

	function buildShareURL(){
		try { return encodeScenario(); }
		catch(e){ return location.href; }
	}

	// No-op during normal interactions; sharing happens only when user explicitly copies the share URL
	function refreshURL(){ /* intentionally empty: do not auto-write scenario to browser URL */ }

	const mapWrap = () => document.getElementById('map-wrap');
	const mapTip = () => document.getElementById('mapTip');

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

	function describeStatus(state){
		if (!state) return '';
		if (state.status === 'tossup') return 'Toss-up';
		const label = state.strength === 'safe' ? 'Safe' : 'Lean';
		const party = state.status === 'dem' ? 'D' : 'R';
		return `${label} ${party}`;
	}

	function colorForState(state){
		if (!state) return '#2f2f2f';
		if (state.status === 'tossup') return COLORS.tossup;
		if (state.status === 'dem') return state.strength === 'safe' ? COLORS.demSafe : COLORS.demLean;
		return state.strength === 'safe' ? COLORS.repSafe : COLORS.repLean;
	}

	function setText(id, value){
		const el = document.getElementById(id);
		if (el) el.textContent = value;
	}

	function classifyMargin(margin, threshold){
		if (!isFinite(margin)) return { status:'tossup', strength:'tossup' };
		const abs = Math.abs(margin);
		if (abs < tossupBand) return { status:'tossup', strength:'tossup' };
		const status = margin >= 0 ? 'dem' : 'rep';
		const strength = abs >= threshold ? 'safe' : 'lean';
		return { status, strength };
	}

	function updateStateColor(code){
		const state = stateStore.get(code);
		if (state && window.ElectionMap) {
			window.ElectionMap.setStateFill(code, colorForState(state));
		}
	}

	function updateUnitColor(unit){
		const u = unitStore.get(unit);
		if (!u || !window.ElectionMap) return;
		window.ElectionMap.setDistrictFill(unit, colorForState(u));
	}

	function updateAllStateColors(){
		stateStore.forEach((_, code) => updateStateColor(code));
	}

	function computePathCounts(demEV, repEV, tossups){
		if (!Array.isArray(tossups) || tossups.length === 0){
			return {
				demWins: demEV >= 270 ? 1 : 0,
				repWins: repEV >= 270 ? 1 : 0,
				ties: (demEV === 269 && repEV === 269) ? 1 : 0,
				total: 1,
				demPct: demEV >= 270 ? 1 : 0,
				repPct: repEV >= 270 ? 1 : 0
			};
		}
		let dp = new Map();
		dp.set(0, 1);
		const tossupTotal = tossups.reduce((acc, st) => acc + (st.ev || 0), 0);
		tossups.forEach(st => {
			const ev = st.ev || 0;
			const next = new Map();
			dp.forEach((count, sum) => {
				next.set(sum, (next.get(sum) || 0) + count); // assign to GOP
				const newSum = sum + ev;
				next.set(newSum, (next.get(newSum) || 0) + count); // assign to Dem
			});
			dp = next;
		});

		let demWins = 0, repWins = 0, ties = 0;
		dp.forEach((count, sum) => {
			const demTotal = demEV + sum;
			const repTotal = repEV + (tossupTotal - sum);
			if (demTotal >= 270 && repTotal < 270){
				demWins += count;
			} else if (repTotal >= 270 && demTotal < 270){
				repWins += count;
			} else if (demTotal === 269 && repTotal === 269){
				ties += count;
			} else if (demTotal >= 270 && repTotal >= 270){
				if (demTotal > repTotal) demWins += count;
				else if (repTotal > demTotal) repWins += count;
				else ties += count;
			} else {
				if (demTotal > repTotal) demWins += count;
				else if (repTotal > demTotal) repWins += count;
				else ties += count;
			}
		});

		const totalCombos = Math.pow(2, tossups.length);
		return {
			demWins,
			repWins,
			ties,
			total: totalCombos,
			demPct: totalCombos ? (demWins / totalCombos) : 0,
			repPct: totalCombos ? (repWins / totalCombos) : 0
		};
	}

	function updateSummary(){
		// Treat ALL non-safe (lean or tossup) states/units as contestable for path enumeration.
		let demEV = 0, repEV = 0, contestableEV = 0;
		const contestables = []; // variable items (lean + tossup)
		const statesWithUnits = new Set();
		unitStore.forEach(u => statesWithUnits.add(u.state));
		const buckets = { safeD:[], leanD:[], tossup:[], leanR:[], safeR:[] };

		stateStore.forEach(state => {
			if (statesWithUnits.has(state.state)) {
				(state.units||[]).forEach(u => {
					const uu = unitStore.get(u.unit); if(!uu) return;
					if (uu.status==='dem' && uu.strength==='safe') { demEV += uu.ev; buckets.safeD.push(uu); }
					else if (uu.status==='rep' && uu.strength==='safe') { repEV += uu.ev; buckets.safeR.push(uu); }
					else if (uu.status==='dem' && uu.strength!=='safe') { contestableEV += uu.ev; buckets.leanD.push(uu); contestables.push(uu); }
					else if (uu.status==='rep' && uu.strength!=='safe') { contestableEV += uu.ev; buckets.leanR.push(uu); contestables.push(uu); }
					else { // tossup
						contestableEV += uu.ev; buckets.tossup.push(uu); contestables.push(uu);
					}
				});
			} else {
				if (state.status==='dem' && state.strength==='safe') { demEV += state.ev; buckets.safeD.push(state); }
				else if (state.status==='rep' && state.strength==='safe') { repEV += state.ev; buckets.safeR.push(state); }
				else if (state.status==='dem' && state.strength!=='safe') { const norm=Object.assign({unit:state.state}, state); contestableEV += state.ev; buckets.leanD.push(state); contestables.push(norm); }
				else if (state.status==='rep' && state.strength!=='safe') { const norm=Object.assign({unit:state.state}, state); contestableEV += state.ev; buckets.leanR.push(state); contestables.push(norm); }
				else { const norm=Object.assign({unit:state.state}, state); contestableEV += state.ev; buckets.tossup.push(state); contestables.push(norm); }
			}
		});

		// Debug log
		try {
			console.debug('[possibilities] contestables:', contestables.map(c=>({id:c.unit||c.state, ev:c.ev, status:c.status, strength:c.strength})));
		} catch(e){}

		const demNeed = Math.max(0, 270 - demEV);
		const repNeed = Math.max(0, 270 - repEV);

		setText('demEV', formatNumber(demEV));
		setText('repEV', formatNumber(repEV));
	setText('contestableEV', formatNumber(contestableEV)); // renamed UI slot
		setText('demNeed', formatNumber(demNeed));
		setText('repNeed', formatNumber(repNeed));
	// contestableCount now counts all contestables
	setText('contestableCount', contestables.length.toString());

		const categoryConfig = [
			{ key:'safeD', evId:'cat-safeD-ev', countId:'cat-safeD-count', listId:'cat-safeD-list' },
			{ key:'leanD', evId:'cat-leanD-ev', countId:'cat-leanD-count', listId:'cat-leanD-list' },
			{ key:'tossup', evId:'cat-contestable-ev', countId:'cat-contestable-count', listId:'cat-contestable-list' },
			{ key:'leanR', evId:'cat-leanR-ev', countId:'cat-leanR-count', listId:'cat-leanR-list' },
			{ key:'safeR', evId:'cat-safeR-ev', countId:'cat-safeR-count', listId:'cat-safeR-list' }
		];
		categoryConfig.forEach(cfg => {
			const list = buckets[cfg.key] || [];
			const sum = list.reduce((acc, st) => acc + (st.ev || 0), 0);
			setText(cfg.evId, formatNumber(sum));
			setText(cfg.countId, list.length.toString());
			if (cfg.listId){
				const el = document.getElementById(cfg.listId);
				if (el) {
					const abbrs = list.map(item => (item.unit ? item.unit : item.state)).sort();
					el.textContent = abbrs.join(', ') || '—';
				}
			}
		});

		// Contestable lineup (unique by unit id), sorted by absolute margin (closest first)
		const lineup = Array.from(new Map(contestables.map(c=>[c.unit, c])).values())
			.sort((a,b)=>Math.abs(a.margin)-Math.abs(b.margin))
			.map(c=>`${c.unit} (${c.ev} EV)`)
			.join(', ');
		setText('contestableNames', lineup || '—');
		setText('contestableLineup', lineup || '—');

	const paths = computePathCounts(demEV, repEV, contestables);
		setText('pathDem', formatNumber(paths.demWins));
		setText('pathRep', formatNumber(paths.repWins));
		setText('pathTie', formatNumber(paths.ties));
		setText('pathTotal', formatNumber(paths.total));
		setText('pathDemPct', formatPercent(paths.demPct));
		setText('pathRepPct', formatPercent(paths.repPct));
		enumeratePaths(demEV, repEV, contestables);
		refreshDecorations();
		refreshURL();
		if (probabilisticMode && !probApplying) scheduleProbUpdate();
	}

	function cycleState(state){
		if (!state) return;
		if (state.baseStrength === 'safe' && !state.manual) return; // lock untouched safe
		// Direction-aware ring. Determine direction on first interaction from a lean state.
		// Forward (default / from leanD): leanD -> safeD -> safeR -> leanR -> tossup -> leanD
		// Reverse (from leanR):         leanR -> safeR -> safeD -> leanD -> tossup -> leanR
		// We store state.cycleReverse boolean.
		if (state.cycleReverse === undefined){
			if (state.status === 'rep' && state.strength === 'lean') state.cycleReverse = true; // start reversed
			else state.cycleReverse = false; // default forward (leanD or anything else)
		}
		const forward = [
			{status:'dem', strength:'lean'},
			{status:'dem', strength:'safe'},
			{status:'rep', strength:'safe'},
			{status:'rep', strength:'lean'},
			{status:'tossup', strength:'tossup'}
		];
		const reverse = [
			{status:'rep', strength:'lean'},
			{status:'rep', strength:'safe'},
			{status:'dem', strength:'safe'},
			{status:'dem', strength:'lean'},
			{status:'tossup', strength:'tossup'}
		];
		const ring = state.cycleReverse ? reverse : forward;
		// Find current index
		let idx = ring.findIndex(r => r.status === state.status && r.strength === state.strength);
		if (idx === -1){
			// If current combo not on ring (e.g., unexpected), normalize to tossup
			idx = ring.findIndex(r => r.status === 'tossup');
		}
		const next = ring[(idx + 1) % ring.length];
		state.status = next.status;
		state.strength = next.strength;
		state.manual = (state.status !== state.baseStatus) || (state.strength !== state.baseStrength);
	}

	function handleStateClick(code, event){
		const state = stateStore.get(code);
		if (!state) return;
		if (state.baseStrength === 'safe' && !state.manual) return; // locked safe state
		if (event && event.shiftKey){
			state.status = 'tossup';
			state.strength = 'tossup';
			state.manual = state.baseStatus !== 'tossup' || state.baseStrength !== 'tossup';
		} else {
			cycleState(state);
		}
		// propagate to units in this state
		(state.units || []).forEach(u => {
			const unit = unitStore.get(u.unit);
			if (!unit) return;
			unit.status = state.status;
			if (state.strength === 'safe') {
				// Force unit safe to remove from contestables regardless of its base classification
				unit.strength = 'safe';
			} else if (state.strength === 'tossup') {
				unit.strength = 'tossup';
			} else {
				unit.strength = (unit.baseStatus === unit.status && unit.baseStrength !== 'tossup') ? unit.baseStrength : 'lean';
			}
			unit.manual = (unit.status !== unit.baseStatus) || (unit.strength !== unit.baseStrength);
			updateUnitColor(u.unit);
		});
		updateStateColor(code);
		updateSummary();
	}

	function handleDistrictClick(unit, event){
		const u = unitStore.get(unit);
		if (!u) return;
		const stObj = stateStore.get(u.state);
		// Lock districts only if the unit itself is base-safe and untouched. This allows NE/ME districts
		// to be toggled even when the parent state base is safe.
		if (u.baseStrength === 'safe' && !u.manual) return;
		if (event && event.shiftKey){
			u.status = 'tossup';
			u.strength = 'tossup';
			u.manual = u.baseStatus !== 'tossup' || u.baseStrength !== 'tossup';
		} else {
			// Use the same cycle logic as states so districts behave identically
			cycleState(u);
		}
		updateUnitColor(unit);
		// Reflect a heuristic aggregated state status: if any unit tossup -> state tossup; else majority status by EV with base strengths
		const st = u.state;
		const state = stateStore.get(st);
		if (state) {
			const units = state.units || [];
			let demEv=0, repEv=0, tossEv=0;
			units.forEach(x => {
				const uu = unitStore.get(x.unit);
				if (!uu) return; if (uu.status==='dem') demEv+=uu.ev; else if (uu.status==='rep') repEv+=uu.ev; else tossEv+=uu.ev;
			});
			if (tossEv>0) { state.status='tossup'; state.strength='tossup'; }
			else if (demEv>repEv) { state.status='dem'; state.strength='lean'; }
			else if (repEv>demEv) { state.status='rep'; state.strength='lean'; }
			state.manual = true;
			updateStateColor(st);
		}
		updateSummary();
	}

	function refreshDecorations(){
		if (!window.ElectionMap) return;
		const evLookup = (abbr) => {
			// abbr may be unit like ME-01 or state
			if (unitStore.has(abbr)) return unitStore.get(abbr).ev;
			if (stateStore.has(abbr)) return stateStore.get(abbr).ev;
			if (abbr){ const st = stateStore.get(abbr); return st? st.ev : null; }
			return null;
		};
		const abbrColors = new Map();
		stateStore.forEach(st => { abbrColors.set(st.state, { color: colorForState(st) }); });
		const unitColors = new Map();
		unitStore.forEach(u => { unitColors.set(u.unit, colorForState(u)); });
		window.ElectionMap.refreshDecorations(2028, evLookup, abbrColors, unitColors);
	}

	function enumeratePaths(demBaseEV, repBaseEV, tossupUnits){
		const noteEl = document.getElementById('pathEnumerationNote');
		const demList = document.getElementById('demPathsList');
		const repList = document.getElementById('repPathsList');
		const tieList = document.getElementById('tiePathsList');
		if (!noteEl || !demList || !repList || !tieList) return;
		const n = tossupUnits.length;
		const key = `${demBaseEV}|${repBaseEV}|`+tossupUnits.map(t=>`${t.unit}:${t.ev}`).join(',');
		if (lastEnumerated.key === key) return; // already enumerated this lineup & bases
		lastEnumerated.key = key;
		// clear existing
		demList.innerHTML = '';
		repList.innerHTML = '';
		tieList.innerHTML = '';
		if (n===0){ noteEl.textContent = 'No contestables to enumerate.'; lastEnumerated.data = { dem:[], rep:[], ties:[] }; return; }
		if (n > HARD_ENUMERATION_CAP){ noteEl.textContent = `Too many contestables (${n}) to enumerate (cap ${HARD_ENUMERATION_CAP}). Reduce contestables or download counts only.`; lastEnumerated.data=null; return; }
		const fullCount = 1<<n; // n <= 18 safe in JS bitwise
		if (n > ENUMERATION_LIMIT){ noteEl.textContent = `Contestables: ${n}. Full combinations: ${fullCount.toLocaleString()}. Showing a random sample of 256.`; }
		else { noteEl.textContent = `Enumerating ${fullCount.toLocaleString()} combinations across contestables.`; }
		const demPaths = []; const repPaths = []; const tiePaths = [];
		// Build arrays for fast iteration
		const evs = tossupUnits.map(t=>t.ev||0);
		const names = tossupUnits.map(t=>t.unit);
		const tossupTotal = evs.reduce((a,b)=>a+b,0);
		const sampleLimit = 256;
		for (let mask=0; mask<fullCount; mask++){
			if (n>ENUMERATION_LIMIT && demPaths.length+repPaths.length+tiePaths.length >= sampleLimit) break;
			let demAdd=0; // EV from tossups to Dem in this mask
			for (let i=0;i<n;i++){ if (mask & (1<<i)) demAdd += evs[i]; }
			const demTotal = demBaseEV + demAdd;
			const repTotal = repBaseEV + (tossupTotal - demAdd);
			const assignList = [];
			let leanMatchEv = 0; // EV-weighted score for matching current lean direction
			for (let i=0;i<n;i++){
				const assignedToDem = !!(mask & (1<<i));
				assignList.push(`${names[i]}=${ assignedToDem ? 'D' : 'R' }`);
				// weight matches for units that are currently lean (not tossup)
				const unitObj = tossupUnits[i];
				if (unitObj && unitObj.strength === 'lean'){
					// unitObj.status is 'dem' or 'rep'
					const leanIsDem = unitObj.status === 'dem';
					if ((leanIsDem && assignedToDem) || (!leanIsDem && !assignedToDem)) {
						leanMatchEv += (evs[i] || 0);
					}
				}
			}
			const pathStr = assignList.join(' ');
			if (demTotal>=270 && repTotal<270) demPaths.push({ path:pathStr, dem:demTotal, rep:repTotal, leanMatchEv });
			else if (repTotal>=270 && demTotal<270) repPaths.push({ path:pathStr, dem:demTotal, rep:repTotal, leanMatchEv });
			else if (demTotal===269 && repTotal===269) tiePaths.push({ path:pathStr, dem:demTotal, rep:repTotal, leanMatchEv });
			else {
				if (demTotal>repTotal) demPaths.push({ path:pathStr, dem:demTotal, rep:repTotal, leanMatchEv });
				else if (repTotal>demTotal) repPaths.push({ path:pathStr, dem:demTotal, rep:repTotal, leanMatchEv });
				else tiePaths.push({ path:pathStr, dem:demTotal, rep:repTotal, leanMatchEv });
			}
		}
		// Helper to render
		const render = (listEl, arr) => {
			arr.slice(0,512).sort((a,b)=> {
				// Prefer scenarios that match current lean directions (higher leanMatchEv first)
				const la = (b.leanMatchEv || 0) - (a.leanMatchEv || 0);
				if (la !== 0) return la;
				// fallback to dem total then rep total ordering
				if (a.dem !== b.dem) return a.dem - b.dem;
				return a.rep - b.rep;
			}).forEach(obj => {
				const li = document.createElement('li');
				const card = document.createElement('div');
				card.className = 'path-card';
				const row = document.createElement('div'); row.className='row';
				const assigns = obj.path.split(/\s+/).filter(Boolean);
				const dStates = assigns.filter(p=>p.endsWith('=D')).map(p=>p.split('=')[0]);
				const rStates = assigns.filter(p=>p.endsWith('=R')).map(p=>p.split('=')[0]);
				const dDiv = document.createElement('div'); dDiv.className='dlist'; dDiv.textContent = 'D: ' + (dStates.join(' ')||'—');
				const rDiv = document.createElement('div'); rDiv.className='rlist'; rDiv.textContent = 'R: ' + (rStates.join(' ')||'—');
				const evDiv = document.createElement('div'); evDiv.className='evs'; evDiv.textContent = `${obj.dem}D – ${obj.rep}R`;
				row.appendChild(dDiv); row.appendChild(rDiv); row.appendChild(evDiv);
				card.appendChild(row);
				li.appendChild(card);
				listEl.appendChild(li);
			});
		};
		render(demList, demPaths);
		render(repList, repPaths);
		render(tieList, tiePaths);
		lastEnumerated.data = { dem:demPaths, rep:repPaths, ties:tiePaths, sampled:(n>ENUMERATION_LIMIT) };
	}

	function downloadAllPaths(){
		if (!lastEnumerated.data){ alert('Nothing enumerated yet.'); return; }
		const rows = ['winner,path,dem_total,rep_total'];
		['dem','rep','ties'].forEach(cat => {
			const label = cat==='ties'? 'tie': cat;
			(lastEnumerated.data[cat]||[]).forEach(p => {
				rows.push(`${label},"${p.path}",${p.dem},${p.rep}`);
			});
		});
		const blob = new Blob([rows.join('\n')], { type:'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url; a.download = 'paths_enumerated.csv';
		document.body.appendChild(a); a.click(); a.remove();
		setTimeout(()=>URL.revokeObjectURL(url), 5000);
	}

	function copyShareURL(){
		try {
			const url = buildShareURL();
			navigator.clipboard.writeText(url);
		} catch(e) { /* ignore */ }
	}

	function scheduleProbUpdate(){
		// debounce style simple scheduling
		clearTimeout(scheduleProbUpdate._t);
		scheduleProbUpdate._t = setTimeout(runProbabilisticMode, 60);
	}

	function runProbabilisticMode(){
		if (!probabilisticMode) return;
		applyBayesFromManualPicks();
		bayesRenderProbs();
	}

	function applyProbResults(res){
		if (!res) return; const { accepted, tried, demWins, repWins, ties, perState, runtime } = res;
		const accRate = tried ? accepted / tried : 0;
		setText('probAccepted', accepted.toString());
		setText('probTotalTried', tried.toString());
		setText('probAcceptRate', (accRate*100).toFixed(1)+'%');
		setText('probDemWin', accepted? (demWins/accepted*100).toFixed(1)+'%' : '—');
		setText('probRepWin', accepted? (repWins/accepted*100).toFixed(1)+'%' : '—');
		setText('probTie', accepted? (ties/accepted*100).toFixed(2)+'%' : '—');
		setText('probRuntime', Math.round(runtime)+'ms');
		// Salt meter: -log10(acceptance rate)
		let salt = accRate>0 ? -Math.log10(accRate) : SALT_CAP;
		if (salt > SALT_CAP) salt = SALT_CAP;
		setText('saltScore', salt.toFixed(2));
		const fill = document.getElementById('saltBarFill'); if (fill) fill.style.width = Math.min(100, salt / SALT_CAP * 100)+'%';
		const list = document.getElementById('probPerState');
		if (list){
			list.innerHTML = '';
			// Ensure uniqueness by ID (defensive, though perState already unique)
			const sorted = [...perState].sort((a,b)=> b.pDem - a.pDem);
			sorted.forEach(ps => {
				const li = document.createElement('li');
				li.textContent = `${ps.id}: ${(ps.pDem*100).toFixed(1)}% Dem (n=${ps.sims})`;
				list.appendChild(li);
			});
		}
		// Auto-color contestables based on probability thresholds if mode active
		if (probabilisticMode && accepted > 0){
			probApplying = true;
			try {
				perState.forEach(ps => {
					const id = ps.id;
					const obj = unitStore.get(id) || stateStore.get(id);
					if (!obj) return;
					// Skip if base safe and untouched manual? we only recolor non-safe base categories
					if (obj.baseStrength === 'safe' && !obj.manual) return;
					let newStatus='tossup', newStrength='tossup';
					if (ps.pDem >= 0.55){ newStatus='dem'; newStrength='lean'; }
					else if (ps.pDem <= 0.45){ newStatus='rep'; newStrength='lean'; }
					// Only update if changed from current prob-driven classification (avoid thrash)
					if (obj.status !== newStatus || obj.strength !== newStrength){
						obj.status = newStatus; obj.strength = newStrength;
						// Mark as probabilistic (not strictly user manual). Keep manual false so reset works cleanly.
						obj.probAuto = true;
						if (unitStore.has(id)) updateUnitColor(id); else if (stateStore.has(id)) updateStateColor(id);
					}
				});
				// After recoloring update summary without triggering another immediate probability run
				updateSummary();
			} finally { probApplying = false; }
		}
		const statusEl = document.getElementById('probModeStatus');
		if (statusEl) statusEl.textContent = `Conditional simulations complete. Acceptance ${ (accRate*100).toFixed(1) }%.`;
	}

	function randNormal(mean, std){
		let u=0, v=0; while(u===0) u=Math.random(); while(v===0) v=Math.random();
		const mag = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2*Math.PI*v);
		return mean + std * mag;
	}

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
		const statusLabel = describeStatus(state);
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
		tip.textContent = `${name} · ${state.ev} EV · ${formatMargin(state.margin)} · ${statusLabel}` + (state.manual ? ' · manual' : '') + extraO;
		tip.style.display = 'block';
		positionTip(evt);
	}

	function handleDistrictHover(evt, unit){
		const u = unitStore.get(unit);
		if (!u) return;
		const tip = mapTip(); if (!tip) return;
		const name = `${STATE_NAMES[u.state] || u.state} ${unit.endsWith('-AL')? 'AL' : unit.split('-')[1]}`;
		const statusLabel = describeStatus(u);
		tip.textContent = `${unit} · ${u.ev} EV · ${formatMargin(u.margin)} · ${statusLabel}` + (u.manual ? ' · manual' : '');
		tip.style.display = 'block';
		positionTip(evt);
	}

	function hideTip(){
		const tip = mapTip();
		if (tip) tip.style.display = 'none';
	}

	function resetToBase(){
		// Always reset to the canonical default threshold regardless of prior reclassifies
		currentThreshold = DEFAULT_THRESHOLD;
		applyClassification(DEFAULT_THRESHOLD, { resetManual: true });
		// update slider UI if present
		const slider = document.getElementById('thresholdSlider');
		const valueEl = document.getElementById('thresholdValue');
		if (slider) slider.value = Math.round(DEFAULT_THRESHOLD * 100).toString();
		if (valueEl) valueEl.textContent = `${Math.round(DEFAULT_THRESHOLD * 100)}%`;
		// Clear any encoded scenario from the URL (leave only the pathname)
		try { history.replaceState(null, '', location.pathname); } catch(e) { /* ignore */ }
	}

	function applyClassification(threshold, opts){
		currentThreshold = threshold;
		tossupBand = Math.min(currentThreshold / 2, 0.025);
		stateStore.forEach(state => {
			const cls = classifyMargin(state.margin, currentThreshold);
			state.baseStatus = cls.status;
			state.baseStrength = cls.strength;
			if (!opts || opts.resetManual){
				state.status = cls.status;
				state.strength = cls.strength;
				state.manual = false;
			} else if (!state.manual){
				state.status = cls.status;
				state.strength = cls.strength;
			}
			// apply to units
			(state.units || []).forEach(u => {
				const uu = unitStore.get(u.unit); if (!uu) return;
				const ucls = classifyMargin(uu.margin, currentThreshold);
				uu.baseStatus = ucls.status; uu.baseStrength = ucls.strength;
				if (!opts || opts.resetManual){ uu.status = ucls.status; uu.strength = ucls.strength; uu.manual = false; }
				else if (!uu.manual){ uu.status = ucls.status; uu.strength = ucls.strength; }
				updateUnitColor(uu.unit);
			});
		});
		updateAllStateColors();
		updateSummary();
	}

	function buildStateData(rows2024){
		stateStore.clear();
		unitStore.clear();
		const byState = new Map();
		(rows2024 || []).forEach(row => {
			if (!row || !row.abbr || row.abbr === 'NATIONAL') return;
			const unit = row.abbr;
			const stateCode = unit.includes('-') ? unit.slice(0, 2) : unit;
			const ev = +row.ev || +row.electoral_votes;
			if (!isFinite(ev) || ev <= 0) return;
			const margin = parseFloat(row.margin != null ? row.margin : row.relative_margin);
			if (!byState.has(stateCode)) byState.set(stateCode, { state: stateCode, units: [], evTotal: 0, weightedMargin: 0 });
			const entry = byState.get(stateCode);
			entry.units.push({ unit, ev, margin });
			entry.evTotal += ev;
			if (isFinite(margin)) entry.weightedMargin += margin * ev;
			// unit-level record
			unitStore.set(unit, {
				unit, state: stateCode, ev, margin,
				status: 'tossup', strength: 'tossup', baseStatus: 'tossup', baseStrength: 'tossup', manual: false
			});
		});

		byState.forEach(entry => {
			const totalEv = entry.evTotal || 0;
			const margin = totalEv > 0 ? (entry.weightedMargin / totalEv) : 0;
			stateStore.set(entry.state, {
				state: entry.state,
				ev: totalEv,
				margin,
				units: entry.units,
				status: 'tossup',
				strength: 'tossup',
				baseStatus: 'tossup',
				baseStrength: 'tossup',
				manual: false
			});
		});

		try {
			const totalEv = Array.from(stateStore.values()).reduce((sum, st) => sum + (st.ev || 0), 0);
			console.log(`[possibilities] loaded ${stateStore.size} states covering ${totalEv} EV`);
		} catch (e) {/* dev log only */}
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
				mousemove: (evt) => { positionTip(evt); },
				mouseleave: () => { hideTip(); }
			},
			districtHandlers: {
				click: (evt, unit) => { if (!unitStore.has(unit)) return; handleDistrictClick(unit, evt); },
				mouseenter: (evt, unit) => { if (!unitStore.has(unit)) return; handleDistrictHover(evt, unit); },
				mousemove: (evt) => { positionTip(evt); },
				mouseleave: () => { hideTip(); }
			}
		});
		// bridge ElectionMap statePaths map for local updates
		if (window.ElectionMap && window.ElectionMap.statePaths) {
			window.ElectionMap.statePaths.forEach((sel, abbr) => statePaths.set(abbr, sel));
		}
	}

	function initControls(){
		const slider = document.getElementById('thresholdSlider');
		const valueEl = document.getElementById('thresholdValue');
		if (slider && valueEl){
			slider.value = Math.round(currentThreshold * 100).toString();
			valueEl.textContent = `${slider.value}%`;
			slider.addEventListener('input', () => {
				valueEl.textContent = `${slider.value}%`;
			});
		}
		const applyBtn = document.getElementById('applyThreshold');
		if (applyBtn && slider){
			applyBtn.addEventListener('click', () => {
				const val = parseFloat(slider.value);
				if (!isNaN(val)) applyClassification(val / 100, { resetManual: true });
			});
		}
		const resetBtn = document.getElementById('resetStates');
		if (resetBtn) resetBtn.addEventListener('click', resetToBase);
		const dlBtn = document.getElementById('downloadPaths');
		if (dlBtn) dlBtn.addEventListener('click', downloadAllPaths);
		const copyBtn = document.getElementById('copyShareURL');
		if (copyBtn) copyBtn.addEventListener('click', copyShareURL);
		const probCheckbox = document.getElementById('enableProbMode');
		if (probCheckbox){
			probCheckbox.addEventListener('change', () => {
				probabilisticMode = probCheckbox.checked;
				const statusEl = document.getElementById('probModeStatus');
				const resultsWrap = document.getElementById('probResults');
				if (probabilisticMode){
					if (statusEl) statusEl.textContent = 'Enabled. Running initial simulations…';
					if (resultsWrap) resultsWrap.style.display = 'block';
					scheduleProbUpdate();
				} else {
					if (statusEl) statusEl.textContent = 'Disabled. Check the box to generate approximate win probabilities.';
					if (resultsWrap) resultsWrap.style.display = 'none';
				}
			});
		}
	}

	// ==========================
// BAYESIAN ENGINE (Gaussian)
// ==========================

let BAYES = {
  ready: false,
  VAR_UNITS: [],
  IDX: new Map(),
  r2024: new Map(),
  EV: new Map(),
  mu: null,
  Sigma: null,
  mu0: null,
  Sigma0: null,
  sigmaObs: 0.010,   // 1.0pp
  kappaBlue: 0.008,  // +0.8pp slack
  kappaRed: -0.008,  // -0.8pp slack
  salt: 0
};

// Custom implementation of the error function (erf)
Math.erf = Math.erf || function(x) {
	const sign = x >= 0 ? 1 : -1;
	x = Math.abs(x);
	const a1 =  0.254829592;
	const a2 = -0.284496736;
	const a3 =  1.421413741;
	const a4 = -1.453152027;
	const a5 =  1.061405429;
	const p  =  0.3275911;

	const t = 1 / (1 + p * x);
	const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
	return sign * y;
};

function phiStd(x){ return 0.5 * (1 + Math.erf(x / Math.SQRT2)); }

function kalmanUpdate(mu, Sigma, a, bPlusKappa, sigma){
  const n = mu.length;
  // S = aᵀ Σ a + σ²
  let Sa = 0;
  for (let i=0;i<n;i++){
    let rowDot = 0;
    for (let j=0;j<n;j++) rowDot += Sigma[i][j] * a[j];
    Sa += a[i]*rowDot;
  }
  const S = Sa + sigma*sigma;
  // K = Σ a / S
  const K = new Array(n).fill(0);
  for (let i=0;i<n;i++){
    let dot = 0;
    for (let j=0;j<n;j++) dot += Sigma[i][j]*a[j];
    K[i] = dot / S;
  }
  // innovation
  let aTmu = 0; for (let i=0;i<n;i++) aTmu += a[i]*mu[i];
  const innov = bPlusKappa - aTmu;
  // mu' = mu + K*innov
  const muNew = mu.slice();
  for (let i=0;i<n;i++) muNew[i] += K[i]*innov;
  // Σ' = Σ - K (aᵀ Σ)
  const SigmaNew = Sigma.map(r=>r.slice());
  for (let i=0;i<n;i++){
    let aTSigmaRow = 0;
    for (let j=0;j<n;j++) aTSigmaRow += a[j]*Sigma[j][i];
    for (let j=0;j<n;j++){
      SigmaNew[i][j] -= K[i]*(aTSigmaRow||0);
    }
  }
  return { mu: muNew, Sigma: SigmaNew };
}

function buildBayesPrior(tsById, evById, r2024ById){
  const ids = [...tsById.keys()];
  const deltasById = new Map();
  let cycles = null;
  ids.forEach(id=>{
    const arr = tsById.get(id)||[];
    const del = [];
    for (let t=1;t<arr.length;t++){
      const a = parseFloat(arr[t]), b = parseFloat(arr[t-1]);
      del.push((isFinite(a)&&isFinite(b)) ? (a-b) : 0);
    }
    deltasById.set(id, del);
    if (cycles===null) cycles = del.length;
  });
  // national swing = median delta across ids
  const natSwing = new Array(cycles).fill(0);
  for (let t=0;t<cycles;t++){
    const vals = ids.map(id=>deltasById.get(id)[t]).filter(Number.isFinite).sort((a,b)=>a-b);
    natSwing[t] = vals.length? vals[(vals.length>>1)] : 0;
  }
  const meanNS = natSwing.reduce((a,b)=>a+b,0)/(natSwing.length||1);
  const varNS = natSwing.reduce((a,b)=>a+(b-meanNS)*(b-meanNS),0)/Math.max(1, natSwing.length-1);
  const sigmaG = Math.sqrt(Math.max(1e-6, varNS));
  // residual sd per id
  const sigmaEps = new Map();
  ids.forEach(id=>{
    const del = deltasById.get(id)||[];
    let s2=0,n=0;
    for (let t=0;t<del.length;t++){
      const res = del[t] - natSwing[t];
      if (isFinite(res)){ s2+=res*res; n++; }
    }
    sigmaEps.set(id, Math.sqrt(n>1? s2/(n-1) : 0.0001));
  });
  const sigmaPV = 0.025; // 2.5pp
  const sigmaPV_resid = Math.max(1e-6, Math.sqrt(Math.max(0, sigmaPV*sigmaPV - sigmaG*sigmaG)));
  // variable order
  const VAR_UNITS = ids.slice().sort();
  const D = 1 + VAR_UNITS.length;
  const IDX = new Map([['PV',0]]);
  VAR_UNITS.forEach((id,i)=>IDX.set(id,1+i));
  // Σ
  const Sigma = Array.from({length:D},()=>Array(D).fill(0));
  Sigma[0][0] = sigmaG*sigmaG + sigmaPV_resid*sigmaPV_resid;
  for (let i=0;i<VAR_UNITS.length;i++){
    const id = VAR_UNITS[i]; const si = 1+i;
    const se = sigmaEps.get(id)||0.01;
    Sigma[0][si] = Sigma[si][0] = sigmaG*sigmaG;
    Sigma[si][si] = sigmaG*sigmaG + se*se;
    for (let j=i+1;j<VAR_UNITS.length;j++){
      const sj = 1+j;
      Sigma[si][sj] = Sigma[sj][si] = sigmaG*sigmaG;
    }
  }
  const mu = new Array(D).fill(0);
  BAYES.ready = true;
  BAYES.VAR_UNITS = VAR_UNITS;
  BAYES.IDX = IDX;
  BAYES.mu = mu.slice(); BAYES.Sigma = Sigma.map(r=>r.slice());
  BAYES.mu0 = mu.slice(); BAYES.Sigma0 = Sigma.map(r=>r.slice());
  BAYES.EV = evById;
  BAYES.r2024 = r2024ById;
  BAYES.salt = 0;
}

function bayesResetPosterior(){
  if (!BAYES.ready) return;
  BAYES.mu = BAYES.mu0.slice();
  BAYES.Sigma = BAYES.Sigma0.map(r=>r.slice());
  BAYES.salt = 0;
}

function bayesObservePick(id, color){
  if (!BAYES.ready) return;
  const idx = BAYES.IDX.get(id);
  if (idx==null) return;
  const a = new Array(BAYES.mu.length).fill(0);
  a[0]=1; a[idx]=1; // PV + Δ_id
  const r = BAYES.r2024.get(id)||0;
  const b = -r;
  const kappa = (color==='dem') ? BAYES.kappaBlue : BAYES.kappaRed;
  const out = kalmanUpdate(BAYES.mu, BAYES.Sigma, a, b+kappa, BAYES.sigmaObs);
  BAYES.mu = out.mu; BAYES.Sigma = out.Sigma;
  BAYES.salt += 0.05;
}

function bayesProbDem(id){
  if (!BAYES.ready) return 0.5;
  const idx = BAYES.IDX.get(id);
  if (idx==null) { const r = BAYES.r2024.get(id)||0; return r>0 ? 0.99 : 0.01; }
  const a = new Array(BAYES.mu.length).fill(0); a[0]=1; a[idx]=1;
  let mean=0; for (let i=0;i<a.length;i++) mean += a[i]*BAYES.mu[i];
  let varv=0;
  for (let i=0;i<a.length;i++){
    let rowDot=0; for (let j=0;j<a.length;j++) rowDot += BAYES.Sigma[i][j]*a[j];
    varv += a[i]*rowDot;
  }
  const r = BAYES.r2024.get(id)||0;
  const z = (mean + r) / Math.sqrt(Math.max(1e-9, varv));
  return phiStd(z);
}

async function loadHistoryAndBuildPrior(){
  const rows = await d3.csv('presidential_margins.csv', row => {
    const yr = +row.year;
    if (!row.abbr) return null;
    if (!isFinite(yr) || yr < 2000) return null;
    return {
      year: yr,
      id: row.abbr,
      rel: parseFloat(row.relative_margin),
      ev: parseInt(row.electoral_votes || row.electoral_Votes || row.ev, 10)
    };
  });
  const byId = new Map();
  const evById = new Map();
  rows.forEach(r=>{
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push([r.year, r.rel]);
    if (isFinite(r.ev) && !evById.has(r.id)) evById.set(r.id, r.ev);
  });
  byId.forEach(arr=>arr.sort((a,b)=>a[0]-b[0]));
  const tsById = new Map();
  byId.forEach((arr,id)=> tsById.set(id, arr.map(x=> (isFinite(x[1])? x[1] : 0))));
  // r2024 from stores (built by buildStateData)
  const r2024ById = new Map();
  stateStore.forEach(st=> r2024ById.set(st.state, st.margin));
  unitStore.forEach(u => r2024ById.set(u.unit, u.margin));
  buildBayesPrior(tsById, evById, r2024ById);
}

function bayesCurrentContestables(){
  const ids = []; const seen = new Set();
  stateStore.forEach(st=>{
    if (st.units && st.units.length>1) return;
    if (st.status==='tossup' || st.strength!=='safe'){
      if (!seen.has(st.state)){ ids.push(st.state); seen.add(st.state); }
    }
  });
  unitStore.forEach(u=>{
    if (u.status==='tossup' || u.strength!=='safe'){
      if (!seen.has(u.unit)){ ids.push(u.unit); seen.add(u.unit); }
    }
  });
  return ids.sort();
}

function applyBayesFromManualPicks(){
  if (!BAYES.ready) return;
  bayesResetPosterior();
  const addObs = (id, status, strength) => {
    if (strength==='tossup') return;
    const color = (status==='dem') ? 'dem' : (status==='rep' ? 'rep' : null);
    if (color) bayesObservePick(id, color);
  };
  stateStore.forEach(st=>{
    const hasUnits = st.units && st.units.length>1;
    if (!hasUnits) addObs(st.state, st.status, st.strength);
  });
  unitStore.forEach(u=> addObs(u.unit, u.status, u.strength));
}

function bayesRenderProbs(){
  const statusEl = document.getElementById('probModeStatus');
  const resultsWrap = document.getElementById('probResults');
  if (!statusEl || !resultsWrap) return;
  statusEl.textContent = 'Bayesian mode active (fast updates).';
  resultsWrap.style.display = 'block';
  const ids = bayesCurrentContestables();
  const per = ids.map(id => ({ id, pDem: bayesProbDem(id) }));
  const list = document.getElementById('probPerState');
  if (list){
    list.innerHTML='';
    per.sort((a,b)=>b.pDem-a.pDem).forEach(ps=>{
      const li = document.createElement('li');
      li.textContent = `${ps.id}: ${(ps.pDem*100).toFixed(1)}% Dem`;
      list.appendChild(li);
    });
  }
  // recolor leans for contestables (do not override untouched safe)
  probApplying = true;
  try{
    per.forEach(ps=>{
      const obj = unitStore.get(ps.id) || stateStore.get(ps.id);
      if (!obj) return;
      if (obj.baseStrength==='safe' && !obj.manual) return;
      let newStatus='tossup', newStrength='tossup';
      if (ps.pDem >= 0.55){ newStatus='dem'; newStrength='lean'; }
      else if (ps.pDem <= 0.45){ newStatus='rep'; newStrength='lean'; }
      if (obj.status!==newStatus || obj.strength!==newStrength){
        obj.status=newStatus; obj.strength=newStrength; obj.probAuto=true;
        if (unitStore.has(ps.id)) updateUnitColor(ps.id); else if (stateStore.has(ps.id)) updateStateColor(ps.id);
      }
    });
    updateSummary();
  } finally { probApplying=false; }
  // Stats panel
  setText('probAccepted','—'); setText('probTotalTried','—');
  setText('probAcceptRate','—'); setText('probDemWin','—');
  setText('probRepWin','—'); setText('probTie','—'); setText('probRuntime','≈0ms');
  const SALT_CAP = 5;
  const fill = document.getElementById('saltBarFill');
  const salt = Math.min(SALT_CAP, BAYES.salt);
  setText('saltScore', salt.toFixed(2));
  if (fill) fill.style.width = Math.min(100, salt/SALT_CAP*100)+'%';
}

async function init(){
		initControls();
		try {
			const rows2024 = await d3.csv('presidential_margins.csv', row => {
					// Use 2024 results only; ignore NATIONAL aggregate
					if (+row.year !== 2024) return null;
					if (!row.abbr || row.abbr === 'NATIONAL') return null;
					const ev = parseInt(row.electoral_votes || row.electoral_Votes || row.ev, 10);
					if (!isFinite(ev) || ev <= 0) return null;
					// Prefer relative_margin for classification per requirements
					const margin = parseFloat(row.relative_margin);
					return { abbr: row.abbr, ev, margin };
				});

			buildStateData(rows2024);
			await loadHistoryAndBuildPrior();
			await buildMap();
			applyClassification(currentThreshold, { resetManual: true });
			// Initial paint for districts that exist
			unitStore.forEach(u => updateUnitColor(u.unit));
			// decode scenario after base classification so manual overrides apply
			decodeScenarioFromURL();
			updateAllStateColors(); unitStore.forEach(u=>updateUnitColor(u.unit));
			updateSummary(); // triggers enumeration + URL encoding
		} catch (err){
			console.error('[possibilities] failed to initialise', err);
		}
	}

	document.addEventListener('DOMContentLoaded', init);
})();
