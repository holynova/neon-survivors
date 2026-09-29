export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Coerce anything to a finite number, falling back to `safe`. */
export function finite(v, safe = 0) {
  return Number.isFinite(v) ? v : safe;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, v) {
  return a === b ? 0 : (v - a) / (b - a);
}

export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Frame-rate independent exponential approach. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Shortest signed delta from angle `a` to angle `b`, in (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function angleLerp(a, b, t) {
  return a + angleDiff(a, b) * t;
}

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function dist(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

export function normalize2(x, z) {
  const len = Math.hypot(x, z);
  if (len < 1e-6) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}

/** Rotate a 2D direction by `a` radians. */
export function rotate2(x, z, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - z * s, z: x * s + z * c };
}

export function rad(deg) {
  return (deg * Math.PI) / 180;
}

export function deg(r) {
  return (r * 180) / Math.PI;
}

/** Signed, wrapped XZ displacement from a to b. */
export function wrapDelta(value, half) {
  const span = half * 2;
  let d = value % span;
  if (d > half) d -= span;
  if (d < -half) d += span;
  return d;
}
