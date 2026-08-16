import assert from 'assert';
import { groupEventsIntoCheckpoints, findNextCheckpoint, DEFAULT_SCHEDULER_OPTIONS } from '../docs/utils/electionNight/checkpointScheduler.js';

// --- 1. empty input produces no checkpoints ------------------------------
(function testEmptyInput() {
  assert.deepStrictEqual(groupEventsIntoCheckpoints([]), []);
  console.log('PASS: empty input produces no checkpoints');
})();

// --- 2. your 9:00-9:15 burst / 9:29 next-call example --------------------
(function testBurstThenGapExample() {
  // Five calls between t=0 and t=15 (9:00-9:15pm equivalent), then nothing
  // until t=29 (9:29pm) - the first batch should close right at t=15 (the
  // gap to t=29 is 14 >= the 12-minute default), not merge with the next call.
  const events = [
    { time: 0 }, { time: 4 }, { time: 9 }, { time: 12 }, { time: 15 },
    { time: 29 }
  ];
  const checkpoints = groupEventsIntoCheckpoints(events);
  assert.strictEqual(checkpoints.length, 2, 'should split into two checkpoints, not one giant batch');
  assert.strictEqual(checkpoints[0].time, 15, 'first checkpoint should close at the last event before the gap');
  assert.strictEqual(checkpoints[0].events.length, 5);
  assert.strictEqual(checkpoints[1].time, 29);
  assert.strictEqual(checkpoints[1].events.length, 1);
  console.log('PASS: burst-then-gap example splits into two checkpoints at the right boundary');
})();

// --- 3. simultaneous poll-close burst stays batched -----------------------
(function testSimultaneousBurstStaysBatched() {
  // A wave of instant calls sharing the exact same timestamp (poll close)
  // should end up in one checkpoint together (gap between them is 0).
  const events = [{ time: 240 }, { time: 240 }, { time: 240 }, { time: 240 }, { time: 300 }];
  const checkpoints = groupEventsIntoCheckpoints(events);
  assert.strictEqual(checkpoints.length, 2);
  assert.strictEqual(checkpoints[0].events.length, 4, 'the simultaneous burst should stay in one checkpoint');
  console.log('PASS: simultaneous poll-close burst stays batched together');
})();

// --- 4. outcome-clinch force flag closes its batch immediately -----------
(function testForceFlagClosesBatchImmediately() {
  // Even though the next event is well within the quiet gap, a forced event
  // (outcome-clinch) should still end its own checkpoint right there, so
  // "X clinches the presidency" isn't held hostage waiting for more calls.
  const events = [{ time: 100 }, { time: 101, forceFlag: true }, { time: 103 }];
  const checkpoints = groupEventsIntoCheckpoints(events);
  assert.strictEqual(checkpoints.length, 2);
  assert.strictEqual(checkpoints[0].time, 101);
  assert.strictEqual(checkpoints[0].events.length, 2);
  assert.strictEqual(checkpoints[1].time, 103);
  console.log('PASS: a forced (outcome-clinch) event closes its batch immediately');
})();

// --- 5. max batch size safety valve ---------------------------------------
(function testMaxBatchSize() {
  // A run of events all within the quiet gap of each other, but more of
  // them than maxBatchSize - should split once the cap is hit even though
  // the gap rule alone would have kept merging them.
  const n = DEFAULT_SCHEDULER_OPTIONS.maxBatchSize + 3;
  const events = Array.from({ length: n }, (_, i) => ({ time: i * 1 }));
  const checkpoints = groupEventsIntoCheckpoints(events);
  assert.ok(checkpoints.length >= 2, 'should split once maxBatchSize is hit');
  assert.strictEqual(checkpoints[0].events.length, DEFAULT_SCHEDULER_OPTIONS.maxBatchSize);
  console.log('PASS: max batch size safety valve splits an oversized batch');
})();

// --- 6. max batch span safety valve (slow trickle never hits the gap) ----
(function testMaxBatchSpan() {
  // A call every 10 minutes forever (never a 12-min gap) should still split
  // once the batch has been open longer than maxBatchSpanMinutes.
  const events = [];
  for (let t = 0; t <= 100; t += 10) events.push({ time: t });
  const checkpoints = groupEventsIntoCheckpoints(events);
  assert.ok(checkpoints.length >= 2, 'a batch open past maxBatchSpanMinutes should have split');
  checkpoints.slice(0, -1).forEach(cp => {
    const span = cp.time - cp.events[0].time;
    assert.ok(span <= DEFAULT_SCHEDULER_OPTIONS.maxBatchSpanMinutes + 10, `checkpoint span ${span} should not run away`);
  });
  console.log('PASS: max batch span safety valve splits a slow trickle');
})();

// --- 7. end-of-night: last event always closes its batch -----------------
(function testEndOfNightFlush() {
  const events = [{ time: 10 }, { time: 990 }, { time: 995 }];
  const checkpoints = groupEventsIntoCheckpoints(events);
  const last = checkpoints[checkpoints.length - 1];
  assert.strictEqual(last.time, 995, 'the final event must always close out its own checkpoint');
  console.log('PASS: the last event always closes out its checkpoint (nothing left dangling)');
})();

