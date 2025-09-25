const FIPS_TO_ABBR = {
  "01": "AL","02": "AK","04": "AZ","05": "AR","06": "CA","08": "CO","09": "CT","10": "DE","11": "DC","12": "FL","13": "GA","15": "HI","16": "ID","17": "IL","18": "IN","19": "IA","20": "KS","21": "KY","22": "LA","23": "ME","24": "MD","25": "MA","26": "MI","27": "MN","28": "MS","29": "MO","30": "MT","31": "NE","32": "NV","33": "NH","34": "NJ","35": "NM","36": "NY","37": "NC","38": "ND","39": "OH","40": "OK","41": "OR","42": "PA","44": "RI","45": "SC","46": "SD","47": "TN","48": "TX","49": "UT","50": "VT","51": "VA","53": "WA","54": "WV","55": "WI","56": "WY"
};

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"
};

const SMALL_STATE_LIST = [
  { unit: "ME-AL", label: "ME-AL" },
  { unit: "NE-AL", label: "NE-AL" },
  { unit: "NH", label: "NH" },
  { unit: "VT", label: "VT" },
  { unit: "MA", label: "MA" },
  { unit: "RI", label: "RI" },
  { unit: "CT", label: "CT" },
  { unit: "NJ", label: "NJ" },
  { unit: "DE", label: "DE" },
  { unit: "MD", label: "MD" },
  { unit: "DC", label: "DC" }
];

const SMALL_STATES_SET = new Set(["MA","RI","CT","NJ","DE","MD","DC","NH","VT"]);
const DISTRICT_STATES = new Set(["ME","NE"]);

const manualLocks = new Map(); // unit -> 'neutral'|'blue'|'red'
const unitModels = new Map();  // actual EV-carrying units (states + ME/NE districts)
const stateModels = new Map(); // aggregated per-two-letter state models (for labels, fills)
let unitStats = new Map();
let stateStats = new Map();
let stateEvTotals = new Map();
let togglableUnits = new Set();
let totalEV = 538;

let mapPaths = new Map();
let districtPaths = new Map();
let labelLayer = null;
let smallBoxesLayer = null;
let mapProjection = null;
let mapPathGenerator = null;

const thresholdInput = document.getElementById("thresholdInput");
const thresholdValue = document.getElementById("thresholdValue");
const lockMarginInput = document.getElementById("lockMarginInput");
const sigmaFloorInput = document.getElementById("sigmaFloorInput");
const resetLocksBtn = document.getElementById("resetLocks");
const stateGridEl = document.getElementById("stateGrid");
const bucketTableBody = document.getElementById("bucketTable");
const evSummaryEl = document.getElementById("evSummary");
const evTextEl = document.getElementById("evText");
const evFillBlueEl = document.getElementById("evFillBlue");
const evFillRedEl = document.getElementById("evFillRed");
const evFillTossEl = document.getElementById("evFillToss");
const pathsDemEl = document.getElementById("pathsDem");
const pathsGopEl = document.getElementById("pathsGOP");
const mapTipEl = document.getElementById("mapTip");
const mapWrapEl = document.getElementById("map-wrap");

function leanStr(x) {
  if (!Number.isFinite(x)) return "";
  if (Math.abs(x) < 0.0005) return "EVEN";
  const pct = (Math.abs(x) * 100).toFixed(1);
  return (x > 0 ? "D+" : "R+") + pct;
}

function erf(x){
  const sign = Math.sign(x);
  const abs = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * abs);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs);
  return sign * y;
}

function normalCDF(x, mean = 0, std = 1){
  if (!Number.isFinite(std) || std <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (std * Math.SQRT2)));
}

