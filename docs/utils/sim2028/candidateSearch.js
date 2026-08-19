'use strict';

/**
 * Search over every historical candidate portrait on file, for sim2028's
 * candidate search box. Backed by the static index at docs/img/candidates.json
 * (built by tools/build_candidate_index.py from docs/img/portraits.json +
 * docs/presidential_margins.csv -- this is a static site, so there's no
 * server-side search available at runtime).
 */

const INDEX_URL = 'img/candidates.json';

let indexPromise = null;

function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(INDEX_URL)
      .then(res => (res.ok ? res.json() : []))
      .catch(() => []);
  }
  return indexPromise;
}

/** "Ronald Reagan — 1980" */
export function formatLabel(entry) {
  return `${entry.name} — ${entry.year}`;
}

/**
 * Case-insensitive search over candidate name + year. Name matches where any
 * word starts with the query rank above a plain substring match; ties break
 * by earlier year, then name. Returns at most `limit` entries.
 */
export async function searchCandidates(query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const entries = await loadIndex();
  const scored = [];
  for (const entry of entries) {
    const nameLower = entry.name.toLowerCase();
    const yearStr = String(entry.year);
    const words = nameLower.split(/\s+/);
    let score;
    if (words.some(w => w.startsWith(q))) score = 0;
    else if (nameLower.includes(q)) score = 1;
    else if (yearStr.includes(q)) score = 2;
    else continue;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.year - b.entry.year || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, limit).map(s => s.entry);
}

export default { searchCandidates, formatLabel };
