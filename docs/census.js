/**
 * Census Reapportionment Explorer
 * Visualizes electoral vote changes across decennial census reapportionments
 */
(function () {
    'use strict';

    // Census years and the elections they apply to
    const CENSUS_YEARS = [1870, 1880, 1890, 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

    // Map census year to first election year it affects
    // Census results are used starting with the election 2 years after (e.g., 1870 census -> 1872 election)
    function getElectionYearsForCensus(censusYear) {
        // Return all election years y such that censusYear < y <= censusYear + 10 and y is a presidential election (y % 4 == 0)
        const elections = [];
        const start = censusYear + 1;
        const end = censusYear + 10;
        for (let y = start; y <= end; y++) {
            if ((y % 4) === 0 && y <= 2024) {
                elections.push(y);
            }
        }
        return elections;
    }

    // State data storage
    let evData = new Map(); // year -> Map(abbr -> {state, ev})
    let allStates = new Set();

    // DOM elements
    const censusYearSlider = document.getElementById('censusYearSlider');
    const censusYearVal = document.getElementById('censusYearVal');
    const electionYearsEl = document.getElementById('electionYears');
    const statesGainedEl = document.getElementById('statesGained');
    const statesLostEl = document.getElementById('statesLost');
    const statesSameEl = document.getElementById('statesSame');
    const statesNewEl = document.getElementById('statesNew');
    const totalEVsEl = document.getElementById('totalEVs');
    const stateGridEl = document.getElementById('stateGrid');
    const changeListsEl = document.getElementById('changeLists');
    const censusTimelineEl = document.getElementById('censusTimeline');
    const stateFilterEl = document.getElementById('stateFilter');

    // Load electoral college data
    async function loadData() {
        try {
            const response = await fetch('./electoral_college.csv');
            const text = await response.text();
            parseCSV(text);
            initUI();
        } catch (error) {
            console.error('Failed to load electoral college data:', error);
            stateGridEl.innerHTML = '<div class="loading-text">Failed to load data. Please refresh.</div>';
        }
    }

    function parseCSV(text) {
        const lines = text.trim().split('\n');
        const header = lines[0].split(',');

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            const year = parseInt(cols[0]);
            const abbr = cols[1];
            const state = cols[2];
            // Normalize electoral votes: treat empty or non-numeric values as null
            let ev = null;
            if (cols[3] !== undefined && cols[3] !== null) {
                const raw = cols[3].trim();
                if (raw !== '') {
                    const n = Number(raw);
                    if (Number.isFinite(n)) ev = n;
                    else ev = null;
                }
            }

            if (!evData.has(year)) {
                evData.set(year, new Map());
            }

            // Only add entries with a valid abbreviation (skip empty rows)
            if (abbr && abbr.trim() !== '') {
                evData.get(year).set(abbr, { state, ev });
                allStates.add(abbr);
            }
        }
    }

    function initUI() {
        // Update slider to work with census years
        censusYearSlider.min = 1870;
        censusYearSlider.max = 2020;
        censusYearSlider.step = 10;
        censusYearSlider.value = 2020;

        censusYearSlider.addEventListener('input', () => {
            const year = parseInt(censusYearSlider.value);
            censusYearVal.textContent = year;
            updateOverview(year);
        });

        // Initialize tabs
        document.querySelectorAll('.tab-nav .btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                switchTab(tab);
            });
        });

        // Initialize state filter
        populateStateFilter();
        stateFilterEl.addEventListener('change', updateHistoryTable);

        // Initial render
        updateOverview(2020);
        buildTimeline();
        buildTotalEVChart();
        updateHistoryTable();
        buildBiggestChanges();
    }

    function switchTab(tabId) {
        document.querySelectorAll('.tab-nav .btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `tab-${tabId}`);
        });
    }

    function getStateDataForCensus(censusYear) {
        // Get the first election year after this census
        const electionYear = censusYear + 2;
        // Round to nearest presidential election year
        const presElectionYear = Math.ceil(electionYear / 4) * 4;

        // Find data for this election year
        const currentData = evData.get(presElectionYear) || new Map();

        // Get previous census data
        const prevCensus = censusYear - 10;
        const prevElectionYear = prevCensus + 2;
        const prevPresYear = Math.ceil(prevElectionYear / 4) * 4;
        const prevData = evData.get(prevPresYear) || new Map();

        return { currentData, prevData, presElectionYear, prevPresYear };
    }

    function updateOverview(censusYear) {
        // Get data for this census and previous
        const { currentData, prevData, presElectionYear, prevPresYear } = getStateDataForCensus(censusYear);

        // Calculate changes
        const gained = [];
        const lost = [];
        const same = [];
        const newStates = [];
        let totalEV = 0;

        currentData.forEach((data, abbr) => {
            if (!Number.isFinite(data.ev)) return;

            totalEV += data.ev;

            const prevEntry = prevData.get(abbr);
            const prevEV = prevEntry?.ev;

            if (prevEV === null || prevEV === undefined || !Number.isFinite(prevEV)) {
                // New state (didn't exist or had no EVs before)
                newStates.push({ abbr, state: data.state, ev: data.ev, change: data.ev });
            } else if (data.ev > prevEV) {
                gained.push({ abbr, state: data.state, ev: data.ev, change: data.ev - prevEV, prevEV });
            } else if (data.ev < prevEV) {
                lost.push({ abbr, state: data.state, ev: data.ev, change: data.ev - prevEV, prevEV });
            } else {
                same.push({ abbr, state: data.state, ev: data.ev });
            }
        });

        // Sort by change magnitude
        gained.sort((a, b) => b.change - a.change);
        lost.sort((a, b) => a.change - b.change);
        newStates.sort((a, b) => b.ev - a.ev);

        // Update summary stats
        statesGainedEl.textContent = gained.length;
        statesLostEl.textContent = lost.length;
        statesSameEl.textContent = same.length;
        statesNewEl.textContent = newStates.length;
        totalEVsEl.textContent = totalEV;

        // Update election years display
        const elections = getElectionYearsForCensus(censusYear);
        electionYearsEl.textContent = elections.join(', ');

        // Update state grid
        updateStateGrid(currentData, prevData, gained, lost, same, newStates);

        // Update change lists
        updateChangeLists(gained, lost, newStates, censusYear);
    }

    function updateStateGrid(currentData, prevData, gained, lost, same, newStates) {
        const gainedSet = new Set(gained.map(s => s.abbr));
        const lostSet = new Set(lost.map(s => s.abbr));
        const newSet = new Set(newStates.map(s => s.abbr));

        // Sort states alphabetically
        const states = Array.from(currentData.entries())
            .filter(([abbr, data]) => data.ev !== null)
            .sort((a, b) => a[0].localeCompare(b[0]));

        let html = '';
        for (const [abbr, data] of states) {
            const prevEntry = prevData.get(abbr);
            const prevEV = prevEntry?.ev;
            // Compute change only when both values are finite
            const change = (Number.isFinite(data.ev) && Number.isFinite(prevEV)) ? (data.ev - prevEV) : null;

            let className = 'state-cell';
            let deltaText = '';

            if (newSet.has(abbr)) {
                className += ' new-state';
                deltaText = 'NEW';
            } else if (gainedSet.has(abbr) && change !== null) {
                className += ' gained';
                deltaText = `+${change}`;
            } else if (lostSet.has(abbr) && change !== null) {
                className += ' lost';
                deltaText = `${change}`;
            } else {
                className += ' no-change';
            }

            const prevText = (prevEV !== null && prevEV !== undefined && Number.isFinite(prevEV)) ? ` (was ${prevEV})` : '';
            const evDisplay = Number.isFinite(data.ev) ? `${data.ev} EV` : '—';
            html += `
                <div class="${className}" title="${data.state}: ${evDisplay}${prevText}">
                    <div class="abbr">${abbr}</div>
                    <div class="ev">${evDisplay}</div>
                    ${deltaText ? `<div class="delta">${deltaText}</div>` : ''}
                </div>
            `;
        }

        stateGridEl.innerHTML = html;
    }

    function updateChangeLists(gained, lost, newStates, censusYear) {
        let html = '';

        // Special note for 1920
        if (censusYear === 1920) {
            html += `
                <div class="change-section" style="background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3);">
                    <h3 style="color: #ffc107;">⚠️ Historical Note: 1920 Census</h3>
                    <p class="legend" style="margin-top: 8px;">
                        Congress refused to enact a reapportionment based on the 1920 census, 
                        marking the only time in U.S. history that reapportionment was not conducted 
                        following a decennial census. The 1910 apportionment remained in effect until 
                        the 1930 census results were implemented.
                    </p>
                </div>
            `;
        }

        if (gained.length > 0) {
            html += `
                <div class="change-section gained">
                    <h3>📈 States That Gained EVs (${gained.reduce((sum, s) => sum + s.change, 0)} total)</h3>
                    ${gained.map(s => `
                        <div class="change-item">
                            <span class="state-name">${s.state} (${s.abbr})</span>
                            <span class="change-value gain">+${s.change} (${s.prevEV} → ${s.ev})</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (lost.length > 0) {
            html += `
                <div class="change-section lost">
                    <h3>📉 States That Lost EVs (${Math.abs(lost.reduce((sum, s) => sum + s.change, 0))} total)</h3>
                    ${lost.map(s => `
                        <div class="change-item">
                            <span class="state-name">${s.state} (${s.abbr})</span>
                            <span class="change-value loss">${s.change} (${s.prevEV} → ${s.ev})</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (newStates.length > 0) {
            html += `
                <div class="change-section new">
                    <h3>🆕 Newly Admitted States/Territories</h3>
                    ${newStates.map(s => `
                        <div class="change-item">
                            <span class="state-name">${s.state} (${s.abbr})</span>
                            <span class="change-value new">${s.ev} EVs</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (!gained.length && !lost.length && !newStates.length) {
            html = '<div class="change-section"><p class="muted">No changes in this reapportionment.</p></div>';
        }

        changeListsEl.innerHTML = html;
    }

    function buildTimeline() {
        let html = '';

        for (const year of CENSUS_YEARS) {
            const { currentData } = getStateDataForCensus(year);
            let totalEV = 0;
            currentData.forEach((data) => {
                if (data.ev !== null && data.ev !== undefined && !isNaN(data.ev)) {
                    totalEV += data.ev;
                }
            });

            html += `
                <div class="timeline-year${year === 2020 ? ' active' : ''}" data-year="${year}">
                    <div class="year-label">${year}</div>
                    <div class="year-total">${totalEV} EVs</div>
                </div>
            `;
        }

        censusTimelineEl.innerHTML = html;

        // Add click handlers
        censusTimelineEl.querySelectorAll('.timeline-year').forEach(el => {
            el.addEventListener('click', () => {
                const year = parseInt(el.dataset.year);
                censusYearSlider.value = year;
                censusYearVal.textContent = year;
                updateOverview(year);

                // Update active state
                censusTimelineEl.querySelectorAll('.timeline-year').forEach(y => {
                    y.classList.toggle('active', parseInt(y.dataset.year) === year);
                });
            });
        });
    }

    function buildTotalEVChart() {
        const svg = d3.select('#evHistoryChart');
        const margin = { top: 20, right: 30, bottom: 40, left: 50 };
        const width = 800 - margin.left - margin.right;
        const height = 250 - margin.top - margin.bottom;

        svg.selectAll('*').remove();

        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Prepare data
        const data = CENSUS_YEARS.map(year => {
            const { currentData } = getStateDataForCensus(year);
            let totalEV = 0;
            currentData.forEach((d) => {
                if (d.ev !== null && d.ev !== undefined && !isNaN(d.ev)) {
                    totalEV += d.ev;
                }
            });
            return { year, totalEV };
        });

        // Scales
        const x = d3.scaleLinear()
            .domain([1870, 2020])
            .range([0, width]);

        const y = d3.scaleLinear()
            .domain([0, d3.max(data, d => d.totalEV) * 1.1])
            .range([height, 0]);

        // Axes
        g.append('g')
            .attr('class', 'axis')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(8));

        g.append('g')
            .attr('class', 'axis')
            .call(d3.axisLeft(y).ticks(5));

        // Line
        const line = d3.line()
            .x(d => x(d.year))
            .y(d => y(d.totalEV));

        g.append('path')
            .datum(data)
            .attr('fill', 'none')
            .attr('stroke', '#4169E1')
            .attr('stroke-width', 2)
            .attr('d', line);

        // Points
        g.selectAll('.point')
            .data(data)
            .enter()
            .append('circle')
            .attr('class', 'point')
            .attr('cx', d => x(d.year))
            .attr('cy', d => y(d.totalEV))
            .attr('r', 5)
            .attr('fill', '#4169E1')
            .attr('stroke', '#fff')
            .attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('click', (event, d) => {
                censusYearSlider.value = d.year;
                censusYearVal.textContent = d.year;
                updateOverview(d.year);
                switchTab('overview');
            })
            .append('title')
            .text(d => `${d.year}: ${d.totalEV} EVs`);

        // 270 threshold line
        g.append('line')
            .attr('x1', 0)
            .attr('x2', width)
            .attr('y1', y(270))
            .attr('y2', y(270))
            .attr('stroke', 'rgba(255,255,255,0.3)')
            .attr('stroke-dasharray', '4 4');

        g.append('text')
            .attr('x', width - 5)
            .attr('y', y(270) - 5)
            .attr('text-anchor', 'end')
            .attr('fill', 'rgba(255,255,255,0.5)')
            .attr('font-size', '0.75rem')
            .text('270 to win');

        // Labels
        g.append('text')
            .attr('x', width / 2)
            .attr('y', height + 35)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--muted)')
            .attr('font-size', '0.8rem')
            .text('Census Year');

        g.append('text')
            .attr('transform', 'rotate(-90)')
            .attr('x', -height / 2)
            .attr('y', -40)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--muted)')
            .attr('font-size', '0.8rem')
            .text('Total Electoral Votes');
    }

    function buildBiggestChanges() {
        const changes = [];

        for (const year of CENSUS_YEARS) {
            const { currentData, prevData } = getStateDataForCensus(year);

            let biggestGain = { abbr: '', state: '', change: 0 };
            let biggestLoss = { abbr: '', state: '', change: 0 };
            let totalGains = 0;
            let totalLosses = 0;
            let prevTotal = 0;
            let currTotal = 0;

            currentData.forEach((data, abbr) => {
                if (data.ev === null || data.ev === undefined || isNaN(data.ev)) return;
                currTotal += data.ev;

                const prevEntry = prevData.get(abbr);
                const prevEV = prevEntry?.ev;
                if (prevEV === null || prevEV === undefined || isNaN(prevEV)) return;
                const change = data.ev - prevEV;

                if (change > 0) {
                    totalGains += change;
                    if (change > biggestGain.change) {
                        biggestGain = { abbr, state: data.state, change };
                    }
                } else if (change < 0) {
                    totalLosses += Math.abs(change);
                    if (change < biggestLoss.change) {
                        biggestLoss = { abbr, state: data.state, change };
                    }
                }
            });

            prevData.forEach((data) => {
                if (data.ev !== null && data.ev !== undefined && !isNaN(data.ev)) {
                    prevTotal += data.ev;
                }
            });

            changes.push({
                year,
                totalChange: currTotal - prevTotal,
                totalGains,
                totalLosses,
                biggestGain,
                biggestLoss,
                currTotal
            });
        }

        let html = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Census</th>
                        <th>Total EVs</th>
                        <th>Net Change</th>
                        <th>Biggest Gainer</th>
                        <th>Biggest Loser</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (const c of changes) {
            const netClass = c.totalChange > 0 ? 'gain' : c.totalChange < 0 ? 'loss' : '';
            html += `
                <tr>
                    <td><strong>${c.year}</strong></td>
                    <td>${c.currTotal}</td>
                    <td>
                        <span class="change-value ${netClass}">
                            ${c.totalChange > 0 ? '+' : ''}${c.totalChange}
                        </span>
                    </td>
                    <td>
                        ${c.biggestGain.abbr ? `${c.biggestGain.state} (+${c.biggestGain.change})` : '—'}
                    </td>
                    <td>
                        ${c.biggestLoss.abbr ? `${c.biggestLoss.state} (${c.biggestLoss.change})` : '—'}
                    </td>
                </tr>
            `;
        }

        html += '</tbody></table>';
        document.getElementById('biggestChangesList').innerHTML = html;
    }

    function populateStateFilter() {
        const sortedStates = Array.from(allStates).sort();
        let html = '<option value="">All States</option>';
        for (const abbr of sortedStates) {
            // Find full name from any year's data
            for (const yearData of evData.values()) {
                const entry = yearData.get(abbr);
                if (entry?.state) {
                    html += `<option value="${abbr}">${entry.state} (${abbr})</option>`;
                    break;
                }
            }
        }
        stateFilterEl.innerHTML = html;
    }

    function updateHistoryTable() {
        const filterState = stateFilterEl.value;
        const thead = document.querySelector('#historyTable thead tr');
        const tbody = document.querySelector('#historyTable tbody');

        // Build header with census years
        let headerHtml = '<th>State</th>';
        for (const year of CENSUS_YEARS) {
            headerHtml += `<th>${year}</th>`;
        }
        thead.innerHTML = headerHtml;

        // Collect all states with EV data
        const statesWithData = new Map();

        for (const year of CENSUS_YEARS) {
            const { currentData } = getStateDataForCensus(year);
            currentData.forEach((data, abbr) => {
                if (data.ev !== null && data.ev !== undefined && Number.isFinite(data.ev)) {
                    if (!statesWithData.has(abbr)) {
                        statesWithData.set(abbr, { state: data.state, evByYear: new Map() });
                    }
                    statesWithData.get(abbr).evByYear.set(year, data.ev);
                }
            });
        }

        // Sort and filter
        let states = Array.from(statesWithData.entries())
            .sort((a, b) => a[1].state.localeCompare(b[1].state));

        if (filterState) {
            states = states.filter(([abbr]) => abbr === filterState);
        }

        // Build rows
        let bodyHtml = '';
        for (const [abbr, data] of states) {
            bodyHtml += `<tr><td><strong>${data.state}</strong> (${abbr})</td>`;

            let prevEV = null;
            for (const year of CENSUS_YEARS) {
                const ev = data.evByYear.get(year);
                if (!Number.isFinite(ev)) {
                    bodyHtml += '<td class="muted">—</td>';
                    prevEV = null;
                } else {
                    let changeHtml = '';
                    if (Number.isFinite(prevEV)) {
                        const change = ev - prevEV;
                        if (change > 0) {
                            changeHtml = `<span class="ev-change-indicator"><span class="arrow up">▲${change}</span></span>`;
                        } else if (change < 0) {
                            changeHtml = `<span class="ev-change-indicator"><span class="arrow down">▼${Math.abs(change)}</span></span>`;
                        }
                    }
                    bodyHtml += `<td>${ev} ${changeHtml}</td>`;
                    prevEV = ev;
                }
            }

            bodyHtml += '</tr>';
        }

        tbody.innerHTML = bodyHtml;
    }

    // Initialize
    loadData();
})();