function stddev(values){
  if (!values.length) return 0;
  const mean = values.reduce((s,v)=>s+v,0) / values.length;
  const variance = values.reduce((s,v)=>s + (v-mean)**2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeSlope(series){
  if (!series || series.length < 2) return 0;
  const n = series.length;
  const meanX = series.reduce((s,p)=>s+p.year,0) / n;
  const meanY = series.reduce((s,p)=>s+p.relative,0) / n;
  let num = 0, den = 0;
  for (const p of series){
    const dx = p.year - meanX;
    num += dx * (p.relative - meanY);
    den += dx * dx;
  }
  if (den === 0) return 0;
  return num / den;
}

function buildModel(abbr, name, series){
  if (!series || !series.length) return null;
  const sorted = series.slice().sort((a,b)=>a.year - b.year);
  const latest = sorted.find(s => s.year === 2024) || sorted[sorted.length - 1];
  if (!latest || !Number.isFinite(latest.relative)) return null;
  const slope = computeSlope(sorted);
  const diffs = [];
  for (let i=1;i<sorted.length;i++){
    if (Number.isFinite(sorted[i].relative) && Number.isFinite(sorted[i-1].relative)){
      diffs.push(sorted[i].relative - sorted[i-1].relative);
    }
  }
  let sigma = stddev(diffs);
  if (!Number.isFinite(sigma) || sigma <= 0) sigma = 0.06;
  const shrink = 0.65;
  const muBase = latest.relative + shrink * slope * 4;
  return {
    abbr,
    name,
    muRaw: latest.relative,
    muBase,
    sigmaBase: sigma,
    ev: latest.ev || 0,
    baselineWinner: latest.relative >= 0 ? "blue" : "red",
    history: sorted,
    latestYear: latest.year
  };
}

async function loadModels(){
  const rows = await d3.csv("presidential_margins.csv", row => ({
    year: +row.year,
    abbr: row.abbr,
    D: +row.D_votes || 0,
    R: +row.R_votes || 0,
    total: +row.total_votes || 0,
    ev: +row.electoral_votes || 0,
    rel: +row.relative_margin || 0,
    nat: +row.national_margin || 0
  }));

  const nationalMarginByYear = new Map();
  rows.forEach(row => {
    if (row.abbr === "NATIONAL" || row.abbr === "NAT") {
      nationalMarginByYear.set(row.year, row.nat || 0);
    }
  });

  const unitHistory = new Map();
  const stateAccumulator = new Map();

  for (const row of rows){
    if (row.abbr === "NATIONAL" || row.abbr === "NAT") continue;
    if (!Number.isFinite(row.rel)) continue;
    if (!unitHistory.has(row.abbr)) unitHistory.set(row.abbr, []);
    unitHistory.get(row.abbr).push({
      year: row.year,
      relative: row.rel,
      total: row.total,
      ev: row.ev
    });

    const base = row.abbr.split("-")[0];
    const key = `${base}:${row.year}`;
    let agg = stateAccumulator.get(key);
    if (!agg){
      agg = { D:0, R:0, total:0, ev:0 };
      stateAccumulator.set(key, agg);
    }
    agg.D += row.D;
    agg.R += row.R;
    agg.total += row.total;
    agg.ev += row.ev;
  }

  const stateHistory = new Map();
  stateAccumulator.forEach((agg, key) => {
    const [base, yearStr] = key.split(":");
    const year = +yearStr;
    if (!stateHistory.has(base)) stateHistory.set(base, []);
    const nat = nationalMarginByYear.get(year) ?? 0;
    const margin = agg.total > 0 ? (agg.D - agg.R) / agg.total : 0;
    const relative = margin - nat;
    stateHistory.get(base).push({
      year,
      relative,
      total: agg.total,
      ev: agg.ev
    });
  });

  unitModels.clear();
  unitHistory.forEach((series, abbr) => {
    const base = abbr.split("-")[0];
    const name = STATE_NAMES[base] ? `${STATE_NAMES[base]}${abbr.includes('-') ? ` ${abbr.split('-')[1]}` : ''}` : abbr;
    const model = buildModel(abbr, name, series);
    if (model) unitModels.set(abbr, model);
  });

  stateModels.clear();
  stateEvTotals = new Map();
  stateHistory.forEach((series, abbr) => {
    const model = buildModel(abbr, STATE_NAMES[abbr] || abbr, series);
    if (model) {
      stateModels.set(abbr, model);
      const latest = series.find(s => s.year === 2024);
      if (latest) stateEvTotals.set(abbr, latest.ev);
    }
  });

  totalEV = Array.from(unitModels.values())
    .filter(model => model.latestYear === 2024)
    .reduce((sum, model) => sum + (model.ev || 0), 0);
}

function setupControls(){
  thresholdInput.addEventListener("input", () => {
    thresholdValue.textContent = `${Math.round(parseFloat(thresholdInput.value) * 100)}%`;
    recompute();
  });
  lockMarginInput.addEventListener("input", recompute);
  sigmaFloorInput.addEventListener("input", recompute);
  resetLocksBtn.addEventListener("click", () => {
    manualLocks.clear();
    recompute();
  });
  thresholdValue.textContent = `${Math.round(parseFloat(thresholdInput.value) * 100)}%`;
}

async function renderMap(){
  const svg = d3.select("#map");
  const g = svg.append("g");
  const projection = d3.geoAlbersUsa().scale(1280).translate([975/2, 610/2]);
  mapProjection = projection;
  const pathGen = d3.geoPath().projection(projection);
  mapPathGenerator = pathGen;
  const topo = await fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(r=>r.json());
  const topojsonGlobal = typeof topojson !== "undefined" ? topojson : (window.topojson || null);
  if (!topojsonGlobal) throw new Error("TopoJSON client unavailable");
  const states = topojsonGlobal.feature(topo, topo.objects.states).features;

  svg.selectAll("path.state")
    .data(states)
    .join("path")
    .attr("class", "state")
    .attr("id", d => {
      const abbr = FIPS_TO_ABBR[String(d.id).padStart(2, "0")];
      return abbr ? `state-${abbr}` : null;
    })
    .attr("d", pathGen)
    .attr("fill", "#2f2f2f")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 0.65)
    .attr("stroke-linejoin", "round")
    .attr("stroke-linecap", "round")
    .on("click", (event, d) => {
      const abbr = FIPS_TO_ABBR[String(d.id).padStart(2, "0")];
      if (!abbr) return;
      const unit = DISTRICT_STATES.has(abbr) ? `${abbr}-AL` : abbr;
      handleUnitToggle(unit);
    })
    .on("mousemove", (event, d) => {
      const abbr = FIPS_TO_ABBR[String(d.id).padStart(2, "0")];
      if (!abbr) return;
      showTooltip(event, abbr, true);
    })
    .on("mouseover", function(){ d3.select(this).attr("stroke-width", 1.2); })
    .on("mouseout", () => hideTooltip());

  const internal = topojsonGlobal.mesh(topo, topo.objects.states, (a,b)=>a!==b);
  g.append("path")
    .datum(internal)
    .attr("fill", "none")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.1)
    .attr("pointer-events", "none")
    .attr("d", pathGen);

  d3.selectAll("path.state").each(function(d){
    const abbr = FIPS_TO_ABBR[String(d.id).padStart(2, "0")];
    if (abbr) mapPaths.set(abbr, d3.select(this));
  });

  await renderDistrictOverlays(pathGen);
  ensureLabelLayer();
  ensureSmallBoxesLayer();
}

