'use strict';

import { formatter } from './formatters.js';
import { getAllEvAllocations } from './evAllocation.js';
import { getStateName } from './constants.js';

let currentSort = { column: 'state', ascending: true };
let listenersBound = false;

function ensureButtonVisible(btn) {
    if (btn) btn.style.display = 'inline-block';
}

function sortAllocations(allocations) {
    const sorted = [...allocations];
    const { column, ascending } = currentSort;

    sorted.sort((a, b) => {
        let aVal;
        let bVal;

        switch (column) {
            case 'state':
                aVal = a.stateName;
                bVal = b.stateName;
                break;
            case 'margin':
                aVal = a.dPct === null ? -1 : a.dPct;
                bVal = b.dPct === null ? -1 : b.dPct;
                break;
            case 'd':
                aVal = a.dEV === null ? -1 : a.dEV;
                bVal = b.dEV === null ? -1 : b.dEV;
                break;
            case 'r':
                aVal = a.rEV === null ? -1 : a.rEV;
                bVal = b.rEV === null ? -1 : b.rEV;
                break;
            case 'o':
                aVal = a.oEV === null ? -1 : a.oEV;
                bVal = b.oEV === null ? -1 : b.oEV;
                break;
            case 'total':
                aVal = a.totalEV;
                bVal = b.totalEV;
                break;
            default:
                if (column && column.startsWith('tp-')) {
                    const tpName = column.substring(3);
                    aVal = (a.thirdPartyEVs && a.thirdPartyEVs[tpName]) || 0;
                    bVal = (b.thirdPartyEVs && b.thirdPartyEVs[tpName]) || 0;
                } else {
                    return 0;
                }
        }

        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return ascending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return ascending ? (aVal - bVal) : (bVal - aVal);
    });

    return sorted;
}

function isProportionalModeEnabled() {
    try {
        const toggle = document.getElementById('propEvToggle');
        return !!(toggle && toggle.checked);
    } catch (e) {
        console.warn(e);
        return false;
    }
}

