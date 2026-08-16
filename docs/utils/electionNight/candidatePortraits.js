'use strict';

// Resolves a (year, leader, unit) triple to a candidate portrait image URL,
// backed by the static manifest at docs/img/portraits.json (built by
// tools/build_portrait_manifest.py from the [YEAR][Lastname](-variant)?.ext
// files in docs/img -- this is a static site, so there's no server-side
// directory listing available at runtime).

import { lastNameFrom, getUnitCandidateLastNames } from '../candidateNames.js';

const MANIFEST_URL = 'img/portraits.json';
const IMG_BASE = 'img/';

// getUnitCandidateLastNames()/lastNameFrom() just take the last
// whitespace-split token of the full name, which is right for almost every
// candidate but wrong for multi-word surnames. Portrait filenames use the
// natural surname (see tools/rename_candidate_images.py), so this maps the
// naive split result back to the filename's surname for the known
// exceptions, without changing lastNameFrom()'s existing behavior (other
// call-log text already depends on it splitting the naive way).
const SURNAME_ALIASES = {
  Follette: 'LaFollette' // "Robert M. La Follette" -> naive last token is "Follette"
};

let manifestPromise = null;

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL)
      .then(res => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return manifestPromise;
}

function normalizeSurname(name) {
  if (!name) return null;
  return SURNAME_ALIASES[name] || name;
}

/**
 * Resolve the portrait image URL for a party leader ('D'|'R'|'O') in a given
 * unit/year, or null if no portrait is on file. Async because the manifest
 * is fetched lazily (once) and cached for the life of the page.
 */
export async function getPortraitUrl(year, leader, unitKey) {
  if (leader !== 'D' && leader !== 'R' && leader !== 'O') return null;
  if (!isFinite(year)) return null;
  const names = getUnitCandidateLastNames(unitKey, { year });
  const rawName = names ? names[leader] : null;
  if (!rawName || rawName === 'D' || rawName === 'R' || rawName === 'O') return null;
  const surname = normalizeSurname(rawName);
  const key = `${year}${surname}`;
  const manifest = await loadManifest();
  const variants = manifest[key];
  if (!variants || !variants.length) return null;
  return `${IMG_BASE}${variants[0]}`;
}

/**
 * Same resolution as getPortraitUrl() but keyed directly off a candidate's
 * full name (used when the caller already has the name, e.g. from
 * getUnitCandidateFullNames(), and wants to avoid re-deriving it).
 */
export async function getPortraitUrlForName(year, fullName) {
  if (!isFinite(year) || !fullName) return null;
  const surname = normalizeSurname(lastNameFrom(String(fullName)));
  if (!surname) return null;
  const key = `${year}${surname}`;
  const manifest = await loadManifest();
  const variants = manifest[key];
  if (!variants || !variants.length) return null;
  return `${IMG_BASE}${variants[0]}`;
}