async function renderDistrictOverlays(pathGen){
  const svg = d3.select("#map");
  const defs = svg.select("defs").empty() ? svg.append("defs") : svg.select("defs");
  const mapGroup = svg.select("g");
  const districtGroup = svg.append("g").attr("class", "districts");
  districtPaths = new Map();

  const response = await fetch("me_ne_districts.geojson");
  if (!response.ok) return;
  const geo = await response.json();
  const features = Array.isArray(geo.features) ? geo.features.slice() : [];

  const topojsonGlobal = typeof topojson !== "undefined" ? topojson : (window.topojson || null);
  const area = f => {
    try { return pathGen.area(f); } catch (e) { return 0; }
  };

  features.sort((a,b) => area(b) - area(a));

  const makeClip = (abbr) => {
    const statePath = svg.select(`#state-${abbr}`);
    if (statePath.empty()) return null;
    const clipId = `clip-${abbr}`;
    const clip = defs.select(`#${clipId}`).empty() ? defs.append("clipPath").attr("id", clipId) : defs.select(`#${clipId}`);
    clip.selectAll("*").remove();
    clip.append("path").attr("d", statePath.attr("d"));
    return `url(#${clipId})`;
  };

  const clipME = makeClip("ME");
  const clipNE = makeClip("NE");

  for (const feature of features){
    const props = feature.properties || {};
    const unit = props.unit || props.abbr || props.GEOID;
    if (!unit) continue;
    const dAttr = pathGen(feature);
    const stateAbbr = unit.slice(0,2);
    const clipPathUrl = stateAbbr === "ME" ? clipME : stateAbbr === "NE" ? clipNE : null;

    const halo = districtGroup.append("path")
      .attr("class", "district-halo")
      .attr("d", dAttr)
      .attr("clip-path", clipPathUrl)
      .attr("fill", "none")
      .attr("stroke", "#000")
      .attr("stroke-opacity", 0.35)
      .attr("stroke-width", 2.2)
      .attr("pointer-events", "none");

    const path = districtGroup.append("path")
      .attr("class", "district")
      .attr("d", dAttr)
      .attr("clip-path", clipPathUrl)
      .attr("fill", "transparent")
      .attr("stroke", "#BBBBBB")
      .attr("stroke-width", 1.2)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("data-unit", unit)
      .on("click", () => handleUnitToggle(unit))
      .on("mousemove", (event) => showTooltip(event, unit, false))
      .on("mouseout", hideTooltip);

    districtPaths.set(unit, path);
  }
}