export function updateEvBreakdownTable() {
    const tbody = document.getElementById('evBreakdownBody');
    const table = document.getElementById('evBreakdownTable');
    if (!tbody || !table) return;

    const allocations = getAllEvAllocations();
    const sorted = sortAllocations(Array.isArray(allocations) ? allocations : []);

    const isProportional = isProportionalModeEnabled();

    let dCandidate = '';
    let rCandidate = '';
    const thirdPartyNames = new Set();
    const thirdPartyTotals = {};
    let hasAnyThirdPartyEVs = false;
    let totalOtherEV_ForHeader = 0;

    sorted.forEach(alloc => {
        if (!dCandidate && alloc.dCandidate) dCandidate = alloc.dCandidate;
        if (!rCandidate && alloc.rCandidate) rCandidate = alloc.rCandidate;

        if (alloc.thirdPartyEVs && typeof alloc.thirdPartyEVs === 'object') {
            Object.keys(alloc.thirdPartyEVs).forEach(name => {
                const v = alloc.thirdPartyEVs[name] || 0;
                if (v > 0) {
                    thirdPartyNames.add(name);
                    thirdPartyTotals[name] = (thirdPartyTotals[name] || 0) + v;
                    hasAnyThirdPartyEVs = true;
                }
            });
        }
        if (alloc.oEV > 0) {
            hasAnyThirdPartyEVs = true;
            totalOtherEV_ForHeader += alloc.oEV;
        }
    });

    const thirdPartyList = Array.from(thirdPartyNames).sort();
    const showOColumn = isProportional || hasAnyThirdPartyEVs;

    try {
        const candidateNamesEl = document.getElementById('candidateNames');
        if (candidateNamesEl) {
            const yearLabel = (window._curYear || '');
            const base = (dCandidate || rCandidate) ? `${yearLabel} : ${dCandidate} (D) vs ${rCandidate} (R)` : '';
            let extra = '';
            if (thirdPartyList.length > 0) {
                extra = '<br>' + thirdPartyList.map(name => {
                    const cnt = thirdPartyTotals[name] || 0;
                    return cnt > 0 ? `${name} (${cnt} ${cnt === 1 ? 'EV' : 'EVs'})` : name;
                }).join(', ');
            } else if (hasAnyThirdPartyEVs && thirdPartyList.length === 0) {
                extra = '<br>Other' + (totalOtherEV_ForHeader > 0 ? ` (${totalOtherEV_ForHeader} EVs)` : '');
            }
            if (base || extra) candidateNamesEl.innerHTML = (base || '') + extra;
        }
    } catch (e) { console.warn(e); }

    const thead = table.querySelector('thead');
    if (thead) {
        const headerRow = thead.querySelector('tr');
        if (headerRow) {
            headerRow.innerHTML = '';

            const makeSortableHeader = (label, column) => {
                const th = document.createElement('th');
                th.className = 'sortable';
                th.setAttribute('data-column', column);
                th.textContent = label;
                return th;
            };

            headerRow.appendChild(makeSortableHeader('State', 'state'));
            headerRow.appendChild(makeSortableHeader('Margin (D%, R%)', 'margin'));

            const getLastName = (fullName) => {
                if (!fullName) return '';
                const parts = String(fullName).trim().split(/\s+/);
                return parts.length ? parts[parts.length - 1] : '';
            };

            const dLastName = getLastName(dCandidate);
            const rLastName = getLastName(rCandidate);
            headerRow.appendChild(makeSortableHeader(dLastName ? `${dLastName} (D) EVs` : 'D EVs', 'd'));
            headerRow.appendChild(makeSortableHeader(rLastName ? `${rLastName} (R) EVs` : 'R EVs', 'r'));

            if (thirdPartyList.length > 0) {
                thirdPartyList.forEach(name => {
                    headerRow.appendChild(makeSortableHeader(`${name} EVs`, `tp-${name}`));
                });
            } else if (showOColumn) {
                headerRow.appendChild(makeSortableHeader('O EVs', 'o'));
            }

            headerRow.appendChild(makeSortableHeader('Total EVs', 'total'));
        }
    }

    const headers = table.querySelectorAll('th.sortable');
    headers.forEach(header => {
        const column = header.getAttribute('data-column');
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);
        newHeader.addEventListener('click', () => {
            if (currentSort.column === column) {
                currentSort.ascending = !currentSort.ascending;
            } else {
                currentSort.column = column;
                currentSort.ascending = true;
            }
            updateEvBreakdownTable();
        });
        newHeader.classList.remove('sorted-asc', 'sorted-desc');
        if (column === currentSort.column) {
            newHeader.classList.add(currentSort.ascending ? 'sorted-asc' : 'sorted-desc');
        }
    });

    tbody.innerHTML = '';

    let totalD = 0;
    let totalR = 0;
    let totalO = 0;
    let totalAll = 0;
    const totalThirdParties = {};
    thirdPartyList.forEach(name => { totalThirdParties[name] = 0; });

    const ensureStateName = alloc => alloc.stateName || getStateName(alloc.state);

    const getLastName = (fullName) => {
        if (!fullName) return '';
        const parts = String(fullName).trim().split(/\s+/);
        return parts.length ? parts[parts.length - 1] : '';
    };

    sorted.forEach(alloc => {
        const row = document.createElement('tr');
        row.setAttribute('data-state', alloc.state);

        const stateCell = document.createElement('td');
        stateCell.textContent = ensureStateName(alloc);
        if (!alloc.showBlank && alloc.dVotes !== null) {
            const voteInfo = [];
            if (alloc.dVotes > 0) {
                const dLast = getLastName(alloc.dCandidate);
                voteInfo.push(`D${dLast ? ' (' + dLast + ')' : ''}: ${formatter(alloc.dVotes)}`);
            }
            if (alloc.rVotes > 0) {
                const rLast = getLastName(alloc.rCandidate);
                voteInfo.push(`R${rLast ? ' (' + rLast + ')' : ''}: ${formatter(alloc.rVotes)}`);
            }
            if (alloc.oVotes > 0) voteInfo.push(`O: ${formatter(alloc.oVotes)}`);
            stateCell.title = voteInfo.join(' | ');
        }
        row.appendChild(stateCell);

        const marginCell = document.createElement('td');
        if (alloc.showBlank) {
            marginCell.textContent = '—';
            marginCell.classList.add('blank-entry');
        } else {
            const dPct = alloc.dPct || 0;
            const rPct = alloc.rPct || 0;
            marginCell.textContent = `${dPct.toFixed(1)}%, ${rPct.toFixed(1)}%`;
        }
        row.appendChild(marginCell);

        const dCell = document.createElement('td');
        if (alloc.showBlank) {
            dCell.textContent = '—';
            dCell.classList.add('blank-entry');
        } else {
            const dEV = alloc.dEV || 0;
            const percent = alloc.totalEV > 0 ? Math.round((dEV / alloc.totalEV) * 100) : 0;
            dCell.textContent = dEV > 0 ? `${dEV} (${percent}%)` : dEV;
            totalD += dEV;
        }
        row.appendChild(dCell);

        const rCell = document.createElement('td');
        if (alloc.showBlank) {
            rCell.textContent = '—';
            rCell.classList.add('blank-entry');
        } else {
            const rEV = alloc.rEV || 0;
            const percent = alloc.totalEV > 0 ? Math.round((rEV / alloc.totalEV) * 100) : 0;
            rCell.textContent = rEV > 0 ? `${rEV} (${percent}%)` : rEV;
            totalR += rEV;
        }
        row.appendChild(rCell);

        if (thirdPartyList.length > 0) {
            thirdPartyList.forEach(name => {
                const tpCell = document.createElement('td');
                if (alloc.showBlank) {
                    tpCell.textContent = '—';
                    tpCell.classList.add('blank-entry');
                } else {
                    const tpEV = (alloc.thirdPartyEVs && alloc.thirdPartyEVs[name]) || 0;
                    const percent = alloc.totalEV > 0 ? Math.round((tpEV / alloc.totalEV) * 100) : 0;
                    tpCell.textContent = tpEV > 0 ? `${tpEV} (${percent}%)` : tpEV;
                    totalThirdParties[name] = (totalThirdParties[name] || 0) + tpEV;
                    if (alloc.thirdPartyVotes && alloc.thirdPartyVotes[name]) {
                        const votes = alloc.thirdPartyVotes[name];
                        const totalVotes = alloc.dVotes + alloc.rVotes + alloc.oVotes;
                        const votePct = totalVotes > 0 ? ((votes / totalVotes) * 100).toFixed(1) : '0.0';
                        tpCell.title = `${formatter(votes)} votes (${votePct}%)`;
                    }
                }
                row.appendChild(tpCell);
            });
        } else if (showOColumn) {
            const oCell = document.createElement('td');
            if (alloc.showBlank) {
                oCell.textContent = '—';
                oCell.classList.add('blank-entry');
            } else {
                const oEV = alloc.oEV || 0;
                const percent = alloc.totalEV > 0 ? Math.round((oEV / alloc.totalEV) * 100) : 0;
                oCell.textContent = oEV > 0 ? `${oEV} (${percent}%)` : oEV;
                totalO += oEV;
                if (alloc.oVotes > 0) {
                    const totalVotes = alloc.dVotes + alloc.rVotes + alloc.oVotes;
                    const votePct = totalVotes > 0 ? ((alloc.oVotes / totalVotes) * 100).toFixed(1) : '0.0';
                    oCell.title = `${formatter(alloc.oVotes)} votes (${votePct}%)`;
                }
            }
            row.appendChild(oCell);
        }

        const totalCell = document.createElement('td');
        totalCell.textContent = alloc.totalEV;
        totalAll += alloc.totalEV;
        row.appendChild(totalCell);

        tbody.appendChild(row);
    });

    const totalRow = document.createElement('tr');
    totalRow.classList.add('total-row');

    const totalLabelCell = document.createElement('td');
    totalLabelCell.textContent = 'Total';
    totalLabelCell.style.fontWeight = 'bold';
    totalRow.appendChild(totalLabelCell);

    const totalMarginCell = document.createElement('td');
    totalMarginCell.textContent = '—';
    totalMarginCell.style.fontWeight = 'bold';
    totalRow.appendChild(totalMarginCell);

    const appendTotalCell = (value, percent) => {
        const cell = document.createElement('td');
        cell.textContent = value > 0 ? `${value} (${percent}%)` : value;
        cell.style.fontWeight = 'bold';
        totalRow.appendChild(cell);
    };

    const totalDPercent = totalAll > 0 ? ((totalD / totalAll) * 100).toFixed(1) : '0.0';
    appendTotalCell(totalD, totalDPercent);

    const totalRPercent = totalAll > 0 ? ((totalR / totalAll) * 100).toFixed(1) : '0.0';
    appendTotalCell(totalR, totalRPercent);

    if (thirdPartyList.length > 0) {
        thirdPartyList.forEach(name => {
            const totalTP = totalThirdParties[name] || 0;
            const pct = totalAll > 0 ? ((totalTP / totalAll) * 100).toFixed(1) : '0.0';
            appendTotalCell(totalTP, pct);
        });
    } else if (showOColumn) {
        const totalOPercent = totalAll > 0 ? ((totalO / totalAll) * 100).toFixed(1) : '0.0';
        appendTotalCell(totalO, totalOPercent);
    }

    const totalAllCell = document.createElement('td');
    totalAllCell.textContent = totalAll;
    totalAllCell.style.fontWeight = 'bold';
    totalRow.appendChild(totalAllCell);

    tbody.appendChild(totalRow);
}

