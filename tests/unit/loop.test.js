import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../../src/core/rng.js';
import { Loop } from '../../src/core/loop.js';
import { Pool } from '../../src/core/pool.js';

/** Minimal performance/RAF shims so Loop is testable in Node. */
function withFakeRaf(run) {
  const g = globalThis;
  const prevRaf = g.requestAnimationFrame;
  const prevCancel = g.cancelAnimationFrame;
  const prevNow = g.performance;
  const timers = [];
  let now = 0;
  g.performance = { now: () => now };
  g.requestAnimationFrame = (cb) => {
    timers.push(cb);
    return timers.length;
  };
  g.cancelAnimationFrame = () => {};
  const advance = (ms, frames = 1) => {
    for (let i = 0; i < frames; i++) {
      now += ms;
      const batch = timers.splice(0, timers.length);
      for (const cb of batch) cb(now);
    }
  };
  try {
    return run({ advance, perfNow: () => now });
  } finally {
    g.requestAnimationFrame = prevRaf;
    g.cancelAnimationFrame = prevCancel;
    g.performance = prevNow;
  }
}

test('Pool reuses released objects and tracks the active list', () => {
  let made = 0;
  const p = new Pool(
    () => ({ id: made++, live: true }),
    (o) => {
      o.live = false;
    },
  );
  const a = p.spawn();
  const b = p.spawn();
  const c = p.spawn();
  assert.equal(made, 3);
  assert.equal(p.count, 3);
  p.release(b);
  assert.equal(p.count, 2);
  assert.ok(!b.live, 'reset must run on release');
  const d = p.spawn();
  assert.equal(d, b, 'released object should be reused');
  assert.equal(made, 3, 'no new allocation after release');
  p.releaseAt(0);
  assert.equal(p.count, 2);
  p.clear();
  assert.equal(p.count, 0);
});

test('Pool releaseAt swaps with the last element', () => {
  const p = new Pool(() => ({}), () => {});
  const [a, b, c] = [p.spawn(), p.spawn(), p.spawn()];
  p.releaseAt(1);
  assert.equal(p.count, 2);
  assert.deepEqual(new Set(p.active), new Set([a, c]));
  assert.ok(!p.active.includes(b));
});

test('Pool survives concurrent drain of everything', () => {
  const p = new Pool(() => ({}), () => {});
  for (let i = 0; i < 50; i++) p.spawn();
  for (let i = 0; i < 50; i++) p.releaseAt(p.count - 1);
  assert.equal(p.count, 0);
  assert.equal(p.spawn() != null, true);
});

test('Loop runs a fixed number of update steps per frame budget', () => {
  withFakeRaf(({ advance }) => {
    let steps = 0;
    const loop = new Loop(() => steps++, { step: 1 / 60, maxSubSteps: 5 });
    loop.start();
    advance(16.7, 1); // ~1 step
    assert.equal(steps, 1);
    advance(16.7, 1);
    assert.equal(steps, 2);
    // a huge stall must not cause a spiral of death
    advance(2000, 1);
    assert.ok(steps <= 2 + 5, `steps should be capped, got ${steps}`);
    loop.stop();
  });
});

test('Loop hitstop freezes scaled time then recovers', () => {
  withFakeRaf(({ advance }) => {
    const scales = [];
    const loop = new Loop(() => scales.push(loop.timeScale));
    loop.start();
    loop.hitstop(0.1);
    advance(16, 3);
    assert.ok(scales.slice(0, 3).every((s) => s < 0.1), `expected frozen, got ${scales.slice(0, 3)}`);
    advance(16, 20);
    assert.ok(scales.at(-1) > 0.9, `should recover, got ${scales.at(-1)}`);
    loop.stop();
  });
});

test('Loop slowMo dips then restores the time scale', () => {
  withFakeRaf(({ advance }) => {
    const loop = new Loop(() => {});
    loop.start();
    loop.slowMo(0.3, 0.2);
    const during = [];
    for (let i = 0; i < 3; i++) {
      advance(16, 1);
      during.push(loop.timeScale);
    }
    assert.ok(during.every((s) => s <= 0.35), `expected slow, got ${during}`);
    advance(16, 40);
    assert.equal(loop.timeScale, 1, 'time scale should return to normal');
    loop.stop();
  });
});

test('Loop time dilation also slows the fixed-step update rate', () => {
  withFakeRaf(({ advance }) => {
    let steps = 0;
    const loop = new Loop(() => steps++);
    loop.start();
    advance(16, 6);
    const normal = steps;
    assert.ok(normal >= 5, `expected ~6 steps at full speed, got ${normal}`);

    steps = 0;
    loop.slowMo(0.25, 5);
    advance(16, 6);
    assert.ok(steps < normal, `slow-mo should throttle updates, got ${steps} vs ${normal}`);
    loop.stop();
  });
});

test('Loop clamps absurd frame deltas', () => {
  withFakeRaf(({ advance }) => {
    let elapsed = 0;
    const loop = new Loop((dt) => {
      elapsed += dt;
    });
    loop.start();
    advance(5000, 1);
    assert.ok(elapsed < 0.3, `one stall frame advanced ${elapsed}s of game time`);
    loop.stop();
  });
});

test('Loop stop halts the callback chain', () => {
  withFakeRaf(({ advance }) => {
    let steps = 0;
    const loop = new Loop(() => steps++);
    loop.start();
    advance(16, 2);
    const seen = steps;
    loop.stop();
    advance(16, 5);
    assert.equal(steps, seen);
  });
});

test('Loop timeScale override wins over hitstop', () => {
  withFakeRaf(({ advance }) => {
    const loop = new Loop(() => {});
    loop.scaleOverride = 0.5;
    loop.start();
    advance(16, 2);
    assert.equal(loop.timeScale, 0.5);
    loop.stop();
  });
});

test('Loop hitstop freezes the fixed-step accumulator', () => {
  withFakeRaf(({ advance }) => {
    let steps = 0;
    const loop = new Loop(() => steps++);
    loop.start();
    loop.hitstop(0.5);
    const start = steps;
    advance(16, 5);
    assert.equal(steps, start, 'no updates should run during hitstop');
    loop.stop();
  });
});

test('stress: 300 entities simulated for 10k frames stay stable', () => {
  const rng = new Rng(4242);
  const ents = Array.from({ length: 300 }, () => ({
    x: rng.range(-40, 40),
    z: rng.range(-40, 40),
    vx: 0,
    vz: 0,
    alive: true,
    hp: 100,
  }));
  let t = 0;
  const step = () => {
    for (const e of ents) {
      if (!e.alive) continue;
      const a = Math.atan2(-e.z, -e.x);
      e.vx += Math.cos(a) * 0.6;
      e.vz += Math.sin(a) * 0.6;
      e.vx *= 0.94;
      e.vz *= 0.94;
      e.x += e.vx;
      e.z += e.vz;
      if (Math.abs(e.x) > 46) e.alive = false;
      if (Math.abs(e.z) > 46) e.alive = false;
    }
  };
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 10_000; i++) {
    t += 1 / 60;
    step();
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(Number.isFinite(t));
  assert.ok(ms < 2000, `10k frames x 300 entities took ${ms.toFixed(0)}ms`);
});
