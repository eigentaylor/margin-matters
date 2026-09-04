'use strict';

const STORAGE_KEY = 'yearQuizStats';
const ACC_FLOOR_EPS = 0.075;

export function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch (e) {
    // ignore (private browsing, quota, etc.)
  }
}

export function recordAttempt(year, correct) {
  const stats = loadStats();
  const entry = stats[year] || { correct: 0, total: 0 };
  entry.total += 1;
  if (correct) entry.correct += 1;
  stats[year] = entry;
  saveStats(stats);
  return stats;
}

export function resetStats() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // ignore
  }
  return {};
}

export function wilsonInterval(correct, total, z = 1.96) {
  if (!total) return { center: null, low: null, high: null };
  const n = total;
  const p = correct / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { center, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function computeWeights(years, stats, { learning }) {
  return years.map((y) => {
    const entry = stats[y];
    const n = entry ? entry.total : 0;
    const seen = 1 / Math.sqrt(n + 1);
    if (!learning) return seen;
    const a = n > 0 ? entry.correct / n : 0;
    const acc = (1 - a) + ACC_FLOOR_EPS;
    return seen * acc;
  });
}

export function pickWeightedYear(years, stats, { learning, lastYear } = {}) {
  if (years.length <= 1) return years[0];
  const weights = computeWeights(years, stats, { learning });
  if (lastYear != null) {
    const idx = years.indexOf(lastYear);
    if (idx !== -1) weights[idx] = 0;
  }
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) {
    // Shouldn't happen (seen(i) > 0 always for years.length > 1), but fall back to uniform.
    let y;
    do { y = years[Math.floor(Math.random() * years.length)]; }
    while (y === lastYear);
    return y;
  }
  let r = Math.random() * total;
  for (let i = 0; i < years.length; i++) {
    r -= weights[i];
    if (r <= 0) return years[i];
  }
  return years[years.length - 1];
}