function ensureLabelLayer(){
  const svg = d3.select("#map");
  if (!labelLayer || labelLayer.empty()){
    labelLayer = svg.append("g").attr("class", "state-labels").attr("pointer-events", "none");
  }
}

function ensureSmallBoxesLayer(){
  const svg = d3.select("#map");
  if (!smallBoxesLayer || smallBoxesLayer.empty()){
    smallBoxesLayer = svg.append("g").attr("class", "small-state-overlay");
  }
}

function displayName(abbr){
  if (!abbr) return "";
  if (!abbr.includes("-")) return STATE_NAMES[abbr] || abbr;
  const [state, suffix] = abbr.split("-");
  const base = STATE_NAMES[state] || state;
  if (suffix === "AL") return `${base} At-Large`;
  return `${base} ${suffix}`;
}

function handleUnitToggle(unit){
  if (!togglableUnits.has(unit)) return;
  const current = manualLocks.get(unit) || "neutral";
  const next = current === "neutral" ? "blue" : current === "blue" ? "red" : "neutral";
  if (next === "neutral") manualLocks.delete(unit);
  else manualLocks.set(unit, next);
  recompute();
}

function showTooltip(evt, abbr, isStatePath){
  const stat = unitStats.get(abbr) || stateStats.get(abbr);
  if (!stat) return;
  const textParts = [];
  textParts.push(displayName(abbr));
  textParts.push(`${stat.ev || 0} EV`);
  if (Number.isFinite(stat.prob)) textParts.push(`P(D) ${(stat.prob * 100).toFixed(1)}%`);
  if (Number.isFinite(stat.muAdjusted)) textParts.push(`Proj ${leanStr(stat.muAdjusted)}`);
  mapTipEl.textContent = textParts.join(" · ");
  const rect = mapWrapEl.getBoundingClientRect();
  const x = evt.clientX - rect.left + 12;
  const y = evt.clientY - rect.top + 12;
  mapTipEl.style.left = `${x}px`;
  mapTipEl.style.top = `${y}px`;
  mapTipEl.style.display = "block";
}

function hideTooltip(){
  mapTipEl.style.display = "none";
}

function colorForDisplay(muAdjusted){
  // Use shared site color mapping for relative margins (keeps palette consistent across pages)
  try {
    if (window.SiteState && typeof window.SiteState.colorForMargin === 'function'){
      return window.SiteState.colorForMargin(muAdjusted, true);
    }
  } catch(e) {}
  // Fallback: neutral gray
  return "#3b3b3b";
}

function classifyBucket(prob, lockStatus){
  if (lockStatus === "blue") return "safeD";
  if (lockStatus === "red") return "safeR";
  if (prob >= 0.85) return "safeD";
  if (prob >= 0.65) return "leanD";
  if (prob > 0.35) return "toss";
  if (prob > 0.15) return "leanR";
  return "safeR";
}

