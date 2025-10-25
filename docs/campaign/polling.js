// polling.js - Poll generation with bias and uncertainty
import { getDifficulty } from './difficulty.js';

export class PollingSystem {
  constructor(gameState, dataLoader) {
    this.gameState = gameState;
    this.dataLoader = dataLoader;
    this.difficulty = getDifficulty(gameState.difficulty);
    
    // Initialize systematic poll bias
    // This represents a consistent error in polls (like 2016/2020)
    this.systematicBias = (this.gameState.rng() - 0.5) * 4; // -2 to +2pp
  }
  
  // Generate polls for all states in current phase
  generatePolls() {
    const stateList = this.dataLoader.getStateList();
    const polls = new Map();
    
    // Poll accuracy improves as campaign progresses
    const progress = this.gameState.getProgress();
    const baseUncertainty = this.getBaseUncertainty(progress);
    
    stateList.forEach(abbr => {
      const poll = this.generateStatePoll(abbr, baseUncertainty);
      polls.set(abbr, poll);
    });
    
    // Also generate national poll
    const nationalPoll = this.generateNationalPoll(baseUncertainty);
    polls.set('NATIONAL', nationalPoll);
    
    this.gameState.currentPolls = polls;
    return polls;
  }
  
  // Get base uncertainty for current phase
  getBaseUncertainty(progress) {
    // Uncertainty decreases as election approaches
    // Early campaign: ~5pp, late campaign: ~2pp
    const earlyUncertainty = 5.0;
    const lateUncertainty = 2.0;
    
    const uncertainty = earlyUncertainty - (earlyUncertainty - lateUncertainty) * progress;
    
    // Apply difficulty modifier
    return uncertainty / this.difficulty.pollAccuracyBonus;
  }
  
  // Generate poll for a specific state
  generateStatePoll(abbr, baseUncertainty) {
    // True margin = 2024 baseline + NPV shift + state delta
    const baseline2024 = this.dataLoader.getBaseline2024(abbr);
    const npvDelta = this.gameState.npvDelta;
    const stateDelta = this.gameState.getStateDelta(abbr);
    
    const trueMargin = baseline2024 + npvDelta + stateDelta;
    
    // Add systematic bias
    const biasedMargin = trueMargin + this.systematicBias;
    
    // Add random sampling error
    const samplingError = this.randn() * baseUncertainty;
    const polledMargin = biasedMargin + samplingError;
    
    // State-specific uncertainty (varies by state size/volatility)
    const stateSigma = this.dataLoader.getSigma(abbr);
    const uncertainty = baseUncertainty * (1 + stateSigma / 0.05);
    
    return {
      margin: polledMargin,
      uncertainty: uncertainty,
      trueMargin: trueMargin, // Hidden from player!
      phase: this.gameState.currentPhase
    };
  }
  
  // Generate national popular vote poll
  generateNationalPoll(baseUncertainty) {
    const baseline2024National = this.dataLoader.getNationalMargin2024();
    const npvDelta = this.gameState.npvDelta;
    
    // Apply difficulty national lean
    const difficultyLean = this.difficulty.nationalLean;
    const playerSign = this.gameState.playerParty === 'D' ? 1 : -1;
    
    const trueMargin = baseline2024National + npvDelta + (difficultyLean * playerSign);
    
    // National polls typically have smaller uncertainty than state polls
    const nationalUncertainty = baseUncertainty * 0.6;
    
    const biasedMargin = trueMargin + this.systematicBias;
    const samplingError = this.randn() * nationalUncertainty;
    const polledMargin = biasedMargin + samplingError;
    
    return {
      margin: polledMargin,
      uncertainty: nationalUncertainty,
      trueMargin: trueMargin,
      phase: this.gameState.currentPhase
    };
  }
  
  // Get poll for a state
  getPoll(abbr) {
    return this.gameState.currentPolls.get(abbr);
  }
  
  // Get margin category for display
  getMarginCategory(margin) {
    const abs = Math.abs(margin);
    if (abs < 2) return 'toss-up';
    if (abs < 5) return 'lean';
    if (abs < 10) return 'likely';
    return 'safe';
  }
  
  // Get color for margin
  getMarginColor(margin) {
    const party = margin > 0 ? 'R' : 'D';
    const category = this.getMarginCategory(margin);
    
    if (category === 'toss-up') return '#d1d5db';
    if (party === 'R') {
      if (category === 'safe') return '#ef4444';
      if (category === 'likely') return '#f87171';
      return '#fca5a5';
    } else {
      if (category === 'safe') return '#3b82f6';
      if (category === 'likely') return '#60a5fa';
      return '#93c5fd';
    }
  }
  
  // Format margin for display
  formatMargin(margin, includeParty = true) {
    const abs = Math.abs(margin);
    const party = margin > 0 ? 'R' : 'D';
    
    if (includeParty) {
      return `${party}+${abs.toFixed(1)}`;
    } else {
      return abs.toFixed(1);
    }
  }
  
  // Normal distribution random number generator
  randn() {
    // Box-Muller transform
    const u1 = this.gameState.rng();
    const u2 = this.gameState.rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
