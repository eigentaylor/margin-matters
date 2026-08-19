'use strict';

/**
 * Candidate picker for sim2028: lets a user swap the placeholder D/R
 * candidates for a preset (existing portrait already in docs/img/) or a
 * custom typed name + uploaded image. Purely cosmetic -- see baseline.js's
 * PLACEHOLDER_CANDIDATES doc comment; nothing here feeds the simulation
 * math, it only sets baseline.candidates.{d,r} (a display string) and
 * registers a portrait override for it.
 *
 * Custom choices can also carry `homeState`/`strength`, persisted here but
 * read only by homeStateAdvantage.js -- see that module for how (and how
 * little) a picked home state actually moves the simulation.
 */

import { setPortraitOverride } from '../electionNight/candidatePortraits.js';

export const DEFAULT_CANDIDATES = { d: 'Jon Ossoff', r: 'JD Vance' };

/** Presets beyond the two defaults, sitting unused in docs/img/ until picked. */
export const PRESET_CANDIDATES = {
  d: [
    { name: 'Jon Ossoff', img: 'img/2028Ossoff.jpg' },
    { name: 'Andy Beshear', img: 'img/2028Beshear.jpg' },
    { name: 'Pete Buttigieg', img: 'img/2028Buttigieg.jpg' },
    { name: 'Alexandria Ocasio-Cortez', img: 'img/2028Cortez.jpg' },
    { name: 'Gavin Newsom', img: 'img/2028Newsom.jpg' },
  ],
  r: [
    { name: 'JD Vance', img: 'img/2028Vance.jpg' },
    { name: 'Marco Rubio', img: 'img/2028Rubio.jpg' },
  ],
};

const STORAGE_KEYS = { d: 'sim2028DCandidate', r: 'sim2028RCandidate' };

const SAVED_MODES = new Set(['custom', 'preset', 'historical']);

/** @returns {{mode:'default'|'preset'|'custom'|'historical', name:string, imageUrl:?string, homeState:?string, strength:?number}} */
export function loadCandidateChoice(party) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[party]);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.name === 'string' && parsed.name) {
        return {
          mode: SAVED_MODES.has(parsed.mode) ? parsed.mode : 'preset',
          name: parsed.name,
          imageUrl: typeof parsed.imageUrl === 'string' ? parsed.imageUrl : null,
          homeState: typeof parsed.homeState === 'string' ? parsed.homeState : null,
          strength: typeof parsed.strength === 'number' ? parsed.strength : null,
        };
      }
    }
  } catch (e) { /* corrupt/unavailable storage -> fall through to default */ }
  return { mode: 'default', name: DEFAULT_CANDIDATES[party], imageUrl: null, homeState: null, strength: null };
}

export function saveCandidateChoice(party, choice) {
  try {
    localStorage.setItem(STORAGE_KEYS[party], JSON.stringify({
      mode: choice.mode,
      name: choice.name,
      imageUrl: choice.imageUrl || null,
      homeState: choice.homeState || null,
      strength: typeof choice.strength === 'number' ? choice.strength : null,
    }));
  } catch (e) { /* storage full/unavailable -- choice still applies for this session */ }
}

/** Presets carry their image path directly as the portrait override, sidestepping
 * getPortraitUrlForName()'s naive whitespace-split surname matching (which breaks on
 * a hyphenated/multi-word surname like "Ocasio-Cortez" vs the "Cortez" filename). */
function presetImageFor(party, name) {
  const preset = (PRESET_CANDIDATES[party] || []).find(p => p.name === name);
  return preset ? preset.img : null;
}

/** Points baseline.candidates[party] at the chosen name and (re)registers its portrait override. */
export function applyCandidateChoice(baseline, party, choice) {
  const name = (choice.name || '').trim() || DEFAULT_CANDIDATES[party];
  if (baseline && baseline.candidates) baseline.candidates[party] = name;
  const imageUrl = choice.mode === 'preset' ? presetImageFor(party, name) : choice.imageUrl;
  setPortraitOverride(name, imageUrl || null);
  return name;
}

export default {
  DEFAULT_CANDIDATES,
  PRESET_CANDIDATES,
  loadCandidateChoice,
  saveCandidateChoice,
  applyCandidateChoice,
};