function recompute(){
  if (unitModels.size === 0) return;
  const threshold = parseFloat(thresholdInput.value);
  const lockMargin = parseFloat(lockMarginInput.value) || 0;
  const sigmaFloor = parseFloat(sigmaFloorInput.value) || 0.05;

  togglableUnits = new Set();
  unitModels.forEach((model, abbr) => {
    if (!Number.isFinite(model.muRaw)) return;
    if (Math.abs(model.muRaw) <= threshold) togglableUnits.add(abbr);
  });

  Array.from(manualLocks.keys()).forEach(key => {
    if (!togglableUnits.has(key)) manualLocks.delete(key);
  });

  let num = 0;
  let den = 0;
  manualLocks.forEach((mode, unit) => {
    if (mode === "neutral") return;
    const model = unitModels.get(unit);
    if (!model) return;
    const sigma = Math.max(model.sigmaBase, sigmaFloor);
    const weight = 1 / (sigma * sigma + 1e-6);
    const target = mode === "blue" ? lockMargin : -lockMargin;
    num += weight * (target - model.muBase);
    den += weight;
  });
  const delta = den > 0 ? num / den : 0;

  unitStats = new Map();
  const buckets = {
    safeD: { states: [], ev: 0 },
    leanD: { states: [], ev: 0 },
    toss: { states: [], ev: 0 },
    leanR: { states: [], ev: 0 },
    safeR: { states: [], ev: 0 }
  };

  let expectedDEv = 0;

  unitModels.forEach((model, abbr) => {
    const sigma = Math.max(model.sigmaBase, sigmaFloor);
    let muAdjusted = model.muBase + delta;
    let prob = normalCDF(muAdjusted, 0, sigma);
    let lockStatus = null;
    const manual = manualLocks.get(abbr) || "neutral";
    if (manual === "blue") { prob = 1; lockStatus = "blue"; }
    else if (manual === "red") { prob = 0; lockStatus = "red"; }
    prob = Math.min(0.999, Math.max(0.001, prob));

    const bucket = classifyBucket(prob, lockStatus);
    buckets[bucket].states.push(abbr);
    buckets[bucket].ev += model.ev;

    // For display color, use margin-based palette; bias slightly toward the lock side so locked fills look strong
    let displayMu = muAdjusted;
    if (lockStatus === 'blue') displayMu = Math.max(displayMu, Math.abs(lockMargin) || 0.03);
    if (lockStatus === 'red') displayMu = Math.min(displayMu, -Math.abs(lockMargin || 0.03));

    const stat = {
      abbr,
      name: model.name,
      ev: model.ev,
      prob,
      muAdjusted,
      sigma,
      lockStatus,
      manual,
      color: colorForDisplay(displayMu)
    };
    unitStats.set(abbr, stat);
    expectedDEv += prob * model.ev;
  });

  stateStats = new Map();
  stateModels.forEach((model, abbr) => {
    const sigma = Math.max(model.sigmaBase, sigmaFloor);
    const muAdjusted = model.muBase + delta;
    const prob = Math.min(0.999, Math.max(0.001, normalCDF(muAdjusted, 0, sigma)));
    stateStats.set(abbr, {
      abbr,
      name: model.name,
      ev: stateEvTotals.get(abbr) || 0,
      prob,
      muAdjusted,
      color: colorForDisplay(muAdjusted)
    });
  });

  updateMapColors();
  updateDistrictColors();
  renderSmallStateBoxes();
  updateStateLabels();
  renderBuckets(buckets, expectedDEv);
  renderStateGrid();
  renderPaths();
}

function updateMapColors(){
  mapPaths.forEach((sel, abbr) => {
    const stat = stateStats.get(abbr);
    const fill = stat ? stat.color : "#2f2f2f";
    try {
      sel.transition().duration(300).attr("fill", fill);
    } catch (e) {
      sel.attr("fill", fill);
    }
  });
}

function updateDistrictColors(){
  districtPaths.forEach((sel, unit) => {
    const stat = unitStats.get(unit);
    const fill = stat ? stat.color : "transparent";
    try {
      sel.transition().duration(300).attr("fill", fill);
    } catch (e) {
      sel.attr("fill", fill);
    }
  });
}

function renderSmallStateBoxes(){
  ensureSmallBoxesLayer();
  const svg = d3.select("#map");
  const vb = svg.attr("viewBox") ? svg.attr("viewBox").split(/\s+/).map(Number) : [0,0,975,610];
  const width = vb[2] || 975;
  const x = width - 90;
  const boxW = 82;
  const boxH = 24;
  const gapY = 4;
  const startY = 240;

  smallBoxesLayer.selectAll("g.small-box").remove();
  const groups = smallBoxesLayer.selectAll("g.small-box")
    .data(SMALL_STATE_LIST)
    .join("g")
    .attr("class", "small-box")
    .attr("transform", (d,i) => `translate(${x},${startY + i * (boxH + gapY)})`)
    .on("click", (_, d) => handleUnitToggle(d.unit))
    .on("mousemove", (event, d) => showTooltip(event, d.unit, false))
    .on("mouseout", hideTooltip);

  groups.each(function(d){
    const g = d3.select(this);
    g.selectAll("*").remove();
    const stat = unitStats.get(d.unit) || stateStats.get(d.unit) || null;
    const fill = stat ? stat.color : "#2f2f2f";
  const txtColor = /#ff|rgb\(/i.test(fill) ? "#fff" : "#fff";

    g.append("rect")
      .attr("rx",5).attr("ry",5)
      .attr("width", boxW).attr("height", boxH)
      .attr("fill", fill)
      .attr("stroke", "rgba(0,0,0,0.4)")
      .attr("stroke-width", 1);

    g.append("text")
      .attr("x", 6)
      .attr("y", boxH / 2)
      .attr("dominant-baseline", "middle")
      .attr("fill", txtColor)
      .attr("font-weight", 700)
      .attr("font-size", 11)
      .text(d.label);

    const ev = stat ? stat.ev : 0;
    g.append("text")
      .attr("x", boxW - 6)
      .attr("y", boxH / 2)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("fill", "rgba(255,255,255,0.85)")
      .attr("font-weight", 600)
      .attr("font-size", 10)
      .text(`${ev} EV`);
  });
}

