'use strict';

// Placeholder flavor text for Nathaniel Sliver, the site's second parody
// pundit (a Nate Silver type). Generic and voice-less by design for now -
// v0.1, meant to be rewritten once his character/joke is figured out. Only
// narrates the live swing-vs-prior hierarchy (docs/utils/electionNight/
// liveSwing.js's solveLiveSwing()), gated to a real sim2028 run only - see
// election-night.js's isSim2028LiveRun() and buildSliverSwingSpec().
//
// Every pool below is keyed [tierIndex][direction]:
//   - tierIndex: which magnitude tier was crossed (0 = slight, 1 = real
//     move, 2 = sizable swing - see SLIVER_SWING_TIERS in election-night.js).
//   - direction: 'D' or 'R', the party the swing is currently favoring
//     (i.e. running ahead of what the prior/poll expected), NOT a
//     prediction of the eventual winner.
//
// {party} is filled with that party's candidate's full name.
// {region} is filled with a display region name (e.g. "the Rust Belt").
// {state} is filled with a display state/unit name (e.g. "Ohio").

export const NATIONAL_SWING_LINES = [
  {
    D: [
      "Early days, but the counted vote is running a bit better for {party} than the polls had it.",
      "Nothing dramatic yet, but {party} is slightly outperforming their pre-election numbers nationally."
    ],
    R: [
      "Early days, but the counted vote is running a bit better for {party} than the polls had it.",
      "Nothing dramatic yet, but {party} is slightly outperforming their pre-election numbers nationally."
    ]
  },
  {
    D: [
      "There's a real move in the data tonight - {party} is running ahead of where the polls had them nationally.",
      "This is more than noise at this point: the national count is trending toward {party}, beyond what was expected."
    ],
    R: [
      "There's a real move in the data tonight - {party} is running ahead of where the polls had them nationally.",
      "This is more than noise at this point: the national count is trending toward {party}, beyond what was expected."
    ]
  },
  {
    D: [
      "This is a sizable national swing toward {party} - well outside what the pre-election polling would have called a normal miss.",
      "Whatever's happening in the counted vote right now, it's a genuinely big move toward {party} nationally."
    ],
    R: [
      "This is a sizable national swing toward {party} - well outside what the pre-election polling would have called a normal miss.",
      "Whatever's happening in the counted vote right now, it's a genuinely big move toward {party} nationally."
    ]
  }
];

export const REGIONAL_SWING_LINES = [
  {
    D: [
      "Worth a flag: {region} looks like it's leaning a touch more {party} than the rest of the country's trend would suggest.",
      "A modest signal out of {region} - running slightly better for {party} than you'd expect from the national numbers alone."
    ],
    R: [
      "Worth a flag: {region} looks like it's leaning a touch more {party} than the rest of the country's trend would suggest.",
      "A modest signal out of {region} - running slightly better for {party} than you'd expect from the national numbers alone."
    ]
  },
  {
    D: [
      "{region} is moving harder than the rest of the country - a real regional trend toward {party}, on top of whatever's happening nationally.",
      "That's not just the national mood - {region} specifically is breaking toward {party} more than its neighbors are."
    ],
    R: [
      "{region} is moving harder than the rest of the country - a real regional trend toward {party}, on top of whatever's happening nationally.",
      "That's not just the national mood - {region} specifically is breaking toward {party} more than its neighbors are."
    ]
  },
  {
    D: [
      "This is a sizable regional break: {region} is swinging toward {party} well beyond the national trend.",
      "{region} is doing something genuinely different from the rest of the map tonight - a big move toward {party}."
    ],
    R: [
      "This is a sizable regional break: {region} is swinging toward {party} well beyond the national trend.",
      "{region} is doing something genuinely different from the rest of the map tonight - a big move toward {party}."
    ]
  }
];

export const KEY_RACE_SWING_LINES = [
  {
    D: [
      "Keep an eye on {state} - {party} is running a bit ahead of the pre-election numbers there.",
      "{state} is close, and it's trending slightly better for {party} than expected so far."
    ],
    R: [
      "Keep an eye on {state} - {party} is running a bit ahead of the pre-election numbers there.",
      "{state} is close, and it's trending slightly better for {party} than expected so far."
    ]
  },
  {
    D: [
      "{state} is a real story tonight - {party} is meaningfully outperforming what the polls had there.",
      "That's a genuine move in {state}, not just noise: {party} is running well ahead of expectations."
    ],
    R: [
      "{state} is a real story tonight - {party} is meaningfully outperforming what the polls had there.",
      "That's a genuine move in {state}, not just noise: {party} is running well ahead of expectations."
    ]
  },
  {
    D: [
      "{state} is a genuine surprise - {party} is running dramatically ahead of the pre-election polling there.",
      "Whatever the final call ends up being, {state} is breaking hard for {party} right now, well outside the expected range."
    ],
    R: [
      "{state} is a genuine surprise - {party} is running dramatically ahead of the pre-election polling there.",
      "Whatever the final call ends up being, {state} is breaking hard for {party} right now, well outside the expected range."
    ]
  }
];
