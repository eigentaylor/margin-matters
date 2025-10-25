// pundits.js - Simulated pundit commentary (Lickman & Sliver)
import { getStateEV } from './constants.js';

export class PunditSystem {
  constructor(gameState, dataLoader, pollingSystem) {
    this.gameState = gameState;
    this.dataLoader = dataLoader;
    this.pollingSystem = pollingSystem;
  }
  
  // Get all pundit analyses
  getPunditAnalyses() {
    return {
      lickman: this.getLickmanAnalysis(),
      sliver: this.getSliverAnalysis()
    };
  }
  
  // Professor Aleck Lickman - 13 "beets" system for popular vote
  getLickmanAnalysis() {
    const nationalPoll = this.pollingSystem.getPoll('NATIONAL');
    
    if (!nationalPoll) {
      return {
        name: 'Prof. Aleck Lickman',
        prediction: 'Too early to call',
        confidence: 'Low',
        quote: 'The 13 beets are still germinating. Check back later.',
        details: []
      };
    }
    
    // Lickman looks at structural factors (simplified for game)
    let score = 0;
    
    // Factor 1: Incumbent party mandate (did they win big last time?)
    const baseline2024National = this.dataLoader.getNationalMargin2024();
    if (this.gameState.isPlayerIncumbent()) {
      score += baseline2024National > 5 ? 1 : 0;
    } else {
      score += baseline2024National < -5 ? 1 : 0;
    }
    
    // Factor 2: No major scandal
    const hasScandal = this.gameState.events.some(e => 
      e.title && e.title.toLowerCase().includes('scandal')
    );
    score += hasScandal ? 0 : 1;
    
    // Factor 3: Economy (random for now, could be based on events)
    const economyGood = this.gameState.events.filter(e =>
      e.title && (e.title.includes('Jobs') || e.title.includes('Trade'))
    ).length > 0;
    score += economyGood ? 1 : 0;
    
    // Factor 4-6: Campaign performance (based on NPV delta)
    const npvDelta = this.gameState.npvDelta;
    if (npvDelta > 2) score += 3;
    else if (npvDelta > 0) score += 2;
    else if (npvDelta > -2) score += 1;
    
    // Factors 7-9: Opposition weakness
    const opponentStruggles = this.gameState.events.filter(e =>
      e.title && e.title.toLowerCase().includes('opponent')
    ).length;
    score += Math.min(opponentStruggles, 3);
    
    // Factors 10-13: Random "structural" factors
    for (let i = 0; i < 4; i++) {
      score += this.gameState.rng() > 0.5 ? 1 : 0;
    }
    
    // Add some noise to Lickman's score (he's not 100% accurate)
    const noisyScore = Math.max(0, Math.min(13, score + Math.floor((this.gameState.rng() - 0.5) * 4)));
    
    const prediction = noisyScore >= 7 
      ? `${this.gameState.playerCandidate} will win`
      : `${this.gameState.opponentCandidate} will win`;
    
    const confidence = Math.abs(noisyScore - 6.5) > 3 ? 'High' : 'Medium';
    
    const quotes = [
      `The beets have spoken. ${noisyScore} out of 13 beets favor ${noisyScore >= 7 ? 'your candidate' : 'the opposition'}.`,
      `Historical patterns suggest ${prediction.toLowerCase()}.`,
      `The fundamentals point to ${noisyScore >= 7 ? 'your victory' : 'an uphill battle'}.`,
      `My model has correctly predicted ${Math.floor(85 + this.gameState.rng() * 10)}% of elections using these structural factors.`
    ];
    
    const quote = quotes[Math.floor(this.gameState.rng() * quotes.length)];
    
    return {
      name: 'Prof. Aleck Lickman',
      prediction: prediction,
      confidence: confidence,
      score: `${noisyScore}/13 Keys`,
      quote: quote,
      details: [
        'Uses 13 structural "beets" to predict the popular vote winner',
        'Focuses on fundamentals over polls',
        'Historical track record varies'
      ]
    };
  }
  
  // Nathan Sliver - probabilistic Monte Carlo approach
  getSliverAnalysis() {
    const nationalPoll = this.pollingSystem.getPoll('NATIONAL');
    
    if (!nationalPoll) {
      return {
        name: 'Nathan Sliver',
        prediction: 'Too early to model',
        probability: '50%',
        quote: 'Need more polling data to run the simulation.',
        details: []
      };
    }
    
    // Run simplified Monte Carlo (1000 sims)
    const numSims = 1000;
    let playerWins = 0;
    
    for (let i = 0; i < numSims; i++) {
      const ev = this.simulateElection();
      if (ev >= 270) playerWins++;
    }
    
    const winProbability = playerWins / numSims;
    
    // Sliver's commentary style
    const probability = `${Math.round(winProbability * 100)}%`;
    
    let prediction;
    if (winProbability > 0.8) {
      prediction = `${this.gameState.playerCandidate} strongly favored`;
    } else if (winProbability > 0.6) {
      prediction = `${this.gameState.playerCandidate} favored`;
    } else if (winProbability > 0.4) {
      prediction = 'Toss-up';
    } else if (winProbability > 0.2) {
      prediction = `${this.gameState.opponentCandidate} favored`;
    } else {
      prediction = `${this.gameState.opponentCandidate} strongly favored`;
    }
    
    const quotes = [
      `Our model gives ${this.gameState.playerCandidate} a ${probability} chance of winning.`,
      `Based on current polling, the race ${winProbability > 0.55 ? 'leans' : 'strongly leans'} ${winProbability > 0.5 ? 'your way' : 'against you'}.`,
      `There's significant uncertainty, but ${prediction.toLowerCase()} right now.`,
      `The Electoral College math ${winProbability > 0.5 ? 'works in your favor' : 'is challenging'}.`
    ];
    
    const quote = quotes[Math.floor(this.gameState.rng() * quotes.length)];
    
    return {
      name: 'Nathan Sliver',
      prediction: prediction,
      probability: probability,
      quote: quote,
      details: [
        `Ran ${numSims} simulations`,
        'Accounts for polling uncertainty',
        'State correlations included'
      ]
    };
  }
  
  // Simple Monte Carlo simulation
  simulateElection() {
    const stateList = this.dataLoader.getStateList();
    let playerEV = 0;
    
    stateList.forEach(abbr => {
      const poll = this.pollingSystem.getPoll(abbr);
      if (!poll) return;
      
      // Simulate this state's result with uncertainty
      const simulatedMargin = poll.margin + this.randn() * poll.uncertainty;
      
      // Determine winner
      const playerWins = (this.gameState.playerParty === 'D' && simulatedMargin < 0) ||
                         (this.gameState.playerParty === 'R' && simulatedMargin > 0);
      
      if (playerWins) {
        const ev = getStateEV(abbr);
        playerEV += ev;
      }
    });
    
    return playerEV;
  }
  
  randn() {
    const u1 = this.gameState.rng();
    const u2 = this.gameState.rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
