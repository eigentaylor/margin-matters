/* Shift Vectors page driver */
(function () {
    const DATA_PATH = './presidential_margins.csv';
    const MIN_MAG_SWATCH = 150;
    const dataLoader = (window.DataLoader && typeof window.DataLoader.loadPresidentialMargins === 'function')
        ? window.DataLoader
        : null;

    const yearSlider = document.getElementById('yearSlider');
    const yearValue = document.getElementById('yearValue');
    const logToggle = document.getElementById('logScaleToggle');
    const unitToggle = document.getElementById('fixedLengthToggle');
    const statusText = document.getElementById('statusText');
    const pointSummary = document.getElementById('pointSummary');
    const pointCountEl = document.getElementById('pointCount');
    const tooltipEl = document.getElementById('tooltip');
    const dataToggle = document.getElementById('dataToggle');
    const dataPanel = document.getElementById('dataPanel');
    const dataSummary = document.getElementById('dataSummary');
    const dataTable = document.getElementById('shiftDataTable');
    const noDataEl = document.getElementById('noData');
    const chartNote = document.getElementById('chartNote');
    const labelToggle = document.getElementById('labelToggle');
    const allLabelToggle = document.getElementById('allLabelToggle');
    const urlParams = new URLSearchParams(window.location.search);

    if (!yearSlider || !yearValue || !logToggle || !unitToggle) {
        if (statusText) statusText.textContent = 'Missing required controls.';
        return;
    }

    const cssVars = getComputedStyle(document.documentElement);
    // Feature flag: when true, replace symlog with a 'symloglog' transform (double-log-like)
    const USE_SYMLOGLOG = true; // set to true to enable symloglog
    const SYMLOGLOG_CONSTANT = 1.0; // tunable constant controlling curvature for symloglog
    const palette = {
        blue: cssVars.getPropertyValue('--quad-blue').trim() || '#60a5fa',
        red: cssVars.getPropertyValue('--quad-red').trim() || '#f87171',
        green: cssVars.getPropertyValue('--quad-green').trim() || '#34d399',
        amber: cssVars.getPropertyValue('--quad-amber').trim() || '#fbbf24',
        purple: cssVars.getPropertyValue('--quad-purple').trim() || '#c084fc',
        muted: cssVars.getPropertyValue('--quad-muted').trim() || '#9ca3af'
    };
    // Separate palette for region fills (diagonal areas). These should be
    // visually distinct and a bit brighter than point swatches. CSS variables
    // allow easy theming; fall back to vivid defaults.
    const regionPalette = {
        blue: cssVars.getPropertyValue('--region-blue').trim() || '#3b82f6',
        green: cssVars.getPropertyValue('--region-green').trim() || '#10b981',
        amber: cssVars.getPropertyValue('--region-amber').trim() || '#f59e0b',
        purple: cssVars.getPropertyValue('--region-purple').trim() || '#8b5cf6'
    };
    const gridColor = cssVars.getPropertyValue('--plot-grid').trim() || 'rgba(255,255,255,0.08)';

    const svg = d3.select('#vectorChart');
    const viewBox = svg.attr('viewBox');
    let width = 860;
    let height = 620;
    if (viewBox) {
        const parts = viewBox.split(/\s+/).map(Number);
        if (parts.length === 4) {
            width = parts[2];
            height = parts[3];
        }
    }
    const margin = { top: 30, right: 30, bottom: 70, left: 80 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const root = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const gridLayer = root.append('g').attr('class', 'grid');
    const regionLayer = root.append('g').attr('class', 'regions');
    const unitCirclePath = root.append('path').attr('class', 'unit-circle').style('display', 'none');
    const diagLayer = root.append('g').attr('class', 'diagonals');
    const zeroLines = {
        horizontal: root.append('line').attr('class', 'zero-line'),
        vertical: root.append('line').attr('class', 'zero-line')
    };
    const pointsLayer = root.append('g').attr('class', 'points');
    const labelsLayer = root.append('g').attr('class', 'labels');
    let labelSimulation = null;

    const xAxisG = svg.append('g')
        .attr('class', 'axis axis-x')
        .attr('transform', `translate(${margin.left},${height - margin.bottom})`);
    const yAxisG = svg.append('g')
        .attr('class', 'axis axis-y')
        .attr('transform', `translate(${margin.left},${margin.top})`);
    const xAxisLabel = xAxisG.append('text')
        .attr('class', 'axis-label')
        .attr('text-anchor', 'middle')
        .attr('x', innerWidth / 2)
        .attr('y', 50)
        .text('Δ Democratic votes');
    const yAxisLabel = yAxisG.append('text')
        .attr('class', 'axis-label')
        .attr('text-anchor', 'middle')
        .attr('transform', 'rotate(-90)')
        .attr('x', -innerHeight / 2)
        .attr('y', -60)
        .text('Δ Republican votes');

    const circleLine = d3.line();

    const formatSigned = d3.format('+,.0f');
    const formatPlain = d3.format(',.0f');
    const formatShort = d3.format('.2f');

    function clampNumber(value) {
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
    }

    function hasDelta(entry) {
        return Number.isFinite(entry.dDelta) && Number.isFinite(entry.rDelta) &&
            (Math.abs(entry.dDelta) > 0 || Math.abs(entry.rDelta) > 0);
    }

    function formatAxisValue(value, normalized) {
        if (!Number.isFinite(value)) return '';
        if (normalized) {
            return formatShort(value);
        }
        const abs = Math.abs(value);
        if (abs >= 1e6) return `${value < 0 ? '-' : ''}${(abs / 1e6).toFixed(1)}M`;
        if (abs >= 1e3) return `${value < 0 ? '-' : ''}${(abs / 1e3).toFixed(1)}k`;
        if (abs >= 1) return formatPlain(value);
        return value.toFixed(2);
    }

    function formatSignedSmall(v) { return d3.format('+,.0f')(v); }

    function colorFor(entry) {
        const dx = entry.dDelta;
        const ry = entry.rDelta;
        const length = entry.length;
        const threshold = Math.max(MIN_MAG_SWATCH, length * 0.05);
        const nearDx = Math.abs(dx) < threshold;
        const nearRy = Math.abs(ry) < threshold;

        if (nearDx && nearRy) return palette.amber;
        if (dx >= 0 && ry < 0) return palette.blue;
        if (dx < 0 && ry >= 0) return palette.red;
        if (dx >= 0 && ry >= 0) return palette.green;
        if (dx < 0 && ry < 0) return palette.purple;
        return palette.muted;
    }

    function radiusFor(entry, normalized) {
        if (normalized) return 5;
        const length = Math.max(1, entry.length);
        const base = 3 + Math.log10(length);
        return Math.max(3, Math.min(11, base));
    }

    function showTooltip(event, entry) {
        if (!tooltipEl) return;
        const turnout = (Number.isFinite(entry.dDelta) ? entry.dDelta : 0) + (Number.isFinite(entry.rDelta) ? entry.rDelta : 0);
        const partisan = (Number.isFinite(entry.dDelta) ? entry.dDelta : 0) - (Number.isFinite(entry.rDelta) ? entry.rDelta : 0);
        // determine percent: use entry.totalVotes if available (absolute baseline), otherwise use absolute turnout
        const baseline = Number.isFinite(entry.totalVotes) ? entry.totalVotes : Math.max(1, Math.abs(turnout));
        const partisanPct = (partisan / baseline) * 100;
        // debug log
        // console.log('entry', entry, 'baseline', baseline, 'partisan', partisan, 'partisanPct', partisanPct);
        function arrowGlyph(v) { return v > 0 ? '▲' : (v < 0 ? '▼' : '–'); }
        tooltipEl.innerHTML = `
            <div style="word-break: break-word; white-space: pre-line;">
                <strong>${entry.label}</strong>
            </div>
            <div style="word-break: break-word; white-space: pre-line;">Δ D votes: <span class="arrow">${arrowGlyph(entry.dDelta)}</span> ${formatSigned(entry.dDelta)}</div>
            <div style="word-break: break-word; white-space: pre-line;">Δ R votes: <span class="arrow">${arrowGlyph(entry.rDelta)}</span> ${formatSigned(entry.rDelta)}</div>
            <div style="word-break: break-word; white-space: pre-line;">Partisan shift (ΔD - ΔR): <span class="arrow">${arrowGlyph(partisan)}</span> ${formatSigned(partisan)} <span class="pct"></span></div>
            <div style="word-break: break-word; white-space: pre-line;">D/R Turnout Δ (D+R): <span class="arrow">${arrowGlyph(turnout)}</span> ${formatSigned(turnout)}</div>
            ${entry.totalDelta != null ? `<div style="word-break: break-word; white-space: pre-line;">Total Δ votes: <span class="arrow">${arrowGlyph(entry.totalDelta)}</span> ${formatSigned(entry.totalDelta)}</div>` : ''}
            <div style="word-break: break-word; white-space: pre-line;">Vector length: ${formatPlain(entry.length)} votes</div>
            ${entry.note ? `<div class="tooltip-note" style="word-break: break-word; white-space: pre-line;">${entry.note}</div>` : ''}
        `;
        tooltipEl.classList.add('visible');
        positionTooltip(event);
    }

    function hideTooltip() {
        if (!tooltipEl) return;
        tooltipEl.classList.remove('visible');
    }

    function positionTooltip(event) {
        if (!tooltipEl) return;
        const PADDING = 16;
        const { clientX, clientY } = event;
        const winW = document.documentElement.clientWidth;
        const winH = document.documentElement.clientHeight;
        const rect = tooltipEl.getBoundingClientRect();
        let left = clientX + PADDING;
        let top = clientY + PADDING;
        if (left + rect.width + PADDING > winW) left = clientX - rect.width - PADDING;
        if (top + rect.height + PADDING > winH) top = clientY - rect.height - PADDING;
        tooltipEl.style.left = `${Math.max(8, left)}px`;
        tooltipEl.style.top = `${Math.max(8, top)}px`;
    }

    let yearOrder = [];
    let entriesByYear = new Map();
    const lastPositions = new Map();
    // table sort state
    let tableSort = { key: 'label', dir: 'asc' };

    function update(year) {
        hideTooltip();
        const rows = entriesByYear.get(year) || [];
        const filtered = rows.filter(hasDelta);

        if (pointCountEl) {
            pointCountEl.textContent = String(filtered.length);
            pointSummary.hidden = filtered.length === 0;
        }

        if (!filtered.length) {
            if (statusText) statusText.textContent = `No data available for ${year}.`;
            if (noDataEl) noDataEl.hidden = false;
            pointsLayer.selectAll('circle').remove();
            unitCirclePath.style('display', 'none');
            zeroLines.horizontal.style('display', 'none');
            zeroLines.vertical.style('display', 'none');
            return;
        }

        if (noDataEl) noDataEl.hidden = true;

        const useNormalized = unitToggle.checked;
        const useSymlog = logToggle.checked;

        const points = filtered.map(row => {
            const length = Math.sqrt(row.dDelta * row.dDelta + row.rDelta * row.rDelta);
            const normX = length > 0 ? row.dDelta / length : 0;
            const normY = length > 0 ? row.rDelta / length : 0;
            return {
                id: row.id,
                label: row.label,
                dDelta: row.dDelta,
                rDelta: row.rDelta,
                totalDelta: row.totalDelta,
                note: row.note,
                length,
                x: useNormalized ? normX : row.dDelta,
                y: useNormalized ? normY : row.rDelta,
                normX,
                normY
            };
        }).filter(d => Number.isFinite(d.x) && Number.isFinite(d.y));

        if (!points.length) {
            if (statusText) statusText.textContent = `No valid vote-change points for ${year}.`;
            pointsLayer.selectAll('circle').remove();
            unitCirclePath.style('display', 'none');
            zeroLines.horizontal.style('display', 'none');
            zeroLines.vertical.style('display', 'none');
            return;
        }

        const maxAbsX = d3.max(points, d => Math.abs(d.x)) || 1;
        const maxAbsY = d3.max(points, d => Math.abs(d.y)) || 1;

        // zoom out slightly to allow room for labels outside the circle
        const domainX = useNormalized ? [-1.5, 1.5] : [-maxAbsX * 1.15, maxAbsX * 1.15];
        const domainY = useNormalized ? [-1.5, 1.5] : [-maxAbsY * 1.15, maxAbsY * 1.15];

        const constantX = useNormalized ? 0.2 : Math.max(1, Math.min(Math.abs(domainX[0]), Math.abs(domainX[1])) / 6);
        const constantY = useNormalized ? 0.2 : Math.max(1, Math.min(Math.abs(domainY[0]), Math.abs(domainY[1])) / 6);

        let xScale = (useSymlog ? d3.scaleSymlog().constant(constantX) : d3.scaleLinear())
            .domain(domainX)
            .range([0, innerWidth]);
        let yScale = (useSymlog ? d3.scaleSymlog().constant(constantY) : d3.scaleLinear())
            .domain(domainY)
            .range([innerHeight, 0]);

        // If the feature flag is enabled, replace symlog with an approximate 'symloglog' scale.
        function makeSymLogLogScale(constant, domain, range, vertical = false) {
            // transform: sign(x) * log(1 + log(1 + abs(x)/c)) scaled to domain/range
            const c = Math.max(1e-6, constant || 1);
            function forward(x) {
                const a = Math.abs(x) / c;
                const inner = Math.log1p(a);
                const val = Math.sign(x) * Math.log1p(inner);
                return val;
            }
            function inverse(y) {
                // inverse of forward approximated by expm1(expm1(abs(y))) * c
                const s = Math.sign(y);
                const ay = Math.abs(y);
                const inner = Math.expm1(ay);
                const orig = Math.expm1(inner) * c;
                return s * orig;
            }
            // create a continuous scale that maps domain -> range using forward/inverse
            const domainTransformed = domain.map(forward);
            const scale = d3.scaleLinear().domain(domainTransformed).range(range);
            const s = function (x) { return scale(forward(x)); };
            s.invert = function (y) { return inverse(scale.invert(y)); };
            s.ticks = function (count) {
                // approximate ticks by inverse-mapping linear ticks on transformed domain
                const t = d3.scaleLinear().domain(domainTransformed).nice(count).ticks(count);
                return t.map(v => inverse(v));
            };
            s.domain = function (d) { if (!arguments.length) return domain; domain = d; return s; };
            s.range = function (r) { if (!arguments.length) return range; range = r; scale.range(range.map(v => v)); return s; };
            // d3.axis expects scales to implement copy(); provide a copy that recreates
            // an equivalent scale instance so axis and other utilities can call copy.
            s.copy = function () {
                return makeSymLogLogScale(constant, domain.slice(), range.slice(), vertical);
            };
            return s;
        }

        if (USE_SYMLOGLOG && useSymlog) {
            // replace with symloglog-like behavior
            const tx = makeSymLogLogScale(SYMLOGLOG_CONSTANT, domainX, [0, innerWidth]);
            const ty = makeSymLogLogScale(SYMLOGLOG_CONSTANT, domainY, [innerHeight, 0]);
            // override xScale/yScale variable values
            xScale = tx; // eslint-disable-line no-unused-vars
            yScale = ty; // eslint-disable-line no-unused-vars
        }

        const tickCount = useNormalized ? 5 : 7;
        const xAxis = d3.axisBottom(xScale)
            .ticks(tickCount)
            .tickFormat(v => formatAxisValue(v, useNormalized));
        const yAxis = d3.axisLeft(yScale)
            .ticks(tickCount)
            .tickFormat(v => formatAxisValue(v, useNormalized));

        xAxisG.call(xAxis);
        yAxisG.call(yAxis);

        const zeroX = xScale(0);
        const zeroY = yScale(0);

        zeroLines.horizontal
            .style('display', 'block')
            .attr('x1', 0)
            .attr('x2', innerWidth)
            .attr('y1', zeroY)
            .attr('y2', zeroY);
        zeroLines.vertical
            .style('display', 'block')
            .attr('y1', 0)
            .attr('y2', innerHeight)
            .attr('x1', zeroX)
            .attr('x2', zeroX);

        if (useNormalized) {
            const coords = [];
            for (let i = 0; i <= 360; i += 3) {
                const rad = (i * Math.PI) / 180;
                coords.push([xScale(Math.cos(rad)), yScale(Math.sin(rad))]);
            }
            unitCirclePath
                .style('display', 'block')
                .attr('d', circleLine(coords));
        } else {
            unitCirclePath.style('display', 'none');
        }

        gridLayer.selectAll('line.hline')
            .data(yScale.ticks(tickCount))
            .join(
                enter => enter.append('line').attr('class', 'hline'),
                update => update,
                exit => exit.remove()
            )
            .attr('x1', 0)
            .attr('x2', innerWidth)
            .attr('y1', d => yScale(d))
            .attr('y2', d => yScale(d))
            .style('stroke', gridColor)
            .style('stroke-width', 1)
            .style('opacity', 0.4);
        gridLayer.selectAll('line.vline')
            .data(xScale.ticks(tickCount))
            .join(
                enter => enter.append('line').attr('class', 'vline'),
                update => update,
                exit => exit.remove()
            )
            .attr('y1', 0)
            .attr('y2', innerHeight)
            .attr('x1', d => xScale(d))
            .attr('x2', d => xScale(d))
            .style('stroke', gridColor)
            .style('stroke-width', 1)
            .style('opacity', 0.4);

        // Draw / update filled region polygons for the two decision lines y = x and y = -x.
        // We'll sample the x-domain and build polygons for four sign-combinations of
        // A = x - y (D change > R change) and B = x + y (turnout change):
        //  - region1 (A>0, B>0): fill when D change > R change and turnout increased
        //  - region2 (A>0, B<0): fill when D change > R change and turnout decreased
        //  - region3 (A<0, B>0): fill when R change > D change and turnout increased
        //  - region4 (A<0, B<0): fill when R change > D change and turnout decreased
        const nSamples = Math.max(80, Math.floor(innerWidth / 4));
        const xs = d3.range(nSamples + 1).map(i => domainX[0] + (domainX[1] - domainX[0]) * (i / nSamples));

        // Helper to clamp a y-value to the plotting domain
        function clampY(y) { return Math.max(domainY[0], Math.min(domainY[1], y)); }

        // Build polygons by tracing top edge then the moving boundary between diagonals
        function buildPolyTop() {
            // top region: y from y_b(x) .. domainY[1]
            const up = xs.map(x => [x, domainY[1]]);
            const down = xs.slice().reverse().map(x => [x, clampY(Math.max(x, -x))]);
            return up.concat(down);
        }

        function buildPolyBottom() {
            // bottom region: y from domainY[0] .. y_a(x)
            const up = xs.map(x => [x, clampY(Math.min(x, -x))]);
            const down = xs.slice().reverse().map(x => [x, domainY[0]]);
            return up.concat(down);
        }

        function buildPolyMidPositive() {
            // mid region for x >= 0: y in [-x, x]
            const xsPos = xs.filter(x => x >= 0);
            if (!xsPos.length) return null;
            const up = xsPos.map(x => [x, clampY(x)]);
            const down = xsPos.slice().reverse().map(x => [x, clampY(-x)]);
            return up.concat(down);
        }

        function buildPolyMidNegative() {
            // mid region for x < 0: y in [x, -x]
            const xsNeg = xs.filter(x => x < 0);
            if (!xsNeg.length) return null;
            const up = xsNeg.map(x => [x, clampY(-x)]);
            const down = xsNeg.slice().reverse().map(x => [x, clampY(x)]);
            return up.concat(down);
        }

        const regions = [
            // use brighter, distinct fills for region areas (these represent turnout and dominance regions)
            { id: 'region-top', coords: buildPolyTop(), fill: regionPalette.blue, opacity: 0.14 },
            { id: 'region-mid-pos', coords: buildPolyMidPositive(), fill: regionPalette.green, opacity: 0.14 },
            { id: 'region-mid-neg', coords: buildPolyMidNegative(), fill: regionPalette.purple, opacity: 0.14 },
            { id: 'region-bottom', coords: buildPolyBottom(), fill: regionPalette.amber, opacity: 0.14 }
        ];

        const regionPath = d3.line().x(d => xScale(d[0])).y(d => yScale(d[1]));
        const regionSel = regionLayer.selectAll('path.region').data(regions.filter(r => r.coords));
        regionSel.join(
            enter => enter.append('path').attr('class', d => `region ${d.id}`),
            update => update,
            exit => exit.remove()
        ).attr('d', d => regionPath(d.coords))
            .attr('fill', d => d.fill)
            .attr('fill-opacity', d => d.opacity)
            .attr('stroke', 'none');

        // Diagonal lines y = x and y = -x — draw as dashed guides
        const diag1 = xs.map(x => [x, x]);
        const diag2 = xs.map(x => [x, -x]);
        const diagPath = d3.line().x(d => xScale(d[0])).y(d => yScale(d[1]));
        const diagSel = diagLayer.selectAll('path.diag').data([{ id: 'yEqX', pts: diag1 }, { id: 'yEqNegX', pts: diag2 }]);
        diagSel.join(
            enter => enter.append('path').attr('class', d => `diag ${d.id}`),
            update => update,
            exit => exit.remove()
        ).attr('d', d => diagPath(d.pts))
            .attr('fill', 'none')
            .attr('stroke', cssVars.getPropertyValue('--muted') || '#9ca3af')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '6 6')
            .attr('pointer-events', 'none');

        // Bind circles and animate transitions between years
        const circles = pointsLayer.selectAll('circle').data(points, d => d.id);
        circles.join(
            enter => enter.append('circle')
                .attr('class', 'point')
                .attr('data-id', d => d.id)
                .attr('cx', d => {
                    const prev = lastPositions.get(d.id);
                    return prev ? prev.x : xScale(d.x);
                })
                .attr('cy', d => {
                    const prev = lastPositions.get(d.id);
                    return prev ? prev.y : yScale(d.y);
                })
                .attr('r', 0)
                .attr('fill', d => colorFor(d))
                .on('mouseenter', function (event, datum) {
                    d3.select(this).classed('active', true);
                    showTooltip(event, datum);
                })
                .on('mousemove', positionTooltip)
                .on('mouseleave', function () {
                    d3.select(this).classed('active', false);
                    hideTooltip();
                })
                .call(sel => sel.transition().duration(500).attr('r', d => radiusFor(d, useNormalized))),
            update => update.call(sel => sel.transition().duration(600)
                .attr('fill', d => colorFor(d))
                .attr('r', d => radiusFor(d, useNormalized))
                .attr('cx', d => xScale(d.x))
                .attr('cy', d => yScale(d.y))
            ),
            exit => exit.call(sel => sel.transition().duration(300).attr('r', 0).remove())
        );

        // ensure data-id exists on updated circles as well
        pointsLayer.selectAll('circle').attr('data-id', d => d.id);

        // After layout transitions, record current positions for next time
        pointsLayer.selectAll('circle').each(function (d) {
            const node = this;
            const cx = parseFloat(d3.select(node).attr('cx'));
            const cy = parseFloat(d3.select(node).attr('cy'));
            lastPositions.set(d.id, { x: cx, y: cy });
        });

        // LABELING: use a force-layout to place labels when normalized view is active.
        labelsLayer.selectAll('*').remove();
        const enableLabels = labelToggle && labelToggle.checked;
        const labelAll = allLabelToggle && allLabelToggle.checked;
        if (useNormalized && enableLabels) {
            // compute screen positions for points
            const placed = points.map(d => ({
                id: d.id,
                ax: xScale(d.x),
                ay: yScale(d.y),
                label: d.label,
                length: d.length
            }));

            // choose relatively isolated candidates (keep earlier heuristic for selection)
            const isoThreshold = 26; // pixels
            function nearestDist(i) {
                let best = Infinity;
                for (let j = 0; j < placed.length; j++) {
                    if (i === j) continue;
                    const dx = placed[i].ax - placed[j].ax;
                    const dy = placed[i].ay - placed[j].ay;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d < best) best = d;
                }
                return best;
            }

            let toLabel = [];
            if (labelAll) {
                // attempt to label all points (cap to avoid extreme slowness)
                const cap = Math.min(240, placed.length);
                toLabel = placed.slice(0, cap).map(d => Object.assign({ dist: 9999 }, d));
            } else {
                const candidates = [];
                for (let i = 0; i < placed.length; i++) {
                    const nd = nearestDist(i);
                    if (nd >= isoThreshold) candidates.push(Object.assign({ dist: nd }, placed[i]));
                }
                candidates.sort((a, b) => b.dist - a.dist);
                const maxLabels = 18;
                toLabel = candidates.slice(0, maxLabels);
            }

            if (toLabel.length) {
                // map ids to point data so label handlers can show tooltips/highlight
                const pointsById = new Map(points.map(p => [p.id, p]));
                // measure text boxes using hidden text elements
                const measData = toLabel.map(d => ({ id: d.id, label: d.label }));
                const meas = labelsLayer.selectAll('text.measure').data(measData, d => d.id).join('text')
                    .attr('class', 'measure')
                    .style('font-size', '11px')
                    .style('visibility', 'hidden')
                    .text(d => d.label);

                const measurements = new Map();
                meas.each(function (d) {
                    const r = this.getBBox();
                    measurements.set(d.id, { w: r.width + 10, h: r.height + 6 });
                });
                meas.remove();

                // compute chart center (we no longer force labels radially outside the circle)
                const centerX = xScale(0);
                const centerY = yScale(0);

                // build label nodes anchored to points; initial position is slightly offset from anchor
                const labelNodes = toLabel.map(d => {
                    const m = measurements.get(d.id) || { w: 60, h: 16 };
                    // small offset outward so label boxes don't start exactly over the point
                    const offset = 8;
                    const dx = d.ax - centerX;
                    const dy = d.ay - centerY;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    const initX = d.ax + (dx / dist) * offset;
                    const initY = d.ay + (dy / dist) * offset;
                    return {
                        id: d.id,
                        label: d.label,
                        ax: d.ax,
                        ay: d.ay,
                        x: initX,
                        y: initY,
                        w: m.w,
                        h: m.h
                    };
                });

                // stop any previous simulation
                if (labelSimulation) {
                    try { labelSimulation.stop(); } catch (e) { /* ignore */ }
                    labelSimulation = null;
                }

                // synchronous force layout: pull labels toward anchors, but collide to avoid overlap
                // increase collide padding so labels have more breathing room
                labelSimulation = d3.forceSimulation(labelNodes)
                    .stop()
                    .force('x', d3.forceX(d => d.ax).strength(0.14))
                    .force('y', d3.forceY(d => d.ay).strength(0.14))
                    .force('collide', d3.forceCollide(d => Math.max(d.w, d.h) / 2 + 14).iterations(3));

                // run a number of ticks synchronously for an immediate layout
                const TICKS = 140;
                for (let i = 0; i < TICKS; i++) labelSimulation.tick();
                labelSimulation.stop();

                // clamp labels to the chart area with a breathing margin
                labelNodes.forEach(d => {
                    const halfW = d.w / 2 + 8;
                    const halfH = d.h / 2 + 8;
                    d.x = Math.max(halfW, Math.min(innerWidth - halfW, d.x));
                    d.y = Math.max(halfH, Math.min(innerHeight - halfH, d.y));
                });

                // render label groups: rect centered at x,y, text centered, leader line from anchor to label center
                const labelG = labelsLayer.selectAll('g.label').data(labelNodes, d => d.id).join(
                    enter => enter.append('g').attr('class', 'label'),
                    update => update,
                    exit => exit.remove()
                );

                labelG.transition().duration(600).attr('transform', d => `translate(${d.x},${d.y})`);

                // Allow label groups to receive pointer events so hovering a label shows tooltip
                // and highlights the corresponding point. Use inline handlers to avoid
                // relying on global CSS pointer-events settings.
                labelG.style('pointer-events', 'auto')
                    // mouse events (traditional)
                    .on('mouseenter', function (event, d) {
                        const pt = pointsById.get(d.id);
                        try { pointsLayer.select(`circle[data-id="${d.id}"]`).classed('active', true); } catch (e) { }
                        if (pt) showTooltip(event, pt);
                    })
                    .on('mousemove', function (event, d) { positionTooltip(event); })
                    .on('mouseleave', function (event, d) {
                        try { pointsLayer.select(`circle[data-id="${d.id}"]`).classed('active', false); } catch (e) { }
                        hideTooltip();
                    })
                    // pointer events (more consistent in some browsers/devices)
                    .on('pointerenter', function (event, d) {
                        const pt = pointsById.get(d.id);
                        try { pointsLayer.select(`circle[data-id="${d.id}"]`).classed('active', true); } catch (e) { }
                        if (pt) showTooltip(event, pt);
                    })
                    .on('pointermove', function (event, d) { positionTooltip(event); })
                    .on('pointerleave', function (event, d) {
                        try { pointsLayer.select(`circle[data-id="${d.id}"]`).classed('active', false); } catch (e) { }
                        hideTooltip();
                    });

                // leader lines (anchor -> label center)
                labelG.selectAll('line.leader').data(d => [d], d => d.id).join(
                    enter => enter.append('line').attr('class', 'leader'),
                    update => update,
                    exit => exit.remove()
                ).attr('x1', d => d.ax - d.x).attr('y1', d => d.ay - d.y).attr('x2', 0).attr('y2', 0)
                    .attr('stroke', 'rgba(255,255,255,0.6)').attr('stroke-width', 1).attr('opacity', 0.9);

                // label background boxes
                labelG.selectAll('rect.box').data(d => [d], d => d.id).join(
                    enter => enter.append('rect').attr('class', 'box'),
                    update => update,
                    exit => exit.remove()
                ).attr('x', d => -d.w / 2).attr('y', d => -d.h / 2)
                    .attr('width', d => d.w).attr('height', d => d.h)
                    .attr('fill', 'rgba(0,0,0,0.6)').attr('rx', 6).attr('ry', 6).attr('stroke', 'rgba(255,255,255,0.06)');

                // label text centered
                labelG.selectAll('text.lbl').data(d => [d], d => d.id).join(
                    enter => enter.append('text').attr('class', 'lbl'),
                    update => update,
                    exit => exit.remove()
                ).attr('text-anchor', 'middle').attr('dy', '0.35em')
                    .style('fill', '#fff').style('font-size', '11px').text(d => d.label);
            }
        }

        if (statusText) {
            const idx = yearOrder.indexOf(year);
            const previous = idx > 0 ? yearOrder[idx - 1] : 'prior election';
            statusText.textContent = `Comparing ${year} with ${previous}`;
        }
        if (chartNote) {
            chartNote.textContent = useNormalized
                ? 'All vectors are normalized to unit length. Hover to see raw vote deltas and notes.'
                : 'Points reflect absolute vote changes since the prior election. Hover for details.';
        }
        // If the data panel is visible, refresh the table for this year
        if (dataPanel && dataPanel.hidden === false) {
            buildTableForYear(year);
        }
    }

    function updateFromSlider() {
        const idx = Number(yearSlider.value);
        const year = yearOrder[idx];
        if (!year) return;
        yearValue.textContent = String(year);
        update(year);
        updateUrl();
    }

    // Build and manage the data table for the current year
    function buildTableForYear(year) {
        if (!dataTable) return;
        const rows = entriesByYear.get(year) || [];
        const tbody = dataTable.querySelector('tbody');
        tbody.innerHTML = '';
        const formatted = rows.map(r => {
            const d = Number.isFinite(r.dDelta) ? r.dDelta : 0;
            const rr = Number.isFinite(r.rDelta) ? r.rDelta : 0;
            const turnout = d + rr;
            const length = Math.sqrt(d * d + rr * rr);
            return Object.assign({}, r, { turnout, length });
        });

        // sort
        const key = tableSort.key;
        const dir = tableSort.dir === 'asc' ? 1 : -1;
        formatted.sort((a, b) => {
            const va = a[key];
            const vb = b[key];
            if (va == null && vb == null) return 0;
            if (va == null) return 1 * dir;
            if (vb == null) return -1 * dir;
            if (typeof va === 'string') return va.localeCompare(vb) * dir;
            return (va - vb) * dir;
        });

        formatted.forEach(r => {
            const tr = document.createElement('tr');
            tr.tabIndex = 0;
            tr.setAttribute('data-id', r.id);
            const tdLabel = document.createElement('td'); tdLabel.textContent = r.label; tr.appendChild(tdLabel);
            const tdD = document.createElement('td'); tdD.textContent = formatSignedSmall(r.dDelta); tr.appendChild(tdD);
            const tdR = document.createElement('td'); tdR.textContent = formatSignedSmall(r.rDelta); tr.appendChild(tdR);
            const tdT = document.createElement('td'); tdT.textContent = formatSignedSmall(r.turnout); tr.appendChild(tdT);
            const tdTot = document.createElement('td'); tdTot.textContent = r.totalDelta != null ? formatSignedSmall(r.totalDelta) : '\u2014'; tr.appendChild(tdTot);
            const tdLen = document.createElement('td'); tdLen.textContent = r.length != null ? formatPlain(r.length) : '\u2014'; tr.appendChild(tdLen);
            const tdNote = document.createElement('td'); tdNote.textContent = r.note || ''; tr.appendChild(tdNote);

            // hover/keyboard interactions: highlight corresponding point and show tooltip
            tr.addEventListener('mouseenter', (e) => {
                try { pointsLayer.select(`circle[data-id="${r.id}"]`).classed('active', true); } catch (e) { }
                showTooltip(e, r);
            });
            tr.addEventListener('mouseleave', () => {
                try { pointsLayer.select(`circle[data-id="${r.id}"]`).classed('active', false); } catch (e) { }
                hideTooltip();
            });
            tr.addEventListener('focus', (e) => {
                try { pointsLayer.select(`circle[data-id="${r.id}"]`).classed('active', true); } catch (e) { }
                showTooltip(e, r);
            });
            tr.addEventListener('blur', () => { try { pointsLayer.select(`circle[data-id="${r.id}"]`).classed('active', false); } catch (e) { } hideTooltip(); });

            tbody.appendChild(tr);
        });

        if (dataSummary) dataSummary.textContent = `${formatted.length} units — sorted by ${tableSort.key} ${tableSort.dir}`;
    }

    // hook sorting on header clicks
    if (dataTable) {
        const thead = dataTable.querySelector('thead');
        thead.addEventListener('click', (e) => {
            const th = e.target.closest('th');
            if (!th || !th.dataset.key) return;
            const key = th.dataset.key;
            if (tableSort.key === key) tableSort.dir = tableSort.dir === 'asc' ? 'desc' : 'asc';
            else { tableSort.key = key; tableSort.dir = 'asc'; }
            // update sorted classes
            thead.querySelectorAll('th').forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));
            th.classList.add(tableSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
            // rebuild for current year
            const idx = Number(yearSlider.value);
            const year = yearOrder[idx];
            buildTableForYear(year);
        });
    }

    // data panel toggle
    if (dataToggle && dataPanel) {
        dataToggle.addEventListener('click', () => {
            const expanded = dataPanel.hidden === false;
            if (expanded) {
                dataPanel.hidden = true; dataToggle.textContent = 'Show table'; dataToggle.setAttribute('aria-expanded', 'false');
            } else {
                dataPanel.hidden = false; dataToggle.textContent = 'Hide table'; dataToggle.setAttribute('aria-expanded', 'true');
                // build table for current year immediately
                const idx = Number(yearSlider.value);
                const year = yearOrder[idx];
                buildTableForYear(year);
            }
        });
    }

    function updateUrl() {
        try {
            const p = new URLSearchParams(window.location.search);
            const idx = Number(yearSlider.value);
            const year = yearOrder[idx];
            if (year) p.set('year', String(year)); else p.delete('year');
            p.set('symlog', logToggle.checked ? '1' : '0');
            p.set('norm', unitToggle.checked ? '1' : '0');
            p.set('labels', labelToggle && labelToggle.checked ? '1' : '0');
            p.set('allLabels', allLabelToggle && allLabelToggle.checked ? '1' : '0');
            const url = `${location.pathname}?${p.toString()}`;
            history.replaceState(null, '', url);
        } catch (e) {
            // ignore history exceptions
        }
    }

    logToggle.addEventListener('change', () => {
        updateFromSlider();
    });
    unitToggle.addEventListener('change', () => {
        updateFromSlider();
    });
    if (labelToggle) labelToggle.addEventListener('change', () => { updateFromSlider(); updateUrl(); });
    if (allLabelToggle) allLabelToggle.addEventListener('change', () => { updateFromSlider(); updateUrl(); });
    yearSlider.addEventListener('input', () => {
        updateFromSlider();
    });

    const dataPromise = dataLoader
        ? dataLoader.loadPresidentialMargins()
        : d3.csv(DATA_PATH, d3.autoType);

    if (!dataLoader) {
        console.warn('[Shift Vectors] DataLoader not found; using direct CSV load.');
    }

    dataPromise.then(raw => {
        if (!Array.isArray(raw) || !raw.length) throw new Error('Empty dataset');
        //console.log('raw data', raw);
        const structured = raw.map(row => ({
            year: clampNumber(row.year),
            abbr: (row.abbr || '').trim(),
            dDelta: clampNumber(row.D_delta),
            rDelta: clampNumber(row.R_delta),
            totalDelta: Number.isFinite(row.total_delta) ? clampNumber(row.total_delta) : null,
            // try to capture an absolute total-votes field if present in the CSV
            totalVotes: (Number.isFinite(row.total_votes) ? clampNumber(row.total_votes)
                : (Number.isFinite(row.total) ? clampNumber(row.total) : null)),
            presDelta: (Number.isFinite(row.pres_margin_delta) ? clampNumber(row.pres_margin_delta) : null),
            note: row.special_case_notes ? String(row.special_case_notes).trim() : ''
        })).filter(row => row.year && row.abbr);

        const grouped = d3.group(structured, d => d.year);
        //console.log('grouped', grouped);
        let years = Array.from(grouped.keys()).sort((a, b) => a - b);
        if (!years.length) throw new Error('No years found');

        const minYear = years[0];
        years = years.filter(y => y > minYear);
        years = years.filter(y => {
            const rows = grouped.get(y) || [];
            return rows.some(hasDelta);
        });

        if (!years.length) throw new Error('No usable vote deltas in dataset');

        yearOrder = years;
        entriesByYear = new Map(years.map(year => {
            const rows = grouped.get(year) || [];
            return [year, rows.map(row => ({
                id: `${row.abbr}-${year}`,
                label: row.abbr,
                dDelta: row.dDelta,
                rDelta: row.rDelta,
                totalDelta: row.totalDelta,
                note: row.note
            }))];
        }));

        yearSlider.max = String(yearOrder.length - 1);
        yearSlider.value = String(yearOrder.length - 1);
        yearSlider.disabled = false;
        const latestYear = yearOrder[yearOrder.length - 1];
        // apply URL params if provided
        const paramYear = urlParams.get('year');
        const symlogParam = urlParams.get('symlog');
        const normParam = urlParams.get('norm');
        const labelsParam = urlParams.get('labels');
        const allLabelsParam = urlParams.get('allLabels');

        if (symlogParam != null) { logToggle.checked = symlogParam === '1'; }
        if (normParam != null) { unitToggle.checked = normParam === '1'; }
        if (labelsParam != null && labelToggle) { labelToggle.checked = labelsParam === '1'; }
        if (allLabelsParam != null && allLabelToggle) { allLabelToggle.checked = allLabelsParam === '1'; }

        if (paramYear && yearOrder.includes(Number(paramYear))) {
            const idx = yearOrder.indexOf(Number(paramYear));
            yearSlider.value = String(idx);
            yearValue.textContent = String(paramYear);
        } else {
            yearValue.textContent = String(latestYear);
        }
        yearValue.classList.add('badge');
        if (statusText) statusText.textContent = `Comparing ${latestYear} with ${yearOrder[yearOrder.length - 2] || 'prior election'}`;
        if (pointSummary) pointSummary.hidden = false;
        update(Number(yearValue.textContent));
        updateUrl();
    }).catch(err => {
        console.error('Failed to load presidential margins data', err);
        if (statusText) statusText.textContent = 'Failed to load presidential margins data.';
        if (noDataEl) noDataEl.hidden = false;
    });
})();
