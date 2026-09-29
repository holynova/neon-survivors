import test from 'node:test';
import assert from 'node:assert/strict';
import {
  circleHit,
  circleOverlapArea,
  inCone,
  segmentHitsCircle,
  sweepCircle,
  SpatialHash,
} from '../../src/game/collision.js';
import { Rng } from '../../src/core/rng.js';

test('circleHit detects overlap and separation', () => {
  assert.equal(circleHit(0, 0, 1, 1.5, 0, 1), true);
  assert.equal(circleHit(0, 0, 1, 2.5, 0, 1), false);
  assert.equal(circleHit(0, 0, 2, 0, 2, 1), true);
});

test('circleOverlapArea is symmetric and bounded', () => {
  const a = circleOverlapArea(0, 0, 1, 1, 0, 1);
  const b = circleOverlapArea(1, 0, 1, 0, 0, 1);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.ok(a > 0 && a < Math.PI);
  assert.equal(circleOverlapArea(0, 0, 1, 5, 0, 1), 0);
  // fully contained -> area of the smaller circle
  assert.ok(Math.abs(circleOverlapArea(0, 0, 3, 0.1, 0, 1) - Math.PI) < 1e-6);
});

test('inCone respects range and half-angle', () => {
  const dir = { x: 1, z: 0 };
  assert.equal(inCone(0, 0, dir.x, dir.z, 0.4, 10, 5, 0, 0.3), true);
  assert.equal(inCone(0, 0, dir.x, dir.z, 0.4, 10, 5, 4, 0.3), false);
  assert.equal(inCone(0, 0, dir.x, dir.z, 0.4, 10, 20, 0, 0.3), false);
  // behind the player
  assert.equal(inCone(0, 0, dir.x, dir.z, 0.4, 10, -5, 0, 0.3), false);
  // directly behind at point blank is still behind (large targets aside)
  assert.equal(inCone(0, 0, dir.x, dir.z, 0.4, 10, -0.2, 0, 0.3), false);
  // but a big target overlapping the cone edge counts as a hit
  assert.equal(inCone(0, 0, dir.x, dir.z, 0.4, 10, 2, 2.5, 3), true);
});

test('sweepCircle resolves time of impact for fast projectiles', () => {
  // a bullet travelling 10 units in one step must not tunnel past a small target
  const t = sweepCircle(0, 0, 10, 0, 5, 0, 0.4);
  assert.ok(t >= 0 && t <= 1);
  assert.ok(Math.abs(t - 0.46) < 0.01, `expected ~0.46, got ${t}`);
  // a miss along the same line returns -1
  assert.equal(sweepCircle(0, 0, 10, 0, 5, 4, 0.4), -1);
  // already overlapping at step start
  assert.equal(sweepCircle(5, 0, 6, 0, 5, 0, 1), 0);
  // target behind the start point is never hit
  assert.equal(sweepCircle(5, 0, 6, 0, -5, 0, 0.4), -1);
  // degenerate zero-length step
  assert.equal(sweepCircle(5, 0, 5, 0, 5.2, 0, 0.4), 0);
  assert.equal(sweepCircle(5, 0, 5, 0, 8, 0, 0.4), -1);
});

test('sweepCircle never misses anything segmentHitsCircle catches', () => {
  const rng = new Rng(17);
  for (let i = 0; i < 3000; i++) {
    const ax = rng.range(-5, 5);
    const az = rng.range(-5, 5);
    const bx = ax + rng.range(-8, 8);
    const bz = az + rng.range(-8, 8);
    const cx = rng.range(-6, 6);
    const cz = rng.range(-6, 6);
    const r = rng.range(0.2, 2);
    const seg = segmentHitsCircle(ax, az, bx, bz, cx, cz, r);
    const sw = sweepCircle(ax, az, bx, bz, cx, cz, r) >= 0;
    assert.equal(seg, sw, `mismatch for ${ax},${az} -> ${bx},${bz} vs ${cx},${cz} r=${r}`);
  }
});

test('segmentHitsCircle handles fast projectiles tunneling', () => {
  // segment from x=0 to x=10 passes through a circle at x=5
  assert.equal(segmentHitsCircle(0, 0, 10, 0, 5, 0, 0.5), true);
  // a single point far away does not
  assert.equal(segmentHitsCircle(0, 0, 0.001, 0, 5, 0, 0.5), false);
  // perpendicular distance decides the outcome
  assert.equal(segmentHitsCircle(0, 0, 10, 0, 5, 4.9, 0.5), false);
  assert.equal(segmentHitsCircle(0, 0, 10, 0, 5, 4.6, 0.5), false);
  assert.equal(segmentHitsCircle(0, 0, 10, 0, 5, 0.4, 0.5), true);
});

test('SpatialHash returns candidates within radius', () => {
  const h = new SpatialHash(2);
  const objs = [];
  for (let i = 0; i < 40; i++) {
    const o = { id: i, x: (i % 8) * 3 - 10, z: Math.floor(i / 8) * 3 - 6 };
    h.insert(o, o.x, o.z);
    objs.push(o);
  }
  const out = h.query(0, 0, 4);
  assert.ok(out.length > 0 && out.length < objs.length);
  for (const o of out) {
    // every returned object must genuinely overlap the query disc
    assert.ok(Math.hypot(o.x, o.z) <= 4 + 2.83);
  }
  assert.equal(new Set(out).size, out.length, 'no duplicates');
});

test('SpatialHash clear empties the map', () => {
  const h = new SpatialHash(2);
  h.insert({ id: 1 }, 0, 0);
  assert.equal(h.query(0, 0, 1).length, 1);
  h.clear();
  assert.equal(h.query(0, 0, 1).length, 0);
});
