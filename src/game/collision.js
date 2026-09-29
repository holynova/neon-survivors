import { Pool } from '../core/pool.js';

/**
 * Shared circle-vs-circle overlap on the XZ plane.
 * Pure static functions — no Three.js dependency, fully unit testable.
 */
export function circleHit(ax, az, ar, bx, bz, br) {
  const r = ar + br;
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz <= r * r;
}

export function circleOverlapArea(ax, az, ar, bx, bz, br) {
  const dx = ax - bx;
  const dz = az - bz;
  const r = ar + br;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return 0;
  const d = Math.sqrt(d2);
  if (d <= Math.abs(ar - br)) {
    const m = Math.min(ar, br);
    return Math.PI * m * m;
  }
  const a1 = Math.acos((ar * ar + d2 - br * br) / (2 * ar * d));
  const a2 = Math.acos((br * br + d2 - ar * ar) / (2 * br * d));
  const area = ar * ar * (a1 - Math.sin(2 * a1) / 2) + br * br * (a2 - Math.sin(2 * a2) / 2);
  return Math.max(0, area);
}

/**
 * Is target inside a cone (half-angle `half`), origin at (ox,oz) facing (dirX,dirZ)?
 * The cone is widened by the target's angular radius so a body touching the
 * cone's edge still counts as a hit (no "just barely missed" feel).
 */
export function inCone(ox, oz, dirX, dirZ, half, range, tx, tz, tr = 0) {
  const dx = tx - ox;
  const dz = tz - oz;
  const d = Math.hypot(dx, dz);
  if (d > range + tr) return false;
  if (d < 1e-4) return true;
  const dot = (dx / d) * dirX + (dz / d) * dirZ;
  const slack = Math.min(Math.PI / 2, Math.asin(Math.min(1, tr / d)));
  return dot >= Math.cos(Math.min(Math.PI, half + slack));
}

/** Segment (a→b) vs circle. Returns true if the segment intersects. */
export function segmentHitsCircle(ax, az, bx, bz, cx, cz, cr) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-8) return circleHit(ax, az, 0, cx, cz, cr);
  let t = ((cx - ax) * dx + (cz - az) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t;
  const pz = az + dz * t;
  const ddx = px - cx;
  const ddz = pz - cz;
  return ddx * ddx + ddz * ddz <= cr * cr;
}

/**
 * Swept-circle overlap with quadratic time-of-impact resolution.
 * Returns the fraction of the step at which contact occurs (0..1) or -1.
 * Used for fast projectiles so they never tunnel through small enemies.
 */
export function sweepCircle(aX, aZ, bX, bZ, cX, cZ, r) {
  const dx = bX - aX;
  const dz = bZ - aZ;
  const fx = aX - cX;
  const fz = aZ - cZ;

  const A = dx * dx + dz * dz;
  if (A < 1e-12) return fx * fx + fz * fz <= r * r ? 0 : -1;

  const B = 2 * (fx * dx + fz * dz);
  const C = fx * fx + fz * fz - r * r;

  if (C <= 0) return 0; // started already overlapping

  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-B - sq) / (2 * A);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-B + sq) / (2 * A);
  if (t2 >= 0 && t2 <= 1) return t2;
  return -1;
}

/** Uniform spatial hash for broad-phase. */
export class SpatialHash {
  constructor(cell = 3) {
    this.cell = cell;
    this.map = new Map();
  }

  _key(cx, cz) {
    return cx * 73856093 ^ cx * 19349663 ^ cz * 83492791;
  }

  clear() {
    this.map.clear();
  }

  insert(obj, x, z) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const k = this._key(cx, cz);
    let bucket = this.map.get(k);
    if (!bucket) {
      bucket = [];
      this.map.set(k, bucket);
    }
    bucket.push(obj);
  }

  query(x, z, radius, out = []) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - radius) / c);
    const x1 = Math.floor((x + radius) / c);
    const z0 = Math.floor((z - radius) / c);
    const z1 = Math.floor((z + radius) / c);
    const seen = new Set();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const bucket = this.map.get(this._key(cx, cz));
        if (!bucket) continue;
        for (const o of bucket) {
          if (seen.has(o)) continue;
          seen.add(o);
          out.push(o);
        }
      }
    }
    return out;
  }
}

export { Pool };