export function initEvBreakdownModal() {
    if (listenersBound) return;

    const propEvToggle = document.getElementById('propEvToggle');
    const evBreakdownBtn = document.getElementById('evBreakdownBtn');
    const evBreakdownModal = document.getElementById('evBreakdownModal');
    const evBreakdownClose = document.getElementById('evBreakdownClose');

    if (!propEvToggle || !evBreakdownBtn || !evBreakdownModal) return;

    listenersBound = true;
    ensureButtonVisible(evBreakdownBtn);

    propEvToggle.addEventListener('change', () => {
        if (evBreakdownModal.style.display === 'flex') updateEvBreakdownTable();
    });

    evBreakdownBtn.addEventListener('click', () => {
        updateEvBreakdownTable();
        evBreakdownModal.style.display = 'flex';
    });

    if (evBreakdownClose) {
        evBreakdownClose.addEventListener('click', () => {
            evBreakdownModal.style.display = 'none';
        });
    }

    evBreakdownModal.addEventListener('click', (e) => {
        if (e.target === evBreakdownModal) evBreakdownModal.style.display = 'none';
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && evBreakdownModal.style.display === 'flex') {
            evBreakdownModal.style.display = 'none';
        }
    });

    const table = document.getElementById('evBreakdownTable');
    if (table) {
        table.querySelectorAll('th.sortable').forEach(header => {
            header.addEventListener('click', function () {
                const column = this.getAttribute('data-column');
                if (currentSort.column === column) {
                    currentSort.ascending = !currentSort.ascending;
                } else {
                    currentSort.column = column;
                    currentSort.ascending = true;
                }
                updateEvBreakdownTable();
            });
        });
    }

    const yearSlider = document.getElementById('yearSlider');
    if (yearSlider) {
        yearSlider.addEventListener('input', () => {
            if (evBreakdownModal.style.display === 'flex') {
                setTimeout(() => updateEvBreakdownTable(), 50);
            }
        });
    }

    const pvSlider = document.getElementById('pvSlider');
    if (pvSlider) {
        pvSlider.addEventListener('input', () => {
            if (evBreakdownModal.style.display === 'flex') {
                setTimeout(() => updateEvBreakdownTable(), 50);
            }
        });
    }
}

function handleDomReady() {
    try { initEvBreakdownModal(); } catch (e) { console.warn(e); }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handleDomReady, { once: true });
    } else {
        handleDomReady();
    }
}

try { window.updateEvBreakdownTable = updateEvBreakdownTable; } catch (e) { console.warn(e); }
try { window.initEvBreakdownModal = initEvBreakdownModal; } catch (e) { console.warn(e); }
try { if (typeof getAllEvAllocations === 'function') window.getAllEvAllocations = getAllEvAllocations; } catch (e) { console.warn(e); }