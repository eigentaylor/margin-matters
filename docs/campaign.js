// campaign.js - Main game controller
import { GameState } from './campaign/gameState.js';
import { DataLoader } from './campaign/dataLoader.js';
import { EventSystem } from './campaign/events.js';
import { DecisionSystem } from './campaign/decisions.js';
import { PollingSystem } from './campaign/polling.js';
import { PunditSystem } from './campaign/pundits.js';

class CampaignGame {
  constructor() {
    this.gameState = null;
    this.dataLoader = new DataLoader();
    this.eventSystem = null;
    this.decisionSystem = null;
    this.pollingSystem = null;
    this.punditSystem = null;
    this.isLoaded = false;
  }
  
  async initialize() {
    // Load data
    console.log('Loading election data...');
    await this.dataLoader.loadData();
    this.isLoaded = true;
    console.log('Data loaded successfully');
    
    // Set up UI handlers
    this.setupUI();
  }
  
  setupUI() {
    // Setup modal
    const startBtn = document.getElementById('start-game');
    const setupModal = document.getElementById('setup-modal');
    const gameContainer = document.getElementById('game-container');
    
    // Difficulty selection
    const difficultyOptions = document.querySelectorAll('.difficulty-option');
    let selectedDifficulty = 'normal';
    
    difficultyOptions.forEach(option => {
      option.addEventListener('click', () => {
        difficultyOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        selectedDifficulty = option.dataset.difficulty;
      });
    });
    
    // Start game button
    startBtn.addEventListener('click', () => {
      const playerParty = document.getElementById('player-party').value;
      const playerCandidate = document.getElementById('player-candidate').value.trim() || 
                              (playerParty === 'D' ? 'Democratic Candidate' : 'Republican Candidate');
      const opponentCandidate = document.getElementById('opponent-candidate').value.trim() || 
                                (playerParty === 'D' ? 'Republican Candidate' : 'Democratic Candidate');
      
      this.startGame({
        playerParty,
        playerCandidate,
        opponentCandidate,
        difficulty: selectedDifficulty
      });
      
      setupModal.classList.add('hidden');
      gameContainer.classList.remove('hidden');
    });
    
    // End phase button
    document.getElementById('end-phase-btn').addEventListener('click', () => {
      this.endPhase();
    });
  }
  
  startGame(config) {
    // Create game state
    this.gameState = new GameState(config);
    this.gameState.initializeStateDeltas(this.dataLoader.getStateList());
    
    // Initialize systems
    this.eventSystem = new EventSystem(this.gameState, this.dataLoader);
    this.decisionSystem = new DecisionSystem(this.gameState, this.dataLoader);
    this.pollingSystem = new PollingSystem(this.gameState, this.dataLoader);
    this.punditSystem = new PunditSystem(this.gameState, this.dataLoader, this.pollingSystem);
    
    // Start first phase
    this.startPhase();
  }
  
  startPhase() {
    console.log(`Starting phase ${this.gameState.currentPhase}`);
    
    // Generate events for this phase
    const events = this.eventSystem.generatePhaseEvents();
    console.log(`Generated ${events.length} events`);
    
    // Generate polls
    this.pollingSystem.generatePolls();
    
    // Update UI
    this.updateUI();
  }
  
  endPhase() {
    // Check if all decisions have been made
    if (this.gameState.decisionsRemaining > 0) {
      if (!confirm(`You have ${this.gameState.decisionsRemaining} decisions remaining. Are you sure you want to end this phase?`)) {
        return;
      }
    }
    
    // Advance to next phase
    const hasNextPhase = this.gameState.advancePhase();
    
    if (!hasNextPhase) {
      this.endGame();
      return;
    }
    
    this.startPhase();
  }
  
  endGame() {
    console.log('Campaign complete! Simulating election...');
    
    // Get final polls (which approximate the true result)
    const finalPolls = this.pollingSystem.generatePolls();
    
    // Show final results
    this.showFinalResults(finalPolls);
  }
  
  showFinalResults(finalPolls) {
    const container = document.getElementById('game-container');
    
    // Calculate final EV
    let playerEV = 0;
    let opponentEV = 0;
    
    this.dataLoader.getStateList().forEach(abbr => {
      const poll = finalPolls.get(abbr);
      const trueMargin = poll.trueMargin; // Use true margin for final result
      
      const playerWins = (this.gameState.playerParty === 'D' && trueMargin < 0) ||
                         (this.gameState.playerParty === 'R' && trueMargin > 0);
      
      const ev = this.getStateEV(abbr);
      if (playerWins) {
        playerEV += ev;
      } else {
        opponentEV += ev;
      }
    });
    
    const playerWon = playerEV >= 270;
    
    const resultsHTML = `
      <div class="card" style="text-align: center; padding: 32px;">
        <h1 style="font-size: 2.5rem; margin-bottom: 16px;">
          ${playerWon ? '🎉 Victory!' : '😔 Defeat'}
        </h1>
        <h2 style="margin-bottom: 32px;">
          ${this.gameState.playerCandidate}: ${playerEV} EV<br>
          ${this.gameState.opponentCandidate}: ${opponentEV} EV
        </h2>
        <p style="font-size: 1.2rem; margin-bottom: 32px;">
          ${playerWon 
            ? `Congratulations! ${this.gameState.playerCandidate} wins the presidency!`
            : `${this.gameState.opponentCandidate} wins the election.`
          }
        </p>
        <button class="btn btn-primary" onclick="location.reload()">
          Play Again
        </button>
      </div>
    `;
    
    container.innerHTML = resultsHTML;
  }
  