function updateStateLabels(){
  ensureLabelLayer();
  if (!mapPathGenerator) return;
  labelLayer.selectAll("text.state-label").remove();

  d3.selectAll("path.state").each(function(d){
    const id = String(d.id).padStart(2, "0");
    const abbr = FIPS_TO_ABBR[id];
    if (!abbr || SMALL_STATES_SET.has(abbr)) return;
    const stat = stateStats.get(abbr);
    if (!stat) return;
    const centroid = mapPathGenerator.centroid(d);
    // Visual centering tweaks for a few tricky shapes
    let [cx, cy] = centroid;
    if (abbr === 'FL') { cx += 8; cy += 2; }
    if (abbr === 'LA') { cx -= 6; cy -= 0; }
    if (abbr === 'MI') { cy += 10; }
    const text = labelLayer.append("text")
      .attr("class", "state-label")
      .attr("x", cx)
      .attr("y", cy)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", "#fff")
      .attr("font-weight", 600)
      .attr("font-size", 11);
    text.append("tspan").attr("x", cx).attr("dy", "0").text(abbr);
    text.append("tspan").attr("x", cx).attr("dy", "1.2em").text(stat.ev || 0);
  });
}

function renderBuckets(buckets, expectedDEv){
  const order = [
    { key: "safeD", label: "Safe D" },
    { key: "leanD", label: "Lean D" },
    { key: "toss", label: "Toss-up" },
    { key: "leanR", label: "Lean R" },
    { key: "safeR", label: "Safe R" }
  ];
  bucketTableBody.innerHTML = "";
  order.forEach(({key, label}) => {
    const bucket = buckets[key];
    const tr = document.createElement("tr");
    const td1 = document.createElement("td"); td1.textContent = label;
    const td2 = document.createElement("td");
    // Build wrapping chips for state/unit labels
    if (bucket.states.length){
      const wrap = document.createElement("div");
      wrap.className = "bucket-states";
      bucket.states.sort().forEach(s => {
        const chip = document.createElement("span");
        chip.className = "bucket-chip";
        chip.textContent = s;
        chip.title = (unitStats.get(s)?.name || stateStats.get(s)?.name || s) + (unitStats.get(s)?.ev ? ` • ${unitStats.get(s).ev} EV` : "");
        wrap.appendChild(chip);
      });
      td2.appendChild(wrap);
    } else {
      td2.textContent = "—";
    }
    const td3 = document.createElement("td"); td3.textContent = bucket.ev.toString();
    tr.append(td1, td2, td3);
    bucketTableBody.appendChild(tr);
  });

  const safeD = buckets.safeD.ev;
  const safeR = buckets.safeR.ev;
  const toss = buckets.toss.ev;
  evSummaryEl.textContent = `Safe D ${safeD} • Toss-up ${toss} • Safe R ${safeR}`;
  const expectedREv = totalEV - expectedDEv;
  evTextEl.textContent = `Exp EV — D ${expectedDEv.toFixed(1)} | R ${expectedREv.toFixed(1)}`;

  const blueEv = buckets.safeD.ev + buckets.leanD.ev;
  const redEv = buckets.safeR.ev + buckets.leanR.ev;
  const tossEv = buckets.toss.ev;
  const bluePct = totalEV ? (blueEv / totalEV) * 100 : 0;
  const redPct = totalEV ? (redEv / totalEV) * 100 : 0;
  const tossPct = totalEV ? (tossEv / totalEV) * 100 : 0;

  evFillBlueEl.style.width = `${bluePct}%`;
  evFillTossEl.style.left = `${bluePct}%`;
  evFillTossEl.style.width = `${tossPct}%`;
  evFillTossEl.style.display = tossPct > 0 ? "" : "none";
  evFillRedEl.style.width = `${redPct}%`;
}

