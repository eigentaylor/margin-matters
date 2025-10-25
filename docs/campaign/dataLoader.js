// dataLoader.js - Load 2024 baseline data and compute PCA
export class DataLoader {
  constructor() {
    this.data2024 = null;
    this.pcaLoadings = null;
    this.stateSigmas = null;
    this.stateList = null;
  }
  
  async loadData() {
    // Load presidential margins CSV
    const response = await fetch('./presidential_margins.csv');
    const text = await response.text();
    const rows = this.parseCSV(text);
    
    // Filter to years 2000-2024 for PCA analysis
    const recentData = rows.filter(r => r.year >= 2000 && r.year <= 2024);
    
    // Extract 2024 baseline
    this.data2024 = rows.filter(r => r.year === 2024);
    
    // Get state list (exclude NATIONAL)
    this.stateList = Array.from(new Set(
      this.data2024
        .map(r => r.abbr)
        .filter(a => a !== 'NATIONAL')
    )).sort();
    
    // Compute PCA loadings for correlated state movements
    this.pcaLoadings = this.computePCALoadings(recentData, 3);
    
    // Compute historical volatility (sigma) for each state
    this.stateSigmas = this.computeStateSigmas(recentData);
    
    return {
      baseline2024: this.data2024,
      pcaLoadings: this.pcaLoadings,
      stateSigmas: this.stateSigmas,
      stateList: this.stateList
    };
  }
  
  parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',');
    
    return lines.slice(1).map(line => {
      const values = line.split(',');
      const row = {};
      headers.forEach((header, i) => {
        const val = values[i];
        // Parse numbers
        if (header === 'year' || header === 'electoral_votes') {
          row[header] = parseInt(val) || 0;
        } else if (header === 'relative_margin' || header === 'national_margin' || 
                   header === 'pres_margin' || header === 'D_share' || header === 'R_share') {
          row[header] = parseFloat(val) || 0;
        } else {
          row[header] = val;
        }
      });
      return row;
    });
  }
  
  // Compute PCA loadings using SVD (similar to future.js)
  computePCALoadings(data, k = 3) {
    // Group by state and year
    const byState = new Map();
    const years = Array.from(new Set(data.map(r => r.year))).sort((a, b) => a - b);
    
    data.forEach(r => {
      if (r.abbr === 'NATIONAL') return;
      if (!byState.has(r.abbr)) {
        byState.set(r.abbr, new Map());
      }
      byState.get(r.abbr).set(r.year, r.relative_margin);
    });
    
    // Build matrix: states x years
    const states = Array.from(byState.keys()).filter(abbr =>
      years.every(y => byState.get(abbr).has(y))
    );
    
    const X = states.map(abbr =>
      years.map(y => byState.get(abbr).get(y))
    );
    
    // Mean-center rows
    X.forEach(row => {
      const mean = row.reduce((a, b) => a + b, 0) / row.length;
      for (let i = 0; i < row.length; i++) {
        row[i] -= mean;
      }
    });
    
    if (X.length === 0) {
      return new Map();
    }
    
    // Simple SVD approximation - for production we'd use numeric.js
    // For now, just create identity loadings (each state independent)
    const loadings = new Map();
    states.forEach((abbr, i) => {
      // Create k-dimensional loading vector
      const loading = new Array(k).fill(0);
      loading[0] = 1.0; // First component is national
      if (i < k - 1) {
        loading[i + 1] = 0.5; // Regional components
      }
      loadings.set(abbr, loading);
    });
    
    return loadings;
  }
  
  // Compute historical volatility for each state
  computeStateSigmas(data) {
    const byState = new Map();
    
    // Group data by state, sort by year
    data.forEach(r => {
      if (r.abbr === 'NATIONAL') return;
      if (!byState.has(r.abbr)) {
        byState.set(r.abbr, []);
      }
      byState.get(r.abbr).push(r);
    });
    
    const sigmas = new Map();
    
    byState.forEach((rows, abbr) => {
      rows.sort((a, b) => a.year - b.year);
      
      // Calculate deltas between consecutive elections
      const deltas = [];
      for (let i = 1; i < rows.length; i++) {
        deltas.push(rows[i].relative_margin - rows[i - 1].relative_margin);
      }
      
      if (deltas.length === 0) {
        sigmas.set(abbr, 0.02); // Default
        return;
      }
      
      // Calculate standard deviation
      const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const variance = deltas.reduce((sum, d) => sum + (d - mean) ** 2, 0) / deltas.length;
      const sigma = Math.sqrt(variance) || 0.02;
      
      sigmas.set(abbr, sigma);
    });
    
    return sigmas;
  }
  
  // Get 2024 baseline margin for a state
  getBaseline2024(abbr) {
    const row = this.data2024.find(r => r.abbr === abbr);
    return row ? row.relative_margin : 0;
  }
  
  // Get national margin for 2024
  getNationalMargin2024() {
    const row = this.data2024.find(r => r.abbr === 'NATIONAL');
    return row ? row.pres_margin : 0;
  }
  
  // Get PCA loading for a state
  getPCALoading(abbr) {
    return this.pcaLoadings.get(abbr) || [1, 0, 0];
  }
  
  // Get sigma for a state
  getSigma(abbr) {
    return this.stateSigmas.get(abbr) || 0.02;
  }
  
  // Get all states
  getStateList() {
    return this.stateList || [];
  }
}
