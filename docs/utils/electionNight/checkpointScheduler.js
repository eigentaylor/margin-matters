'use strict';

// Pure grouping logic for the election-night "state call update" popup:
// given the full, already-known list of call/correction/outcome events for
// the night, decide how to batch them into checkpoints so the sim doesn't
// interrupt on every single call.
//
// This runs offline, once, against a deterministically precomputed event
// list (docs/election-night.js's computePlannedCheckpoints()) rather than
// reactively as events arrive live - that's what makes the grouping stable
// under rewinding/seeking: the schedule is the same regardless of how the
// user gets to a given point in the night. Keeping this pure (no DOM, no
// shared mutable state) makes it cheap to unit test - see
// tests/checkpointScheduler.test.mjs.

export const DEFAULT_SCHEDULER_OPTIONS = {
  // Close a batch once the gap to the *next* event is at least this many
  // simulated minutes - "nothing else is coming soon, show what we've got."
  quietGapMinutes: 12,
  // Safety valve: don't let a slow trickle of borderline-confidence calls
  // hold a checkpoint open forever even if the gap is never quite hit.
  maxBatchSpanMinutes: 45,
  // Safety valve: don't let a checkpoint grow unboundedly large either.
  maxBatchSize: 12
};

/**
 * @param {Array<{time: number, forceFlag?: boolean}>} events - every
 *   call/correction/outcome event for the night, in any order (this sorts
 *   its own copy). `forceFlag` marks an event that should never wait for
 *   the gap (the outcome-clinch "X clinches the presidency" moment) -
 *   closes its batch immediately, including everything queued alongside it.
 * @param {object} [options] - overrides for DEFAULT_SCHEDULER_OPTIONS
 * @returns {Array<{time: number, events: Array}>} checkpoints in time order;
 *   each checkpoint's `time` is its last event's time (when it becomes
 *   showable) and `events` is that batch's events, in time order.
 */
export function groupEventsIntoCheckpoints(events, options) {
  const opts = { ...DEFAULT_SCHEDULER_OPTIONS, ...(options || {}) };
  const sorted = (events || []).filter(Boolean).slice().sort((a, b) => a.time - b.time);
  const checkpoints = [];
  let batch = [];

  const flush = () => {
    if (!batch.length) return;
    checkpoints.push({ time: batch[batch.length - 1].time, events: batch });
    batch = [];
  };

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    batch.push(ev);
    const isLast = i === sorted.length - 1;
    const forced = !!ev.forceFlag;
    const batchStartTime = batch[0].time;
    const span = ev.time - batchStartTime;
    const gapToNext = isLast ? Infinity : sorted[i + 1].time - ev.time;
    if (forced || isLast
      || batch.length >= opts.maxBatchSize
      || span >= opts.maxBatchSpanMinutes
      || gapToNext >= opts.quietGapMinutes) {
      flush();
    }
  }

  return checkpoints;
}

/**
 * The live-playback side of the fix: given the precomputed schedule, find
 * the single earliest checkpoint that real forward ticking has just now
 * crossed - strictly after `cursorTime` (the last checkpoint already
 * consumed, or wherever a seek last landed) and at/before `currentTime`.
 * Returns at most one checkpoint even if several were crossed in one big
 * step (e.g. a high speed multiplier), so a caller that advances the
 * cursor to the returned checkpoint's time and calls this again next tick
 * naturally surfaces the rest one at a time, in order - never bundled.
 *
 * Any explicit seek (forward or backward) is expected to set the cursor to
 * match the seek target directly, bypassing this function entirely, so
 * jumping around the timeline never fires a checkpoint on its own - only
 * organic tick-by-tick playback does.
 */
export function findNextCheckpoint(plannedCheckpoints, cursorTime, currentTime, eps = 1e-6) {
  return (plannedCheckpoints || []).find(cp => cp && cp.time > cursorTime + eps && cp.time <= currentTime + eps) || null;
}
