(function () {
    'use strict';

    // State for the visualization
    let tippingPointData = [];
    let showPopularVote = false;
    let useAbsoluteValue = false;
    let showDifference = false;
    let chart = null;

    // Load stop_colors.csv and extract tipping point data
    async function loadTippingPointData() {
        try {
            const response = await fetch('stop_colors.csv');
            const text = await response.text();
            const lines = text.trim().split('\n');
            const headers = lines[0].split(',');

            const data = [];
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',');
                const row = {};
                headers.forEach((header, idx) => {
                    row[header] = values[idx];
                });

                // Only include rows where IS_TIPPING_POINT is true
                if (row.IS_TIPPING_POINT === 'true') {
                    data.push({
                        year: parseInt(row.year),
                        tippingPoint: parseFloat(row.stop),
                        unit: row.unit,
                        isTie: row.IS_TIE_STOP === 'true'
                    });
                }
            }

            return data;
        } catch (error) {
            console.error('Error loading tipping point data:', error);
            return [];
        }
    }

    // Load presidential margins to get national_margin
    async function loadPresidentialMargins() {
        try {
            const response = await fetch('presidential_margins.csv');
            const text = await response.text();
            const lines = text.trim().split('\n');
            const headers = lines[0].split(',');

            const margins = new Map();
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',');
                const row = {};
                headers.forEach((header, idx) => {
                    row[header] = values[idx];
                });

                // Only get NATIONAL rows
                if (row.abbr === 'NATIONAL' || row.abbr === 'NAT') {
                    margins.set(parseInt(row.year), parseFloat(row.national_margin));
                }
            }

            return margins;
        } catch (error) {
            console.error('Error loading presidential margins:', error);
            return new Map();
        }
    }

    // Draw the chart using Canvas
    function drawChart(tippingData, nationalMargins) {
        const canvas = document.getElementById('tipping-point-chart');
        const ctx = canvas.getContext('2d');

        // Set canvas size based on container
        const container = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = container.clientWidth * dpr;
        canvas.height = 600 * dpr;
        canvas.style.width = container.clientWidth + 'px';
        canvas.style.height = '600px';
        ctx.scale(dpr, dpr);

        const width = container.clientWidth;
        const height = 600;
        const padding = { top: 40, right: 40, bottom: 60, left: 80 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        if (tippingData.length === 0) {
            ctx.fillStyle = '#a5a5a5';
            ctx.font = '16px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('No tipping point data available', width / 2, height / 2);
            return;
        }

        // Prepare data
        const years = tippingData.map(d => d.year);
        const minYear = Math.min(...years);
        const maxYear = Math.max(...years);

        // Get values based on current mode
        let values;
        if (showDifference) {
            // Show difference: PV - Tipping Point
            values = tippingData.map(d => {
                const pv = nationalMargins.get(d.year) || 0;
                return pv - d.tippingPoint;
            });
        } else {
            values = tippingData.map(d => d.tippingPoint);
        }

        if (useAbsoluteValue) {
            values = values.map(v => Math.abs(v));
        }

        const maxValue = Math.max(...values.map(v => Math.abs(v)), 0.1);
        const minValue = useAbsoluteValue ? 0 : -maxValue;

        // Helper functions for coordinate transformation
        function xScale(year) {
            return padding.left + ((year - minYear) / (maxYear - minYear)) * chartWidth;
        }

        function yScale(value) {
            return padding.top + chartHeight - ((value - minValue) / (maxValue - minValue)) * chartHeight;
        }

        // Draw axes
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 1;

        // Y-axis
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, padding.top + chartHeight);
        ctx.stroke();

        // X-axis
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top + chartHeight);
        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.stroke();

        // Draw zero line (if not in absolute value mode)
        if (!useAbsoluteValue) {
            const zeroY = yScale(0);
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(padding.left, zeroY);
            ctx.lineTo(padding.left + chartWidth, zeroY);
            ctx.stroke();
        }

        // Draw Y-axis labels
        ctx.fillStyle = '#a5a5a5';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const yTicks = useAbsoluteValue ? 
            [0, maxValue * 0.25, maxValue * 0.5, maxValue * 0.75, maxValue] :
            [minValue, minValue * 0.5, 0, maxValue * 0.5, maxValue];

        yTicks.forEach(tick => {
            const y = yScale(tick);
            ctx.fillText((tick * 100).toFixed(1) + '%', padding.left - 10, y);
            
            // Draw grid line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        });

        // Draw X-axis labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const yearStep = Math.ceil((maxYear - minYear) / 10);
        for (let year = minYear; year <= maxYear; year += yearStep) {
            const x = xScale(year);
            ctx.fillText(year.toString(), x, padding.top + chartHeight + 10);
        }

        // Draw axis labels
        ctx.fillStyle = '#f5f5f5';
        ctx.font = '14px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Year', width / 2, height - 20);

        ctx.save();
        ctx.translate(20, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        const yLabel = showDifference ? 'Difference (PV - Tipping Point)' : 
                       'Tipping Point Margin';
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();

        // Fill area between tipping point and zero (if not in abs mode and not showing difference)
        if (!useAbsoluteValue && !showDifference) {
            const zeroY = yScale(0);
            
            for (let i = 0; i < tippingData.length - 1; i++) {
                const year1 = tippingData[i].year;
                const year2 = tippingData[i + 1].year;
                const value1 = values[i];
                const value2 = values[i + 1];
                
                const x1 = xScale(year1);
                const x2 = xScale(year2);
                const y1 = yScale(value1);
                const y2 = yScale(value2);
                
                // Determine fill color based on which party is advantaged
                // Positive tipping point = Republicans advantaged
                // Negative tipping point = Democrats advantaged
                const avgValue = (value1 + value2) / 2;
                ctx.fillStyle = avgValue > 0 ? 'rgba(178, 34, 34, 0.2)' : 'rgba(30, 75, 209, 0.2)';
                
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.lineTo(x2, zeroY);
                ctx.lineTo(x1, zeroY);
                ctx.closePath();
                ctx.fill();
            }
        }

        // Draw popular vote line if enabled
        if (showPopularVote && !showDifference) {
            ctx.strokeStyle = 'rgba(102, 179, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();

            let firstPoint = true;
            tippingData.forEach((d, i) => {
                const pv = nationalMargins.get(d.year);
                if (pv !== undefined) {
                    const value = useAbsoluteValue ? Math.abs(pv) : pv;
                    const x = xScale(d.year);
                    const y = yScale(value);
                    
                    if (firstPoint) {
                        ctx.moveTo(x, y);
                        firstPoint = false;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
            });
            ctx.stroke();
        }

        // Draw tipping point line
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 3;
        ctx.beginPath();

        tippingData.forEach((d, i) => {
            const x = xScale(d.year);
            const y = yScale(values[i]);
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        // Draw points for tipping points
        tippingData.forEach((d, i) => {
            const x = xScale(d.year);
            const y = yScale(values[i]);
            
            // Draw point
            ctx.fillStyle = d.isTie ? '#ffd700' : '#888';
            ctx.beginPath();
            ctx.arc(x, y, d.isTie ? 6 : 4, 0, 2 * Math.PI);
            ctx.fill();
            
            // If it's a tie, add a ring
            if (d.isTie) {
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, 8, 0, 2 * Math.PI);
                ctx.stroke();
            }
        });

        // Add interactive tooltips (simplified - just showing values on hover would need more complex logic)
        canvas.onmousemove = function(e) {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // Find closest data point
            let closestDist = Infinity;
            let closestData = null;
            let closestIndex = -1;
            
            tippingData.forEach((d, i) => {
                const x = xScale(d.year);
                const y = yScale(values[i]);
                const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
                
                if (dist < closestDist && dist < 20) {
                    closestDist = dist;
                    closestData = d;
                    closestIndex = i;
                }
            });
            
            if (closestData) {
                canvas.style.cursor = 'pointer';
                canvas.title = `${closestData.year}: ${closestData.unit}, TP=${(closestData.tippingPoint * 100).toFixed(2)}%`;
            } else {
                canvas.style.cursor = 'default';
                canvas.title = '';
            }
        };
    }

    // Initialize the page
    async function init() {
        const [tippingData, nationalMargins] = await Promise.all([
            loadTippingPointData(),
            loadPresidentialMargins()
        ]);

        tippingPointData = tippingData;

        // Set up button handlers
        document.getElementById('btn-show-pv').addEventListener('click', function() {
            showPopularVote = !showPopularVote;
            this.classList.toggle('active', showPopularVote);
            drawChart(tippingPointData, nationalMargins);
        });

        document.getElementById('btn-abs-value').addEventListener('click', function() {
            useAbsoluteValue = !useAbsoluteValue;
            this.classList.toggle('active', useAbsoluteValue);
            drawChart(tippingPointData, nationalMargins);
        });

        document.getElementById('btn-show-diff').addEventListener('click', function() {
            showDifference = !showDifference;
            this.classList.toggle('active', showDifference);
            // When showing difference, disable popular vote overlay
            if (showDifference) {
                showPopularVote = false;
                document.getElementById('btn-show-pv').classList.remove('active');
            }
            drawChart(tippingPointData, nationalMargins);
        });

        // Initial draw
        drawChart(tippingPointData, nationalMargins);

        // Redraw on window resize
        let resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                drawChart(tippingPointData, nationalMargins);
            }, 250);
        });
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
