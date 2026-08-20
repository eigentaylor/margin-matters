'use strict';

// Placeholder flavor text for Aleck Lickman, the site's parody pundit (Allan
// Lichtman by way of "13 Beets to the Presidency"). Generic and goofy by
// design - v0.1 - meant to be expanded/replaced later. Only PREDICTION_LINES
// and CLOSING_LINES are wired up to any UI yet (the opening and closing
// slides);

/** Picks a pseudo-random entry from `arr` using an already-seeded rng() -> [0,1) function. */
export function pick(arr, rng) {
  if (!arr || !arr.length) return '';
  const i = Math.min(arr.length - 1, Math.floor((rng ? rng() : Math.random()) * arr.length));
  return arr[i];
}

/** Fills {winner}/{loser}/{beets}/{falseBeets} placeholders in a template string. */
export function fillTemplate(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

// Opening prediction, shown right after the race-overview title card, before
// any polls have closed. {winner}/{loser} are the predicted winner/loser's
// full names when known, {beets} is the decided false-beet count (out of 13).
export const PREDICTION_LINES = [
  "I've counted the beets. All 13 of them. {beets} of them are false, and that means one thing: {winner} WILL defeat {loser}.",
  "The beets have spoken, and they are never wrong. {beets} false beets. {winner} takes this one over {loser}. Write it down.",
  "Thirteen beets. {beets} came back false. The math is simple, people. {winner} wins. {loser} loses. I'd stake my garden on it.",
  "Forget the pundits with their polls and their 'data.' {beets} false beets don't lie. {winner} defeats {loser}. See you at midnight."
];

// Fallback prediction lines used when no candidate names are available (should be rare).
export const PREDICTION_LINES_NO_NAMES = [
  "The beets have spoken. {beets} of 13 are false, and that means the challenger takes it. Book it.",
  "Thirteen beets counted, {beets} came back false. My prediction stands, whoever it ends up being."
];

// Closing remarks, shown once at the very end of the night after the final
// tally. Keyed by whether Lickman's predicted winner matched the true
// popular-vote winner and/or the true electoral-college (actual) winner.
export const CLOSING_LINES = {
  // Beets got both the popular vote AND the electoral college right.
  bothRight: [
    "The 13 Beets were right. They have always been right. I will celebrate by eating a beet.",
    "Thirteen beets, zero doubt. {winner} wins the popular vote AND the presidency, exactly as the 13 Beets foretold. Pass the vinegar.",
    "Some people said 'a root vegetable can't predict elections.' Those people were wrong. I was right. The 13 Beets were right. I'm eating a beet."
  ],
  // Beets got the popular vote right, but not the electoral college.
  pvOnly: [
    "The 13 Beets ONLY predict the popular vote. It's in my book! {winner} is the TRUE winner of this election.",
    "Technically, {winner} DID win more votes, just like I said. The Electoral College is NOT what the 13 Beets predict!",
    "The 13 Beets called that {winner} would win popular vote perfectly. The Electoral College, frankly, is too chaotic for the 13 Beets to predict.",
    "Did you know I became an election predictor because of my hero, Allan Lichtman? My favorite quote by him is from his published prediction in Social Education, 'As a national system, the Keys predict the popular vote, not the state-by-state tally of Electoral College votes.' No system can predict the Electoral College, so my 13 Beets system only predicts the national popular vote which {winner} won."
  ],
  // Beets got the electoral college (the actual winner) right, but not the popular vote.
  ecOnly: [
    "The 13 Beets ONLY predict the ultimate final winner. I got a signed newspaper from {winner}!",
    "{winner} is our next president, exactly as the 13 Beets predicted. The 13 Beets say NOTHING about the popular vote, no matter what my book says.",
    "Called it. {winner} wins the presidency. The 13 Beets only predict the ultimate winner. The beets have always only predicted the Electoral College outcome."
  ],
  // Beets got neither right.
  bothWrong: [
    "MISINFORMATION. (cries softly while eating a beet)",
    "The voters were wrong. The 13 Beets were right. {winner} should be president, not {loser}.",
    "The 13 Beets were wrong. I don't know what to tell you. I'm going to mournfully eat a beet on the steps of the Capitol."
  ]
};

// --- Not wired up yet in v0.1 - drafted now for the later mid-night system ---

// Said when a new state call or NPV update moves the race TOWARD Lickman's
// predicted winner.
export const MOMENTUM_TOWARD_LINES = [
  "As the beets have predicted...",
  "The beets remain undefeated. Keep watching.",
  "Right on schedule. The beets knew.",
  "Another data point for the garden."
];

// Said when a new state call or NPV update moves the race AWAY from
// Lickman's predicted winner.
export const MOMENTUM_AWAY_LINES = [
  "The beets have never been wrong! Hold strong!",
  "This is a temporary setback. The beets are patient.",
  "Do not panic. I repeat: do not panic. The beets know what they're doing.",
  "One county does not undo thirteen beets."
];

// Said when a state gets called or corrected FOR Lickman's predicted winner.
export const STATE_FOR_LINES = [
  "Another state falls in line with the beets.",
  "The beets called it. Again.",
  "As predicted. Next state, please."
];

// Said when a state gets called or corrected AGAINST Lickman's predicted winner.
export const STATE_AGAINST_LINES = [
  "One rogue state does not a harvest ruin.",
  "Noted. The beets remain confident regardless.",
  "This changes nothing. I stand by the beets."
];
