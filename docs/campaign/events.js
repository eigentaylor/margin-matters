// events.js - Random campaign events using Poisson distribution
import { getDifficulty } from './difficulty.js';

export class EventSystem {
  constructor(gameState, dataLoader) {
    this.gameState = gameState;
    this.dataLoader = dataLoader;
    this.difficulty = getDifficulty(gameState.difficulty);
  }
  
  // Generate events for current phase using Poisson distribution
  generatePhaseEvents() {
    const lambda = this.difficulty.eventRate;
    const numEvents = this.poissonSample(lambda);
    
    const events = [];
    for (let i = 0; i < numEvents; i++) {
      events.push(this.generateRandomEvent());
    }
    
    return events;
  }
  
  // Sample from Poisson distribution
  poissonSample(lambda) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    
    do {
      k++;
      p *= this.gameState.rng();
    } while (p > L);
    
    return k - 1;
  }
  
  // Generate a random event
  generateRandomEvent() {
    const rand = this.gameState.rng();
    const isIncumbent = this.gameState.isPlayerIncumbent();
    
    // Event categories
    if (rand < 0.3) {
      return this.generateEconomicEvent(isIncumbent);
    } else if (rand < 0.5) {
      return this.generateScandal();
    } else if (rand < 0.7) {
      return this.generateForeignPolicyEvent(isIncumbent);
    } else if (rand < 0.85) {
      return this.generateStateEvent();
    } else {
      return this.generateDebateEvent();
    }
  }
  
  generateEconomicEvent(isIncumbent) {
    const events = [
      {
        title: 'Strong Jobs Report',
        description: 'New employment data shows robust job growth, helping the incumbent party.',
        npvImpact: isIncumbent ? 0.5 : -0.5,
        states: []
      },
      {
        title: 'Recession Fears',
        description: 'Market volatility and economic indicators spark recession concerns.',
        npvImpact: isIncumbent ? -0.8 : 0.8,
        states: []
      },
      {
        title: 'Gas Prices Spike',
        description: 'Fuel costs rise sharply, affecting consumer sentiment.',
        npvImpact: isIncumbent ? -0.6 : 0.6,
        states: []
      },
      {
        title: 'Trade Deal Success',
        description: 'Major trade agreement announced, boosting economic optimism.',
        npvImpact: isIncumbent ? 0.4 : -0.4,
        states: []
      }
    ];
    
    return this.selectAndApplyEvent(events);
  }
  
  generateScandal() {
    const targetPlayer = this.gameState.rng() < 0.5;
    
    const events = [
      {
        title: targetPlayer ? 'Campaign Finance Questions' : 'Opponent Under Investigation',
        description: targetPlayer 
          ? 'Media scrutiny over campaign donations raises concerns.'
          : 'Opposition faces questions about fundraising practices.',
        npvImpact: targetPlayer ? -0.7 : 0.7,
        states: []
      },
      {
        title: targetPlayer ? 'Controversial Statement' : 'Opponent Gaffe',
        description: targetPlayer
          ? 'Your candidate\'s remarks draw criticism.'
          : 'Opponent makes widely criticized statement.',
        npvImpact: targetPlayer ? -0.4 : 0.4,
        states: []
      }
    ];
    
    return this.selectAndApplyEvent(events);
  }
  
  generateForeignPolicyEvent(isIncumbent) {
    const events = [
      {
        title: 'Diplomatic Success',
        description: 'International negotiations yield positive results.',
        npvImpact: isIncumbent ? 0.5 : -0.3,
        states: []
      },
      {
        title: 'Foreign Crisis',
        description: 'International tensions escalate, testing leadership.',
        npvImpact: isIncumbent ? -0.6 : 0.4,
        states: []
      },
      {
        title: 'Military Action',
        description: 'U.S. forces deployed in response to international situation.',
        npvImpact: isIncumbent ? (this.gameState.rng() < 0.5 ? 0.8 : -0.8) : 0,
        states: []
      }
    ];
    
    return this.selectAndApplyEvent(events);
  }
  
  generateStateEvent() {
    // Pick 1-3 random states
    const stateList = this.dataLoader.getStateList();
    const numStates = Math.floor(this.gameState.rng() * 3) + 1;
    const affectedStates = [];
    
    for (let i = 0; i < numStates; i++) {
      const idx = Math.floor(this.gameState.rng() * stateList.length);
      affectedStates.push(stateList[idx]);
    }
    
    const events = [
      {
        title: 'Local Endorsement',
        description: `Popular figures endorse your campaign in ${affectedStates.join(', ')}.`,
        npvImpact: 0,
        states: affectedStates.map(s => ({ abbr: s, impact: 0.8 }))
      },
      {
        title: 'Regional Scandal',
        description: `Local controversy affects the race in ${affectedStates.join(', ')}.`,
        npvImpact: 0,
        states: affectedStates.map(s => ({ abbr: s, impact: -0.6 }))
      },
      {
        title: 'State-Specific Issue',
        description: `Key issue emerges in ${affectedStates.join(', ')}, shifting dynamics.`,
        npvImpact: 0,
        states: affectedStates.map(s => ({ 
          abbr: s, 
          impact: (this.gameState.rng() - 0.5) * 1.5 
        }))
      }
    ];
    
    return this.selectAndApplyEvent(events);
  }
  
  generateDebateEvent() {
    const performance = this.gameState.rng();
    
    if (performance < 0.3) {
      return {
        title: 'Debate Victory',
        description: 'Your candidate delivers a commanding debate performance.',
        npvImpact: 1.2,
        states: []
      };
    } else if (performance < 0.6) {
      return {
        title: 'Debate Draw',
        description: 'The debate ends without a clear winner.',
        npvImpact: 0,
        states: []
      };
    } else {
      return {
        title: 'Debate Struggles',
        description: 'Your candidate faces challenges in the debate.',
        npvImpact: -1.0,
        states: []
      };
    }
  }
  
  selectAndApplyEvent(events) {
    const idx = Math.floor(this.gameState.rng() * events.length);
    const event = events[idx];
    
    // Apply difficulty scaling
    const impactScale = this.difficulty.eventImpactScale;
    
    // Apply NPV impact
    if (event.npvImpact) {
      const scaledImpact = event.npvImpact * impactScale;
      this.gameState.applyNpvDelta(scaledImpact);
    }
    
    // Apply state impacts
    if (event.states && event.states.length > 0) {
      event.states.forEach(({ abbr, impact }) => {
        const scaledImpact = impact * impactScale;
        this.gameState.applyStateDelta(abbr, scaledImpact);
      });
    }
    
    // Add to event log
    this.gameState.addEvent({
      type: 'random',
      ...event
    });
    
    return event;
  }
}
