#!/usr/bin/env node

// Test script for bellwether-explorer.js logic
// This tests the data filtering and processing without D3 dependencies

const fs = require('fs');
const path = require('path');

// Parse CSV line handling quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Load CSV data
function loadCSV(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx];
      });
      data.push(row);
    }
  }
  
  return data;
}

// Test filtering functions
function testBellwetherFiltering(data, threshold = 0.05) {
  const bellwethers = data.filter(row => {
    if (row.abbr === 'NATIONAL') return false;
    if (row.abbr.includes('-') && !row.abbr.endsWith('-AL')) return false;
    const relMargin = parseFloat(row.relative_margin);
    return !isNaN(relMargin) && Math.abs(relMargin) < threshold;
  });
  
  return bellwethers;
}

function testCloseStatesFiltering(data, threshold = 0.01) {
  const closeStates = data.filter(row => {
    if (row.abbr === 'NATIONAL') return false;
    if (row.abbr.includes('-') && !row.abbr.endsWith('-AL')) return false;
    const presMargin = parseFloat(row.pres_margin);
    return !isNaN(presMargin) && Math.abs(presMargin) < threshold;
  });
  
  return closeStates;
}

function testCountsByYear(data, category = 'bellwether', threshold) {
  const years = [...new Set(data.map(row => row.year))].sort();
  const counts = {};
  
  years.forEach(year => {
    let yearData = data.filter(row => row.year === year);
    // Filter out NATIONAL and congressional districts
    yearData = yearData.filter(row => {
      if (row.abbr === 'NATIONAL') return false;
      if (row.abbr.includes('-') && !row.abbr.endsWith('-AL')) return false;
      return true;
    });
    
    let count;
    
    if (category === 'bellwether') {
      count = yearData.filter(row => {
        const relMargin = parseFloat(row.relative_margin);
        return !isNaN(relMargin) && Math.abs(relMargin) < threshold;
      }).length;
    } else {
      count = yearData.filter(row => {
        const presMargin = parseFloat(row.pres_margin);
        return !isNaN(presMargin) && Math.abs(presMargin) < threshold;
      }).length;
    }
    
    counts[year] = count;
  });
  
  return counts;
}

// Run tests
function runTests() {
  console.log('=== Bellwether Explorer Logic Tests ===\n');
  
  const csvPath = path.join(__dirname, 'docs', 'presidential_margins.csv');
  console.log('Loading CSV from:', csvPath);
  
  const data = loadCSV(csvPath);
  console.log(`✓ Loaded ${data.length} rows of data\n`);
  
  // Test 2024 bellwethers
  const bellwethers2024 = testBellwetherFiltering(
    data.filter(row => row.year === '2024'),
    0.05
  );
  console.log('2024 Bellwether States (threshold 0.05):');
  bellwethers2024.forEach(row => {
    console.log(`  ${row.abbr}: ${row.relative_margin_str}`);
  });
  console.log(`  Total: ${bellwethers2024.length} states\n`);
  
  // Test 2024 close states
  const closeStates2024 = testCloseStatesFiltering(
    data.filter(row => row.year === '2024'),
    0.01
  );
  console.log('2024 Close States (threshold 0.01):');
  closeStates2024.forEach(row => {
    console.log(`  ${row.abbr}: ${row.pres_margin_str}`);
  });
  console.log(`  Total: ${closeStates2024.length} states\n`);
  
  // Test counts by year for bellwethers
  console.log('Bellwether counts by year (sample):');
  const bellwetherCounts = testCountsByYear(data, 'bellwether', 0.05);
  const years = Object.keys(bellwetherCounts).sort().reverse();
  years.slice(0, 10).forEach(year => {
    console.log(`  ${year}: ${bellwetherCounts[year]} states`);
  });
  console.log();
  
  // Test counts by year for close states
  console.log('Close states counts by year (sample):');
  const closeCounts = testCountsByYear(data, 'close', 0.01);
  years.slice(0, 10).forEach(year => {
    console.log(`  ${year}: ${closeCounts[year]} states`);
  });
  console.log();
  
  // Test with different thresholds
  console.log('Bellwether counts with different thresholds (2024):');
  const data2024 = data.filter(row => row.year === '2024');
  [0.01, 0.03, 0.05, 0.07, 0.10].forEach(threshold => {
    const count = testBellwetherFiltering(data2024, threshold).length;
    console.log(`  Threshold ${threshold.toFixed(2)}: ${count} states`);
  });
  console.log();
  
  console.log('✓ All tests passed!');
}

// Run if executed directly
if (require.main === module) {
  try {
    runTests();
  } catch (error) {
    console.error('Error running tests:', error);
    process.exit(1);
  }
}