function renderStateGrid(){
  stateGridEl.innerHTML = "";
  const items = Array.from(togglableUnits).map(unit => ({ unit, stat: unitStats.get(unit) })).filter(d => d.stat);
  items.sort((a,b)=>Math.abs(a.stat.prob - 0.5) - Math.abs(b.stat.prob - 0.5));

  items.forEach(({unit, stat}) => {
    const chip = document.createElement("div");
    chip.className = "state-chip";
    if (stat.manual === "blue") chip.classList.add("lock-blue");
    if (stat.manual === "red") chip.classList.add("lock-red");
    chip.innerHTML = `
      <div class="abbr">${unit}</div>
      <div class="meta">P(D): ${(stat.prob * 100).toFixed(1)}%</div>
      <div class="meta">Proj: ${leanStr(stat.muAdjusted)}</div>
    `;
    chip.title = `${displayName(unit)} • ${stat.ev} EV`;
    chip.addEventListener("click", () => handleUnitToggle(unit));
    stateGridEl.appendChild(chip);
  });
}

function renderPaths(){
  renderPathsForParty("dem", pathsDemEl);
  renderPathsForParty("gop", pathsGopEl);
}

function renderPathsForParty(party, targetEl){
  if (!targetEl) return;
  const baseBuckets = party === "dem" ? ["safeD","leanD"] : ["safeR","leanR"];
  let baseEv = 0;
  const tossUnits = [];
  unitStats.forEach((stat, abbr) => {
    const bucket = classifyBucket(stat.prob, stat.lockStatus);
    if (baseBuckets.includes(bucket)) baseEv += stat.ev;
    else if (bucket === "toss") tossUnits.push({ abbr, stat });
  });

  const needed = 270 - baseEv;
  if (needed <= 0){
    targetEl.innerHTML = `<div class="path-card">Already above 270 EV.</div>`;
    return;
  }
  if (!tossUnits.length){
    targetEl.innerHTML = `<div class="legend">No toss-up units remaining.</div>`;
    return;
  }

  tossUnits.sort((a,b)=>Math.abs(a.stat.prob - 0.5) - Math.abs(b.stat.prob - 0.5));
  const units = tossUnits.slice(0, 14);
  const combos = [];
  const totalCombos = 1 << units.length;
  for (let mask=0; mask < totalCombos; mask++){
    let evGain = 0;
    let prob = 1;
    const winners = [];
    for (let i=0;i<units.length;i++){
      const { abbr, stat } = units[i];
      const win = (mask & (1 << i)) !== 0;
      if (party === "dem"){
        if (win){ evGain += stat.ev; prob *= stat.prob; winners.push(abbr); }
        else prob *= (1 - stat.prob);
      } else {
        if (win){ evGain += stat.ev; prob *= (1 - stat.prob); winners.push(abbr); }
        else prob *= stat.prob;
      }
      if (prob < 1e-6) break;
    }
    if (prob < 1e-6) continue;
    if (evGain >= needed){
      combos.push({ states: winners.slice(), ev: baseEv + evGain, probability: prob });
    }
  }

  combos.sort((a,b)=>b.probability - a.probability);
  const top = combos.slice(0, Math.min(6, combos.length));
  if (!top.length){
    targetEl.innerHTML = `<div class="legend">No winning combinations in current toss-ups.</div>`;
    return;
  }
  targetEl.innerHTML = "";
  top.forEach(combo => {
    const div = document.createElement("div");
    div.className = "path-card";
    const label = party === "dem" ? "Dem" : "GOP";
    div.innerHTML = `
      <div><strong>${label} ${combo.ev} EV</strong> · P ≈ ${(combo.probability * 100).toFixed(2)}%</div>
      <div class="states">${combo.states.length ? combo.states.join(", ") : "(others go opp.)"}</div>
    `;
    targetEl.appendChild(div);
  });
}

async function init(){
  await loadModels();
  setupControls();
  await renderMap();
  recompute();
}

init().catch(err => {
  console.error("Failed to initialise possibilities page", err);
  if (pathsDemEl) pathsDemEl.innerHTML = `<div class="legend">Error loading data.</div>`;
});
