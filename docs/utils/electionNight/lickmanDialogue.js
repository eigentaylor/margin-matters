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

// Said at the moment the NPV or the EC (the presidency, i.e. 270+ electoral
// votes) gets projected/called - the one other spot (besides the intro/
// closing slides) where Lickman is meant to show up mid-night. Only ONE of
// the two is called at this moment; the other is still in progress. Keyed
// [whichCalledFirst][forOrAgainstHim][howTheOtherOneLooks]:
//
//   - npvFirst / ecFirst: which of the two just got called.
//   - for / against: whether that call matched Lickman's predicted winner
//     ({winner}) or not.
//   - favorable / unfavorable: how the OTHER (still-uncalled) race is
//     currently trending for Lickman's predicted winner at this moment -
//     i.e. is he about to look even MORE right, or is round two shaping up
//     to contradict this one.
//
// The character move throughout: if the just-called race went HIS way,
// claim it as the real, only prediction that ever mattered ("the Beets
// predict the ultimate winner, full stop" / "the Beets ONLY predict the
// popular vote") - see CLOSING_LINES' pvOnly/ecOnly for the same trick. If
// it went AGAINST him, retroactively declare that metric irrelevant to the
// 13 Beets and pivot hope to whichever one is still uncalled. {winner}/
// {loser} are always Lickman's OWN predicted candidates, not necessarily
// whoever the NPV/EC was just called for.
export const MIDNIGHT_CALL_LINES = {
  // The national popular vote was just called.
  npvFirst: {
    // ...and it went FOR Lickman's predicted winner.
    for: {
      // The Electoral College is currently also trending his way.
      favorable: [
        "The popular vote has spoken, exactly as the 13 Beets foretold! And if the Electoral College knows what's good for it, it'll fall in line too.",
        "One beet down, twelve to go. {winner} takes the popular vote right on schedule. I'd call the Electoral College a formality at this point.",
        "The people have chosen {winner}, precisely as predicted. Try to act surprised."
      ],
      // The Electoral College is currently trending against him - get the
      // goalpost-move in early.
      unfavorable: [
        "{winner} wins the popular vote, exactly as the 13 Beets foretold. And might I remind you - the Beets ONLY predict the popular vote. The Electoral College is its own chaotic beast, and frankly not my department.",
        "Did I mention my book only claims the popular vote? Because {winner} just won it. Whatever the Electoral College decides is somebody else's homework.",
        "The people chose {winner}. That's the prediction. That has ALWAYS been the prediction. Anything with the word 'electoral' in it is not my concern tonight."
      ]
    },
    // ...and it went AGAINST Lickman's predicted winner.
    against: {
      // The Electoral College is currently trending his way - pivot hope there.
      favorable: [
        "The popular vote is a popularity contest, not a prediction. The 13 Beets have never once cared about it. Watch the Electoral College.",
        "So {loser} wins some votes. Cute. The Beets predict the PRESIDENCY, and last I checked, that particular contest is still very much alive.",
        "I don't chase the popular vote. Never have. The real test is the Electoral College, and the garden likes our odds there."
      ],
      // The Electoral College is ALSO trending against him.
      unfavorable: [
        "One number does not undo thirteen beets. We wait for the real count.",
        "The popular vote means nothing. NOTHING. Ask me again once the Electoral College reports.",
        "This is a temporary embarrassment. The Beets are patient. I am patient. Everyone in this room should be patient."
      ]
    }
  },
  // The Electoral College (the presidency, 270+) was just called.
  ecFirst: {
    // ...and it went FOR Lickman's predicted winner.
    for: {
      // The popular vote is currently also trending his way.
      favorable: [
        "{winner} is the next President of the United States, exactly as the 13 Beets predicted! And it looks like the popular vote is coming home too - a clean sweep for the garden.",
        "Thirteen beets, one presidency. {winner} wins it all, just like I said, and the popular vote is falling in line right behind it.",
        "Called it. Called all of it, frankly."
      ],
      // The popular vote is currently trending against him - close the door
      // on it before anyone asks.
      unfavorable: [
        "{winner} is the next President. The 13 Beets called it, and might I add - my book has always said the Beets predict the ultimate winner, full stop. What the popular vote does is somebody else's trivia question.",
        "Called it. {winner} wins the presidency, and that is the ENTIRE prediction. The national popular vote was never part of it. Never will be.",
        "The Electoral College has spoken, and that's the only vote the 13 Beets have ever claimed to know. Everything else is noise."
      ]
    },
    // ...and it went AGAINST Lickman's predicted winner - the big one.
    against: {
      // The popular vote is currently trending his way - the last lifeline.
      favorable: [
        "{loser}? President? ...The 13 Beets have never - and I mean NEVER - claimed to predict the Electoral College. Read my book. It is the popular vote that matters, and {winner} is still very much alive there.",
        "Correction. CORRECTION. The Beets predict the TRUE winner - the national popular vote. The Electoral College is a chaotic, unpredictable mess no beet could hope to divine. Watch the popular vote.",
        "This is exactly why the Beets only ever predicted the popular vote in the first place. {winner} is going to win the vote that actually counts."
      ],
      // The popular vote is ALSO trending against him - the meltdown.
      unfavorable: [
        "(quietly eating a beet) ...I need a moment.",
        "This is - this is a lot of votes to be wrong about. Let me consult the garden.",
        "The Electoral College is famously unpredictable. As is, apparently, the entire country. I stand by the Beets regardless."
      ]
    }
  }
};
