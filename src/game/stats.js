/** Player stat model: base + additive/multiplicative modifiers, derived values. */

export const BASE_STATS = {
  maxHp: 100,
  hpRegen: 0,
  moveSpeed: 7.4,
  damage: 1.0,        // global multiplier
  attackSpeed: 1.0,   // global multiplier on weapon cooldowns
  area: 1.0,          // global multiplier on range/size
  projectileSpeed: 1.0,
  critChance: 0.05,
  critDamage: 2.0,
  pickupRange: 2.2,
  armor: 0,
  luck: 1.0,
  dodge: 0,
  xpGain: 1.0,
  goldGain: 1.0,
  cooldown: 1.0,      // >1 = faster
  healthRegen: 0,
  lifesteal: 0,
  thorns: 0,
  magnetSpeed: 9,
  dashCooldown: 1.0,
};

/** Gems drift toward the player once inside this radius, regardless of level. */
export const PICKUP_AUTOMAGNET = 5.5;

/** Stats whose `pct` modifier multiplies the base value rather than adding. */
const PERCENT_KEYS = new Set([
  'moveSpeed',
  'attackSpeed',
  'area',
  'projectileSpeed',
  'pickupRange',
  'xpGain',
  'goldGain',
  'luck',
  'cooldown',
  'magnetSpeed',
  'dashCooldown',
  'dodge',
]);

export class StatBlock {
  constructor(base = BASE_STATS) {
    this.base = { ...base };
    this.flat = {};
    this.pct = {};
  }

  /** Mod entries: { key, value, mode: 'flat'|'pct' } */
  add(mod) {
    const { key, value, mode } = mod;
    if (mode === 'flat') this.flat[key] = (this.flat[key] ?? 0) + value;
    else this.pct[key] = (this.pct[key] ?? 0) + value;
    return this;
  }

  get(key) {
    const base = this.base[key] ?? 0;
    const flat = this.flat[key] ?? 0;
    const pct = this.pct[key] ?? 0;
    if (key === 'cooldown') return Math.max(0.2, (base + flat) * (1 + pct) * this.base.cooldown);
    if (key === 'dodge') return Math.min(0.75, Math.max(0, base + flat + pct));
    if (PERCENT_KEYS.has(key)) return Math.max(0, (base + flat) * (1 + pct));
    return Math.max(0, base + flat + pct);
  }

  snapshot() {
    const out = {};
    for (const k of Object.keys(this.base)) out[k] = this.get(k);
    return out;
  }
}

/** Total damage a hit deals after all multipliers. */
export function computeDamage(base, { multiplier = 1, critChance = 0.05, critDamage = 2, rng = Math.random, variance = 0.1, canCrit = true } = {}) {
  let dmg = base * multiplier;
  if (variance > 0) dmg *= 1 + (rng() * 2 - 1) * variance;
  const crit = canCrit && rng() < critChance;
  if (crit) dmg *= critDamage;
  return { damage: Math.max(1, dmg), crit };
}

/** Linear damage falloff for explosions: 100% at center → `floor` at the edge. */
export function falloff(distance, radius, floor = 0.55) {
  if (distance <= 0.0001) return 1;
  const k = Math.min(1, distance / radius);
  return 1 - (1 - floor) * k;
}

export { PERCENT_KEYS };
