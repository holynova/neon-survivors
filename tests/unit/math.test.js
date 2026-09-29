import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../../src/core/rng.js';
import {
  clamp,
  lerp,
  damp,
  dist,
  rotate2,
  angleDiff,
  angleLerp,
  wrapDelta,
  smoothstep,
  normalize2,
} from '../../src/core/math.js';

test('clamp / lerp / smoothstep', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
  assert.equal(clamp(1.5, 0, 3), 1.5);
  assert.equal(lerp(0, 10, 0.25), 2.5);
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(0.5), 0.5);
});

test('damp is frame-rate independent', () => {
  const a = damp(0, 10, 5, 1 / 60);
  const b = damp(0, 10, 5, 1 / 30);
  // two half-steps should land in nearly the same place
  assert.ok(Math.abs(damp(a, 10, 5, 1 / 60) - b) < 1e-9);
});

test('dist / normalize2 / rotate2', () => {
  assert.equal(dist(0, 0, 3, 4), 5);
  const n = normalize2(3, 4);
  assert.ok(Math.abs(Math.hypot(n.x, n.z) - 1) < 1e-9);
  const r = rotate2(1, 0, Math.PI / 2);
  assert.ok(Math.abs(r.x) < 1e-9 && Math.abs(r.z - 1) < 1e-9);
});

test('angle helpers wrap correctly', () => {
  // 6.2 rad is "behind" 0.1 rad, so the shortest delta is negative
  assert.ok(Math.abs(angleDiff(0.1, 6.2) - (6.2 - 0.1 - Math.PI * 2)) < 1e-9);
  assert.ok(angleDiff(0.1, 6.2) < 0);
  assert.ok(angleDiff(6.2, 0.1) > 0);
  assert.ok(Math.abs(angleDiff(1, 1)) < 1e-12);
  // halfway between 0.1 and 6.2 the short way is ~0.008 rad
  const r = angleLerp(0.1, 6.2, 0.5);
  assert.ok(Math.abs(r) < 0.02, `expected ~0.008, got ${r}`);
  // moving halfway leaves half the original delta between r and the target
  assert.ok(Math.abs(angleDiff(r, 6.2) - angleDiff(0.1, 6.2) / 2) < 1e-9);
  // t=1 lands on the same *direction*, though the raw value is unwrapped
  assert.ok(Math.abs(angleDiff(angleLerp(0.1, 6.2, 1), 6.2)) < 1e-9);
  assert.ok(Math.abs(angleLerp(0, 1, 0)) < 1e-12);
});

test('wrapDelta wraps within half-extent', () => {
  // world is 92 wide (half = 46), so 49 is equivalent to -43
  assert.equal(wrapDelta(49, 46), -43);
  assert.equal(wrapDelta(-49, 46), 43);
  assert.equal(wrapDelta(0, 46), 0);
  assert.equal(wrapDelta(20, 46), 20);
});

test('Rng is deterministic for a seed', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('Rng respects range/int bounds', () => {
  const r = new Rng(7);
  for (let i = 0; i < 500; i++) {
    const v = r.range(3, 9);
    assert.ok(v >= 3 && v <= 9);
    const n = r.int(2, 5);
    assert.ok(n >= 2 && n <= 5 && Number.isInteger(n));
  }
});

test('Rng sample returns distinct items', () => {
  const r = new Rng(11);
  const src = [1, 2, 3, 4, 5, 6, 7];
  const out = r.sample(src, 3);
  assert.equal(out.length, 3);
  assert.equal(new Set(out).size, 3);
});

test('Rng weighted respects weights', () => {
  const r = new Rng(99);
  const items = [
    { id: 'a', weight: 9 },
    { id: 'b', weight: 1 },
  ];
  let a = 0;
  for (let i = 0; i < 4000; i++) if (r.weighted(items).id === 'a') a++;
  assert.ok(a > 3200 && a < 3900, `expected ~90%, got ${(a / 40).toFixed(1)}%`);
});

test('Rng inDisc stays inside radius, inRing inside band', () => {
  const r = new Rng(5);
  for (let i = 0; i < 300; i++) {
    const p = r.inDisc(3);
    assert.ok(Math.hypot(p.x, p.z) <= 3.0001);
    const q = r.inRing(2, 5);
    const d = Math.hypot(q.x, q.z);
    assert.ok(d >= 2 && d <= 5.0001);
  }
});

test('Rng reset restores sequence', () => {
  const r = new Rng(123);
  const first = [r.next(), r.next(), r.next()];
  r.reset();
  const second = [r.next(), r.next(), r.next()];
  assert.deepEqual(first, second);
});
