'use strict';

// Pure decision logic for when to pause election night and show a batch of
// "state called" cards, instead of interrupting on every single call.
//
// election-night.js owns the actual pending-events array (it lives on
// `state` there); this module only decides, given a snapshot of that
// queue's shape, whether *now* is the moment to flush it into a checkpoint
// popup. Keeping it pure (no DOM, no shared mutable state) makes it cheap
// to unit test - see tests/checkpointScheduler.test.mjs.

export const DEFAULT_SCHEDULER_OPTIONS = {
  // Fire once this many simulated minutes have passed with nothing new
  // pending - "the burst seems to be over, show what we've got."
  quietGapMinutes: 12,
  // Safety valve: don't let a slow trickle of borderline-confidence calls
  // hold a checkpoint open forever even if the gap is never quite hit.
  maxBatchSpanMinutes: 45,
  // Safety valve: don't let a checkpoint grow unboundedly large either.
  maxBatchSize: 12
};

/**
 * @param {object} params
 * @param {number} params.pendingCount - events waiting to be shown
 * @param {number} params.lastEventTime - sim-minutes timestamp of the most
 *   recent pending event (only meaningful when pendingCount > 0)
 * @param {number} params.batchStartTime - sim-minutes timestamp of the
 *   oldest pending event currently queued
 * @param {number} params.currentTime - current sim-minutes clock
 * @param {number} params.simEnd - end-of-night sim-minutes clock
 * @param {boolean} [params.forceFlag] - set when an event that should never
 *   wait for the gap (the outcome-clinch "X clinches the presidency"
 *   moment) is in the pending queue
 * @param {object} [options] - overrides for DEFAULT_SCHEDULER_OPTIONS
 * @returns {boolean} whether a checkpoint should fire right now
 */
export function shouldFireCheckpoint(params, options) {
  const opts = { ...DEFAULT_SCHEDULER_OPTIONS, ...(options || {}) };
  const {
    pendingCount = 0,
    lastEventTime = -Infinity,
    batchStartTime = -Infinity,
    currentTime = 0,
    simEnd = Infinity,
    forceFlag = false
  } = params || {};

  if (pendingCount <= 0) return false;
  if (forceFlag) return true;
  if (pendingCount >= opts.maxBatchSize) return true;
  if (currentTime - batchStartTime >= opts.maxBatchSpanMinutes) return true;
  if (currentTime >= simEnd - 1e-6) return true;
  return (currentTime - lastEventTime) >= opts.quietGapMinutes;
}
