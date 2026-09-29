/**
 * Deterministic, seedable PRNG (mulberry32). Pure logic — unit testable.
 */
export class Rng {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.state = (seed >>> 0) || 1;
  }

  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.state = (this.seed >>> 0) || 1;
    return this;
  }

  /** [0,1) */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(min, maxInclusive) {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  bool(chance = 0.5) {
    return this.next() < chance;
  }

  pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Pick by weight using item.weight (default 1). */
  weighted(arr, weightOf = (x) => x.weight ?? 1) {
    if (!arr || arr.length === 0) return undefined;
    let total = 0;
    for (const it of arr) total += Math.max(0, weightOf(it));
    if (total <= 0) return arr[0];
    let r = this.next() * total;
    for (const it of arr) {
      r -= Math.max(0, weightOf(it));
      if (r <= 0) return it;
    }
    return arr[arr.length - 1];
  }

  /** Fisher–Yates, returns a new array. */
  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Pick n distinct entries. */
  sample(arr, n) {
    return this.shuffle(arr).slice(0, Math.min(n, arr.length));
  }

  /** Random point inside a disc (uniform). */
  inDisc(radius = 1) {
    const a = this.next() * Math.PI * 2;
    const r = radius * Math.sqrt(this.next());
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }

  /** Ring position (on circumference band). */
  inRing(rMin, rMax) {
    const a = this.next() * Math.PI * 2;
    const r = this.range(rMin, rMax);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
}

export const defaultRng = new Rng(20260928);
