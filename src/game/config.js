/** Central tuning. All gameplay numbers live here (pure data, unit testable). */

export const ARENA = {
  // Sized so the play space roughly fills the camera frustum. Enemies spawn
  // just outside the visible edge, not at the arena border.
  half: 20,
  wallPad: 1.4,
  // spawn ring: just beyond what the camera can see, in any direction
  spawnMin: 15,
  spawnMax: 19,
};

export const PLAYER = {
  maxHp: 120,
  speed: 7.4,
  radius: 0.62,
  iframes: 0.65,
  dash: { speedMul: 2.25, dur: 0.26, cd: 2.0 },
  pickupBase: 3.2,
  pickupPerLevel: 0.16,
  pickupMax: 8,
};

export const XP = {
  // Deliberately shallow: the first upgrade should arrive within ~20 seconds so
  // the player reaches the build part of the game quickly.
  need: (lvl) => Math.round(4 + lvl * 3.2 + Math.pow(lvl, 1.5) * 1.1),
  gemValue: [1, 2, 4, 8, 16, 32],
  maxLevel: 60,
};

export const WAVES = {
  duration: 55,
  bossDuration: 70,
  total: 20,
  bossEvery: 5,
  prepTime: 6,
  restTime: 12,
  /**
   * The wave ends once the spawn queue is empty AND the field is clear, but
   * only after at least this much time has elapsed. Without this floor a player
   * who melts wave 1 in 15s would sit in an empty arena for the remaining 40s.
   */
  minDuration: 26,
};

export const ECONOMY = {
  coinMin: 8,
  coinMax: 34,
  goldPerKillChance: 0.14,
};

export const DMG = {
  critMult: 2.0,
  variance: 0.1,
  falloffRadius: 2.4,
};

export const CAMERA = {
  fov: 42,
  distance: 15,
  height: 19,
  lambda: 7.5,
  /** Zoom out a little when the screen gets crowded; 1 = no change. */
  crowdZoom: 0.22,
  crowdZoomMax: 1.45,
};

export const DIFFICULTY = {
  name: '标准',
  enemyHpMul: 1,
  enemyDmgMul: 1,
  spawnMul: 1,
  goldMul: 1,
};

export const DIFFICULTIES = {
  easy: { name: '休闲', enemyHpMul: 0.78, enemyDmgMul: 0.7, spawnMul: 0.82, goldMul: 1.15 },
  normal: DIFFICULTY,
  hard: { name: '硬核', enemyHpMul: 1.35, enemyDmgMul: 1.3, spawnMul: 1.25, goldMul: 1 },
  nightmare: { name: '噩梦', enemyHpMul: 1.8, enemyDmgMul: 1.7, spawnMul: 1.5, goldMul: 0.9 },
};

export const COLORS = {
  spark: [1.0, 0.86, 0.45],
  frost: [0.42, 0.85, 1.0],
  arc: [0.62, 0.55, 1.0],
  ember: [1.0, 0.45, 0.16],
  toxic: [0.55, 1.0, 0.4],
  blood: [1.0, 0.22, 0.3],
  holy: [1.0, 0.95, 0.6],
  void: [0.72, 0.3, 1.0],
};

export const RARITY = {
  common: { name: '普通', color: '#9fb4c7', weight: 100, mult: 1.0, glow: 0.25 },
  rare: { name: '稀有', color: '#41b8ff', weight: 46, mult: 1.18, glow: 0.5 },
  epic: { name: '史诗', color: '#c46bff', weight: 17, mult: 1.4, glow: 0.8 },
  legendary: { name: '传说', color: '#ffb13b', weight: 5.5, mult: 1.7, glow: 1.25 },
};

export const QUALITY = {
  particles: { low: 4000, med: 12000, high: 24000 },
  shadows: { low: false, med: true, high: true },
  pixelRatio: { low: 0.75, med: 1, high: 1.5 },
};