// --- 8. rewind/reorder independence: same events, different input order --
(function testOrderIndependence() {
  // The whole point of switching to batch grouping is that the result only
  // depends on the *set* of events, not the order they're handed in (which
  // matters once this is fed by a deterministically precomputed schedule
  // rather than live arrival order).
  const events = [{ time: 50 }, { time: 5 }, { time: 12 }, { time: 8 }];
  const a = groupEventsIntoCheckpoints(events);
  const b = groupEventsIntoCheckpoints(events.slice().reverse());
  assert.deepStrictEqual(a, b, 'grouping should not depend on input order');
  console.log('PASS: grouping result is independent of input event order');
})();

// --- 9. findNextCheckpoint: normal forward playback fires one at a time --
(function testFindNextCheckpointForwardPlayback() {
  const events = [
    { time: 5 }, { time: 8 }, { time: 40 }, { time: 43 }, { time: 90 }
  ];
  const checkpoints = groupEventsIntoCheckpoints(events); // three checkpoints: t=8, t=43, t=90
  assert.strictEqual(checkpoints.length, 3);

  let cursor = 0;
  const firedOrder = [];
  // Simulate real ticking: currentTime creeps forward continuously, and at
  // every step we only ever get back the single next checkpoint, never more.
  for (let currentTime = 0; currentTime <= 90; currentTime += 1) {
    const next = findNextCheckpoint(checkpoints, cursor, currentTime);
    if (next) {
      firedOrder.push(next.time);
      cursor = next.time;
    }
  }
  assert.deepStrictEqual(firedOrder, [8, 43, 90], 'checkpoints should fire one at a time, in order, as time passes each one');
  console.log('PASS: findNextCheckpoint fires checkpoints one at a time during normal forward playback');
})();

// --- 10. THE ACTUAL BUG: rewind then resume must not dump everything -----
(function testRewindDoesNotDumpEverything() {
  // Regression test for the reported bug: play forward past several
  // checkpoints, rewind (which - per seekToProgress()'s fix - snaps the
  // cursor back to the rewind target instead of leaving it at the old,
  // far-ahead position), then resume playing forward. The old reactive
  // queue design would dump every checkpoint since the beginning in one
  // shot the instant playback resumed; this design must not.
  const events = [
    { time: 5 }, { time: 8 },      // checkpoint A: t=8
    { time: 40 }, { time: 43 },    // checkpoint B: t=43
    { time: 70 },                  // checkpoint C: t=70
    { time: 90 }                   // checkpoint D: t=90
  ];
  const checkpoints = groupEventsIntoCheckpoints(events);
  assert.strictEqual(checkpoints.length, 4);

  // Play forward to t=90, firing every checkpoint along the way.
  let cursor = 0;
  for (let t = 0; t <= 90; t += 1) {
    const next = findNextCheckpoint(checkpoints, cursor, t);
    if (next) cursor = next.time;
  }
  assert.strictEqual(cursor, 90, 'sanity check: should have played through to the last checkpoint');

  // User rewinds the scrubber to t=20 - seekToProgress() sets the cursor to
  // match the seek target directly (this is the actual fix under test).
  cursor = 20;
  const currentTimeAfterSeek = 20;
  // The seek itself must not have fired anything.
  assert.strictEqual(findNextCheckpoint(checkpoints, cursor, currentTimeAfterSeek), null,
    'a seek/rewind must never itself surface a checkpoint');

  // Resume playing forward from t=20. This must surface checkpoint B (t=43)
  // and nothing else in the very first check - NOT a bundle of everything
  // from t=0 onward (that's the exact bug: getting prompted to watch every
  // single state call from the beginning all at once).
  const firedAfterRewind = [];
  for (let t = 20; t <= 90; t += 1) {
    const next = findNextCheckpoint(checkpoints, cursor, t);
    if (next) {
      firedAfterRewind.push(next.time);
      cursor = next.time;
    }
  }
  assert.deepStrictEqual(firedAfterRewind, [43, 70, 90],
    'resuming after a rewind should replay only what is still ahead, one checkpoint at a time - never checkpoint A again, and never all of B+C+D bundled into one');
  console.log('PASS: rewinding then resuming playback surfaces checkpoints one at a time, never a bundled dump');
})();

// --- 11. a big forward skip silently suppresses what it jumped over ------
(function testForwardSkipSuppressesSkipped() {
  const events = [{ time: 5 }, { time: 40 }, { time: 70 }, { time: 90 }];
  const checkpoints = groupEventsIntoCheckpoints(events); // four checkpoints
  // User drags the scrubber straight to t=85, skipping over the t=5, t=40,
  // and t=70 checkpoints entirely without ever playing through them.
  const cursor = 85;
  assert.strictEqual(findNextCheckpoint(checkpoints, cursor, 85), null,
    'the jump itself must not surface anything it skipped over');
  // Only the one checkpoint still ahead of the new position should ever appear.
  assert.strictEqual(findNextCheckpoint(checkpoints, cursor, 90).time, 90);
  console.log('PASS: a big forward skip silently suppresses everything it jumped over');
})();

console.log('\nAll checkpointScheduler tests passed.');
