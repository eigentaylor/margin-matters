import assert from 'assert';
import { shouldFireCheckpoint, DEFAULT_SCHEDULER_OPTIONS } from '../docs/utils/electionNight/checkpointScheduler.js';

// --- 1. empty queue never fires ------------------------------------------
(function testEmptyQueueNeverFires() {
  const result = shouldFireCheckpoint({
    pendingCount: 0, lastEventTime: 100, batchStartTime: 100, currentTime: 500, simEnd: 1000
  });
  assert.strictEqual(result, false, 'an empty pending queue should never fire a checkpoint');
  console.log('PASS: empty queue never fires');
})();

// --- 2. your 9:00-9:15 burst / 9:29 next-call example --------------------
(function testBurstThenGapExample() {
  // Batch opened at t=0 (9:00pm equivalent), last call at t=15 (9:15pm).
  // Next call isn't until t=29 (9:29pm). The checkpoint should fire once
  // the quiet gap (12 min default) has elapsed since the last call, i.e.
  // at t=27 - before the next call at t=29, and NOT fire any earlier.
  const notYet = shouldFireCheckpoint({
    pendingCount: 5, lastEventTime: 15, batchStartTime: 0, currentTime: 20, simEnd: 1000
  });
  assert.strictEqual(notYet, false, 'should not fire before the quiet gap has elapsed');

  const fires = shouldFireCheckpoint({
    pendingCount: 5, lastEventTime: 15, batchStartTime: 0, currentTime: 27, simEnd: 1000
  });
  assert.strictEqual(fires, true, 'should fire once the quiet gap has elapsed');
  console.log('PASS: burst-then-gap example fires within the quiet-gap window, not before');
})();

// --- 3. simultaneous poll-close burst stays batched -----------------------
(function testSimultaneousBurstStaysBatched() {
  // A wave of instant calls at the same timestamp (poll close) should not
  // fire immediately just because pendingCount > 1 - only the gap/size/span
  // rules should trigger it.
  const result = shouldFireCheckpoint({
    pendingCount: 6, lastEventTime: 240, batchStartTime: 240, currentTime: 240, simEnd: 1000
  });
  assert.strictEqual(result, false, 'a fresh simultaneous burst should not fire instantly');
  console.log('PASS: simultaneous poll-close burst stays batched until the gap elapses');
})();

// --- 4. outcome-clinch force flag bypasses the gap ------------------------
(function testForceFlagBypassesGap() {
  const result = shouldFireCheckpoint({
    pendingCount: 1, lastEventTime: 300, batchStartTime: 300, currentTime: 300.01, simEnd: 1000, forceFlag: true
  });
  assert.strictEqual(result, true, 'an outcome-clinch event should fire immediately, ignoring the quiet gap');
  console.log('PASS: outcome-clinch force flag bypasses the quiet gap');
})();

// --- 5. max batch size safety valve ---------------------------------------
(function testMaxBatchSize() {
  const result = shouldFireCheckpoint({
    pendingCount: DEFAULT_SCHEDULER_OPTIONS.maxBatchSize, lastEventTime: 100, batchStartTime: 100, currentTime: 100.01, simEnd: 1000
  });
  assert.strictEqual(result, true, 'hitting maxBatchSize should force a fire even inside the gap window');
  console.log('PASS: max batch size safety valve fires early');
})();

// --- 6. max batch span safety valve (slow trickle never hits the gap) ----
(function testMaxBatchSpan() {
  // A call arrives every 10 minutes forever (never a 12-min gap), but the
  // batch has been open since t=0 and it's now t=45 - span valve should fire.
  const result = shouldFireCheckpoint({
    pendingCount: 4, lastEventTime: 40, batchStartTime: 0, currentTime: 45, simEnd: 1000
  });
  assert.strictEqual(result, true, 'a batch open past maxBatchSpanMinutes should force a fire');
  console.log('PASS: max batch span safety valve fires on a slow trickle');
})();

// --- 7. end-of-night flush -------------------------------------------------
(function testEndOfNightFlush() {
  const result = shouldFireCheckpoint({
    pendingCount: 2, lastEventTime: 995, batchStartTime: 990, currentTime: 1000, simEnd: 1000
  });
  assert.strictEqual(result, true, 'anything still pending at simEnd should be flushed');
  console.log('PASS: end-of-night flush fires with pending events at simEnd');
})();

console.log('\nAll checkpointScheduler tests passed.');
