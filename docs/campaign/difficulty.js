// difficulty.js - Difficulty settings and modifiers
export const DIFFICULTY_SETTINGS = {
  'very-easy': {
    name: 'Very Easy',
    description: 'Strong national advantage. States highly responsive to good decisions.',
    
    // National lean (positive = towards player's party)
    nationalLean: 3.0, // +3pp towards player
    
    // How much states respond to player decisions
    stateElasticity: 1.5, // 50% more movement
    
    // Random event frequency (events per phase)
    eventRate: 0.8,
    
    // How much random events hurt/help
    eventImpactScale: 0.7,
    
    // Opponent decision quality
    opponentEffectiveness: 0.3,
    
    // Poll accuracy improvement rate
    pollAccuracyBonus: 1.2,
    
    // Resource efficiency
    resourceEfficiency: 1.3
  },
  
  'normal': {
    name: 'Normal',
    description: 'Balanced race. States moderately responsive. Victory requires good strategy.',
    
    nationalLean: 0.0,
    stateElasticity: 1.0,
    eventRate: 1.0,
    eventImpactScale: 1.0,
    opponentEffectiveness: 0.5,
    pollAccuracyBonus: 1.0,
    resourceEfficiency: 1.0
  },
  
  'hard': {
    name: 'Hard',
    description: 'Slight disadvantage. States less elastic. Bad decisions more costly.',
    
    nationalLean: -1.5, // -1.5pp against player
    stateElasticity: 0.75,
    eventRate: 1.2,
    eventImpactScale: 1.3,
    opponentEffectiveness: 0.7,
    pollAccuracyBonus: 0.9,
    resourceEfficiency: 0.85
  },
  
  'very-hard': {
    name: 'Very Hard',
    description: 'Strong headwinds. Limited state movement. Every decision critical.',
    
    nationalLean: -3.0,
    stateElasticity: 0.5,
    eventRate: 1.5,
    eventImpactScale: 1.6,
    opponentEffectiveness: 0.85,
    pollAccuracyBonus: 0.8,
    resourceEfficiency: 0.7
  }
};

export function getDifficulty(level) {
  return DIFFICULTY_SETTINGS[level] || DIFFICULTY_SETTINGS['normal'];
}

export function applyDifficultyModifier(baseValue, difficulty, modifierType) {
  const settings = getDifficulty(difficulty);
  const modifier = settings[modifierType] || 1.0;
  return baseValue * modifier;
}

// Calculate effective decision impact based on difficulty
export function getDecisionEffectiveness(difficulty, isGoodDecision = true) {
  const settings = getDifficulty(difficulty);
  const baseElasticity = settings.stateElasticity;
  
  // Good decisions are less effective on hard difficulties
  // Bad decisions are more punishing on hard difficulties
  if (isGoodDecision) {
    return baseElasticity;
  } else {
    return 1.0 / baseElasticity; // Inverse for bad decisions
  }
}

// Get expected NPV lean from difficulty
export function getNationalLean(difficulty) {
  const settings = getDifficulty(difficulty);
  return settings.nationalLean;
}

// Calculate event frequency for a phase
export function getEventFrequency(difficulty, phase, totalPhases) {
  const settings = getDifficulty(difficulty);
  const baseRate = settings.eventRate;
  
  // Events become slightly more frequent later in campaign
  const phaseMultiplier = 1.0 + (phase / totalPhases) * 0.3;
  
  return baseRate * phaseMultiplier;
}