  updateUI() {
    // Update header stats
    document.getElementById('phase-display').textContent = 
      `${this.gameState.currentPhase} / ${this.gameState.maxPhases}`;
    document.getElementById('resources-display').textContent = this.gameState.resources;
    document.getElementById('decisions-left').textContent = this.gameState.decisionsRemaining;
    
    // Update candidate display
    document.getElementById('candidate-display').textContent = 
      `${this.gameState.playerCandidate} (${this.gameState.playerParty}) vs ${this.gameState.opponentCandidate}`;
    
    // Update decisions panel
    this.updateDecisionsPanel();
    
    // Update event log
    this.updateEventLog();
    
    // Update pundit panel
    this.updatePunditPanel();
    
    // Update end phase button
    const endPhaseBtn = document.getElementById('end-phase-btn');
    endPhaseBtn.disabled = false;
    endPhaseBtn.textContent = this.gameState.decisionsRemaining > 0 
      ? `End Phase (${this.gameState.decisionsRemaining} decisions left)`
      : 'End Phase';
  }
  
  updateDecisionsPanel() {
    const panel = document.getElementById('decisions-panel');
    const decisions = this.decisionSystem.getAvailableDecisions();
    
    panel.innerHTML = decisions.map(decision => `
      <button class="decision-btn" 
              data-decision-id="${decision.id}"
              ${decision.cost > this.gameState.resources ? 'disabled' : ''}>
        <div class="decision-title">${decision.title}</div>
        <div class="decision-desc">
          ${decision.description}
          <br>
          <span style="color: var(--warning);">Cost: ${decision.cost} resources</span>
        </div>
      </button>
    `).join('');
    
    // Add click handlers
    panel.querySelectorAll('.decision-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const decisionId = btn.dataset.decisionId;
        const decision = decisions.find(d => d.id === decisionId);
        if (decision) {
          this.makeDecision(decision);
        }
      });
    });
  }
  
  makeDecision(decision) {
    const result = this.decisionSystem.executeDecision(decision);
    
    if (!result.success) {
      alert(result.message);
      return;
    }
    
    // Update UI
    this.updateUI();
  }
  
  updateEventLog() {
    const log = document.getElementById('event-log');
    const recentEvents = this.gameState.events.slice(-10).reverse();
    
    log.innerHTML = recentEvents.map(event => `
      <div class="event-item">
        <div class="event-phase">Phase ${event.phase}</div>
        <strong>${event.title}</strong><br>
        ${event.description || ''}
      </div>
    `).join('');
  }
  
  updatePunditPanel() {
    const panel = document.getElementById('pundit-panel');
    const analyses = this.punditSystem.getPunditAnalyses();
    
    panel.innerHTML = `
      <div class="pundit-box">
        <div class="pundit-name">${analyses.lickman.name}</div>
        <div style="margin-bottom: 8px;">
          <strong>Prediction:</strong> ${analyses.lickman.prediction}<br>
          <strong>Score:</strong> ${analyses.lickman.score}<br>
          <strong>Confidence:</strong> ${analyses.lickman.confidence}
        </div>
        <div class="pundit-quote">"${analyses.lickman.quote}"</div>
      </div>
      
      <div class="pundit-box">
        <div class="pundit-name">${analyses.sliver.name}</div>
        <div style="margin-bottom: 8px;">
          <strong>Prediction:</strong> ${analyses.sliver.prediction}<br>
          <strong>Win Probability:</strong> ${analyses.sliver.probability}
        </div>
        <div class="pundit-quote">"${analyses.sliver.quote}"</div>
      </div>
    `;
  }
  
  // Helper to get state EV (same as in pundits.js)
  getStateEV(abbr) {
    const evMap = {
      'CA': 54, 'TX': 40, 'FL': 30, 'NY': 28, 'PA': 19, 'IL': 19,
      'OH': 17, 'GA': 16, 'NC': 16, 'MI': 15, 'NJ': 14, 'VA': 13,
      'WA': 12, 'AZ': 11, 'MA': 11, 'TN': 11, 'IN': 11, 'MD': 10,
      'MN': 10, 'MO': 10, 'WI': 10, 'CO': 10, 'SC': 9, 'AL': 9,
      'LA': 8, 'KY': 8, 'OR': 8, 'OK': 7, 'CT': 7, 'IA': 6,
      'MS': 6, 'AR': 6, 'KS': 6, 'NV': 6, 'UT': 6, 'NM': 5,
      'WV': 4, 'NE': 5, 'ID': 4, 'HI': 4, 'NH': 4, 'ME': 4,
      'RI': 4, 'MT': 4, 'DE': 3, 'SD': 3, 'ND': 3, 'AK': 3,
      'VT': 3, 'WY': 3, 'DC': 3
    };
    return evMap[abbr] || 3;
  }
}

// Initialize game when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const game = new CampaignGame();
    game.initialize();
  });
} else {
  const game = new CampaignGame();
  game.initialize();
}
