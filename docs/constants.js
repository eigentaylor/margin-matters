/**
 * Election-night constants moved out of election-night.js for reuse.
 * This file should be included before election-night.js in consumer pages.
 * It exposes a single global: window.ELECTION_NIGHT_CONSTANTS
 */
(function () {
  'use strict';

  // Known poll-closing times (PT) grouped by states.
  // Note: PHASES times are intentionally strings here so the consumer
  // can convert them to minutes with the local toMinutesWithOffset
  // helper which exists inside the election-night simulator.
  const POLL_CLOSINGS = {
    '15:00': ['KY', 'IN', 'PR'],
    '16:00': ['VT', 'VA', 'SC', 'GA'],
    '16:30': ['NC', 'OH', 'WV'],
    '17:00': ['AL', 'CT', 'DC', 'DE', 'FL', 'IL', 'KS', 'ME', 'MD', 'MA', 'MS', 'MO', 'NH', 'NJ', 'OK', 'PA', 'RI', 'TN', 'TX'],
    '17:30': ['AR'],
    '18:00': ['AZ', 'CO', 'LA', 'MI', 'MN', 'NE', 'NM', 'NY', 'SD', 'WI', 'WY'],
    '19:00': ['IA', 'MT', 'NV', 'UT'],
    '20:00': ['CA', 'OR', 'WA', 'ID', 'ND'],
    '22:00': ['AK', 'HI']
  };

  // Relative counting speeds by state. Values >1 count faster than
  // average, values <1 are slower. Used when estimating reporting
  // duration for each state.
  const STATE_COUNTING_SPEEDS = {
    AL: 1.1, AK: 0.7, AZ: 0.9, AR: 1.0, CA: 0.7, CO: 0.9, CT: 0.9, DE: 1.0,
    DC: 1.0, FL: 1.2, GA: 1.1, HI: 0.6, ID: 1.3, IL: 1.1, IN: 1.1, IA: 1.2,
    KS: 1.0, KY: 1.0, LA: 1.0, ME: 0.8, MD: 1.0, MA: 0.9, MI: 1.0, MN: 0.9,
    MS: 1.0, MO: 1.0, MT: 0.7, NE: 1.2, NV: 0.7, NH: 1.0, NJ: 0.9, NM: 0.9,
    NY: 0.7, NC: 1.0, ND: 1.3, OH: 1.1, OK: 1.0, OR: 0.8, PA: 0.7, PR: 0.6,
    RI: 0.9, SC: 1.0, SD: 1.2, TN: 1.1, TX: 1.2, UT: 1.0, VT: 0.8, VA: 1.0,
    WA: 0.8, WV: 0.9, WI: 1.0, WY: 0.7
  };

  // States where mail/absentee ballots are common and reporting tends to
  // be delayed or front-loaded differently. Affects reporting schedule
  // shapes when generating batches.
  const MAIL_HEAVY_STATES = ['AZ', 'CA', 'CO', 'HI', 'NV', 'NJ', 'NY', 'OR', 'UT', 'VT', 'WA', 'MI', 'PA', 'WI', 'MN'];

  // Named phases of election night. Times are provided as strings here
  // so election-night.js can convert them into minute offsets using
  // its own toMinutesWithOffset() helper (which exists in that file).
  const PHASES = [
    { name: 'Early', start: '19:00', end: '20:30' },
    { name: 'Mid', start: '20:30', end: '22:00' },
    { name: 'Central', start: '22:00', end: '23:30' },
    { name: 'Late', start: '23:30', end: '25:00' },
    { name: 'Final', start: '25:00', end: '28:00' }
  ];

  // Expose as a single global so legacy pages can include this file
  // before election-night.js and get the constants.
  if (typeof window !== 'undefined') {
    window.ELECTION_NIGHT_CONSTANTS = window.ELECTION_NIGHT_CONSTANTS || {};
    window.ELECTION_NIGHT_CONSTANTS.POLL_CLOSINGS = window.ELECTION_NIGHT_CONSTANTS.POLL_CLOSINGS || POLL_CLOSINGS;
    window.ELECTION_NIGHT_CONSTANTS.STATE_COUNTING_SPEEDS = window.ELECTION_NIGHT_CONSTANTS.STATE_COUNTING_SPEEDS || STATE_COUNTING_SPEEDS;
    window.ELECTION_NIGHT_CONSTANTS.MAIL_HEAVY_STATES = window.ELECTION_NIGHT_CONSTANTS.MAIL_HEAVY_STATES || MAIL_HEAVY_STATES;
    window.ELECTION_NIGHT_CONSTANTS.PHASES = window.ELECTION_NIGHT_CONSTANTS.PHASES || PHASES;
  }

})();
