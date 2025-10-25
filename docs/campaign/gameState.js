// gameState.js - Manages the overall game state
export class GameState {
  constructor(config) {
    this.playerParty = config.playerParty; // 'D' or 'R'
    this.playerCandidate = config.playerCandidate;
    this.opponentCandidate = config.opponentCandidate;
    this.difficulty = config.difficulty;
    
    // Game progression
    this.currentPhase = 1;
    this.maxPhases = 10;
    this.decisionsPerPhase = 3;
    this.decisionsRemaining = this.decisionsPerPhase;
    
    // Resources
    this.resources = 100;
    this.maxResources = 100;
    
    // National Popular Vote shift (accumulated over game)
    this.npvDelta = 0;
    
    // State-specific deltas (abbr -> delta in percentage points)
    this.stateDeltas = new Map();
    
    // Polling data (includes bias and uncertainty)
    this.currentPolls = new Map(); // abbr -> { margin, uncertainty, lastUpdated }
    this.pollBias = 0; // systematic bias towards/against player
    
    // Event history
    this.events = [];
    
    // Decisions made
    this.decisions = [];
    
    // Random seed for reproducibility
    this.seed = config.seed || Math.floor(Math.random() * 1e9);
    this.rng = this.createRng(this.seed);
    
    // Game status
    this.isComplete = false;
    this.finalResults = null;
  }
  
  createRng(seed) {
    // Simple mulberry32 PRNG for reproducibility
    let t = (seed >>> 0) + 0x6D2B79F5;
    return function() {
      t |= 0;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  
  // Initialize state deltas for all states
  initializeStateDeltas(stateList) {
    stateList.forEach(abbr => {
      this.stateDeltas.set(abbr, 0);
    });
  }
  
  // Make a decision
  makeDecision(decision) {
    if (this.decisionsRemaining <= 0) {
      throw new Error('No decisions remaining this phase');
    }
    
    this.decisions.push({
      phase: this.currentPhase,
      decision: decision
    });
    
    this.decisionsRemaining--;
    return this.decisionsRemaining;
  }
  
  // Add an event to history
  addEvent(event) {
    this.events.push({
      phase: this.currentPhase,
      timestamp: Date.now(),
      ...event
    });
  }
  
  // Get the incumbent party (R in 2028)
  getIncumbentParty() {
    return 'R';
  }
  
  // Check if player is incumbent party
  isPlayerIncumbent() {
    return this.playerParty === this.getIncumbentParty();
  }
  
  // Advance to next phase
  advancePhase() {
    if (this.currentPhase >= this.maxPhases) {
      this.isComplete = true;
      return false;
    }
    
    this.currentPhase++;
    this.decisionsRemaining = this.decisionsPerPhase;
    
    // Small resource regeneration each phase
    this.resources = Math.min(
      this.maxResources,
      this.resources + Math.floor(10 + this.rng() * 5)
    );
    
    return true;
  }
  
  // Spend resources
  spendResources(amount) {
    if (amount > this.resources) {
      return false;
    }
    this.resources -= amount;
    return true;
  }
  
  // Apply NPV delta
  applyNpvDelta(delta) {
    this.npvDelta += delta;
  }
  
  // Apply state delta
  applyStateDelta(abbr, delta) {
    const current = this.stateDeltas.get(abbr) || 0;
    this.stateDeltas.set(abbr, current + delta);
  }
  
  // Get current state delta
  getStateDelta(abbr) {
    return this.stateDeltas.get(abbr) || 0;
  }
  
  // Get progress through campaign (0 to 1)
  getProgress() {
    return this.currentPhase / this.maxPhases;
  }
  
  // Serialize state for saving
  toJSON() {
    return {
      playerParty: this.playerParty,
      playerCandidate: this.playerCandidate,
      opponentCandidate: this.opponentCandidate,
      difficulty: this.difficulty,
      currentPhase: this.currentPhase,
      decisionsRemaining: this.decisionsRemaining,
      resources: this.resources,
      npvDelta: this.npvDelta,
      stateDeltas: Array.from(this.stateDeltas.entries()),
      currentPolls: Array.from(this.currentPolls.entries()),
      pollBias: this.pollBias,
      events: this.events,
      decisions: this.decisions,
      seed: this.seed,
      isComplete: this.isComplete,
      finalResults: this.finalResults
    };
  }
  
  // Restore from saved state
  static fromJSON(data) {
    const config = {
      playerParty: data.playerParty,
      playerCandidate: data.playerCandidate,
      opponentCandidate: data.opponentCandidate,
      difficulty: data.difficulty,
      seed: data.seed
    };
    
    const state = new GameState(config);
    state.currentPhase = data.currentPhase;
    state.decisionsRemaining = data.decisionsRemaining;
    state.resources = data.resources;
    state.npvDelta = data.npvDelta;
    state.stateDeltas = new Map(data.stateDeltas);
    state.currentPolls = new Map(data.currentPolls);
    state.pollBias = data.pollBias;
    state.events = data.events;
    state.decisions = data.decisions;
    state.isComplete = data.isComplete;
    state.finalResults = data.finalResults;
    
    return state;
  }
}
