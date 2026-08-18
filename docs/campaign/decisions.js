// decisions.js - Player decision framework
import { getDifficulty } from './difficulty.js';

export class DecisionSystem {
  constructor(gameState, dataLoader) {
    this.gameState = gameState;
    this.dataLoader = dataLoader;
    this.difficulty = getDifficulty(gameState.difficulty);
  }
  
  // Get available decisions for current phase
  getAvailableDecisions() {
    const decisions = [];
    
    // National campaign decisions
    decisions.push({
      id: 'national-ads',
      title: 'National Ad Campaign',
      description: 'Run nationwide advertising to improve national standing.',
      cost: 20,
      type: 'national',
      execute: () => this.executeNationalAds()
    });
    
    decisions.push({
      id: 'debate-prep',
      title: 'Debate Preparation',
      description: 'Invest time in debate prep for better performance.',
      cost: 15,
      type: 'preparation',
      execute: () => this.executeDebatePrep()
    });
    
    // State-focused decisions
    decisions.push({
      id: 'swing-state-tour',
      title: 'Swing State Tour',
      description: 'Campaign intensively in key battleground states.',
      cost: 25,
      type: 'state',
      execute: () => this.executeSwingStateTour()
    });
    
    decisions.push({
      id: 'targeted-outreach',
      title: 'Targeted State Outreach',
      description: 'Focus resources on specific competitive states.',
      cost: 20,
      type: 'state',
      execute: () => this.executeTargetedOutreach()
    });
    
    // Research/Intelligence decisions
    decisions.push({
      id: 'internal-polling',
      title: 'Commission Internal Polls',
      description: 'Get more accurate polling data with less bias.',
      cost: 15,
      type: 'research',
      execute: () => this.executeInternalPolling()
    });
    
    decisions.push({
      id: 'opposition-research',
      title: 'Opposition Research',
      description: 'Investigate opponent for potential advantages.',
      cost: 10,
      type: 'research',
      execute: () => this.executeOppositionResearch()
    });
    
    // Ground game decisions
    decisions.push({
      id: 'gotv',
      title: 'Get Out The Vote',
      description: 'Mobilize supporters in key areas.',
      cost: 18,
      type: 'ground',
      execute: () => this.executeGOTV()
    });
    
    decisions.push({
      id: 'rally',
      title: 'Major Rally',
      description: 'Hold a large rally to energize base.',
      cost: 12,
      type: 'national',
      execute: () => this.executeRally()
    });
    
    return decisions;
  }
  
  // Execute a decision
  executeDecision(decision) {
    // Check if player has enough resources
    if (!this.gameState.spendResources(decision.cost)) {
      return {
        success: false,
        message: 'Not enough resources'
      };
    }
    
    // Execute decision and get result
    const result = decision.execute();
    
    // Apply difficulty modifiers
    const effectiveness = this.difficulty.stateElasticity;
    result.npvDelta = (result.npvDelta || 0) * effectiveness;
    
    if (result.stateDeltas) {
      result.stateDeltas = result.stateDeltas.map(sd => ({
        ...sd,
        delta: sd.delta * effectiveness
      }));
    }
    
    // Apply to game state
    if (result.npvDelta) {
      this.gameState.applyNpvDelta(result.npvDelta);
    }
    
    if (result.stateDeltas) {
      result.stateDeltas.forEach(({ abbr, delta }) => {
        this.gameState.applyStateDelta(abbr, delta);
      });
    }
    
    // Record decision
    this.gameState.makeDecision({
      id: decision.id,
      title: decision.title,
      cost: decision.cost,
      result: result
    });
    
    // Add event
    this.gameState.addEvent({
      type: 'decision',
      title: decision.title,
      description: result.message
    });
    
    return {
      success: true,
      result: result
    };
  }
  
  // Decision implementations
  executeNationalAds() {
    const impact = 0.3 + this.gameState.rng() * 0.4;
    return {
      npvDelta: impact,
      message: `National ad campaign moves polls by +${impact.toFixed(1)}pp nationwide.`
    };
  }
  
  executeDebatePrep() {
    // Store prep bonus for future debate events
    const bonus = 0.5 + this.gameState.rng() * 0.3;
    return {
      npvDelta: 0.1, // Small immediate boost
      message: `Debate preparation improves confidence. Expect better debate performance.`
    };
  }
  
  executeSwingStateTour() {
    // Affect top swing states
    const stateList = this.dataLoader.getStateList();
    const margins2024 = stateList.map(abbr => ({
      abbr,
      margin: Math.abs(this.dataLoader.getBaseline2024(abbr))
    }));
    
    // Sort by closest margins
    margins2024.sort((a, b) => a.margin - b.margin);
    
    // Pick top 5 swing states
    const swingStates = margins2024.slice(0, 5);
    const stateDeltas = swingStates.map(({ abbr }) => ({
      abbr,
      delta: 0.8 + this.gameState.rng() * 0.6
    }));
    
    return {
      stateDeltas,
      message: `Swing state tour boosts support in ${swingStates.map(s => s.abbr).join(', ')}.`
    };
  }
  
  executeTargetedOutreach() {
    // Player can choose states, but for now pick random competitive ones
    const stateList = this.dataLoader.getStateList();
    const numStates = 3;
    const targetStates = [];
    
    for (let i = 0; i < numStates; i++) {
      const idx = Math.floor(this.gameState.rng() * stateList.length);
      targetStates.push(stateList[idx]);
    }
    
    const stateDeltas = targetStates.map(abbr => ({
      abbr,
      delta: 0.6 + this.gameState.rng() * 0.5
    }));
    
    return {
      stateDeltas,
      message: `Targeted outreach improves standing in ${targetStates.join(', ')}.`
    };
  }
  
  executeInternalPolling() {
    // Reduce poll bias
    const biasReduction = 0.3 + this.gameState.rng() * 0.2;
    this.gameState.pollBias *= (1 - biasReduction);
    
    return {
      message: `Internal polling provides clearer picture of race. Poll accuracy improved.`
    };
  }
  
  executeOppositionResearch() {
    const rand = this.gameState.rng();
    
    if (rand < 0.6) {
      // Find something useful
      const impact = 0.4 + this.gameState.rng() * 0.4;
      return {
        npvDelta: impact,
        message: `Opposition research uncovers useful information. Support increases +${impact.toFixed(1)}pp.`
      };
    } else {
      // Nothing major found
      return {
        npvDelta: 0.1,
        message: `Opposition research yields minimal results.`
      };
    }
  }
  
  executeGOTV() {
    // GOTV helps in multiple states
    const stateList = this.dataLoader.getStateList();
    const numStates = Math.floor(3 + this.gameState.rng() * 4);
    const targetStates = [];
    
    for (let i = 0; i < numStates; i++) {
      const idx = Math.floor(this.gameState.rng() * stateList.length);
      if (!targetStates.includes(stateList[idx])) {
        targetStates.push(stateList[idx]);
      }
    }
    
    const stateDeltas = targetStates.map(abbr => ({
      abbr,
      delta: 0.3 + this.gameState.rng() * 0.3
    }));
    
    return {
      npvDelta: 0.2,
      stateDeltas,
      message: `GOTV efforts boost turnout and support across ${targetStates.length} states.`
    };
  }
  
  executeRally() {
    const impact = 0.4 + this.gameState.rng() * 0.3;
    return {
      npvDelta: impact,
      message: `Major rally energizes base. National support increases +${impact.toFixed(1)}pp.`
    };
  }
}
