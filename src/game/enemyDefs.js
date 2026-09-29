/**
 * Enemy catalogue + scaling. Pure data / pure functions → unit testable.
 */

export const ENEMIES = {
  grunt: {
    id: 'grunt',
    name: '步兵',
    hp: 22,
    speed: 3.5,
    damage: 8,
    radius: 0.62,
    xp: 1,
    gold: [4, 12],
    color: '#ff4d6d',
    shape: 'tetra',
    behavior: 'chase',
    mass: 1,
    unlockWave: 1,
  },
  runner: {
    id: 'runner',
    name: '疾行者',
    hp: 16,
    speed: 6.4,
    damage: 7,
    radius: 0.5,
    xp: 1,
    gold: [4, 12],
    color: '#ff9f43',
    shape: 'octa',
    behavior: 'charger',
    mass: 0.8,
    dashCd: [1.6, 3.0],
    dashSpeed: 13,
    dashDur: 0.45,
    unlockWave: 2,
  },
  tank: {
    id: 'tank',
    name: '重装',
    hp: 130,
    speed: 2.2,
    damage: 20,
    radius: 1.15,
    xp: 5,
    gold: [14, 30],
    color: '#6c8cff',
    shape: 'box',
    behavior: 'chase',
    mass: 4,
    armor: 0.12,
    unlockWave: 4,
  },
  shooter: {
    id: 'shooter',
    name: '射手',
    hp: 34,
    speed: 2.9,
    damage: 10,
    radius: 0.62,
    xp: 3,
    gold: [8, 18],
    color: '#c86bff',
    shape: 'cone',
    behavior: 'ranged',
    keepDist: 11,
    shotCd: 2.1,
    bulletSpeed: 15,
    bulletDamage: 9,
    unlockWave: 5,
  },
  dasher: {
    id: 'dasher',
    name: '突刺者',
    hp: 46,
    speed: 3.2,
    damage: 16,
    radius: 0.66,
    xp: 4,
    gold: [10, 22],
    color: '#00e5ff',
    shape: 'blade',
    behavior: 'dasher',
    telegraph: 0.75,
    dashSpeed: 20,
    dashDur: 0.55,
    dashCd: [2.4, 3.6],
    unlockWave: 7,
  },
  swarmling: {
    id: 'swarmling',
    name: '蜂群',
    hp: 7,
    speed: 5.6,
    damage: 4,
    radius: 0.3,
    xp: 1,
    gold: [1, 4],
    color: '#7dff9b',
    shape: 'tiny',
    behavior: 'chase',
    mass: 0.3,
    unlockWave: 3,
  },
  orbiter: {
    id: 'orbiter',
    name: '环绕者',
    hp: 40,
    speed: 4.6,
    damage: 9,
    radius: 0.56,
    xp: 3,
    gold: [8, 16],
    color: '#ffd166',
    shape: 'ring',
    behavior: 'orbit',
    orbitR: 7,
    spin: 1.5,
    unlockWave: 6,
  },
  splitter: {
    id: 'splitter',
    name: '分裂体',
    hp: 70,
    speed: 3.0,
    damage: 12,
    radius: 0.95,
    xp: 4,
    gold: [10, 20],
    color: '#ff6ec7',
    shape: 'box',
    behavior: 'chase',
    mass: 2.5,
    splitInto: 'swarmling',
    splitCount: 3,
    unlockWave: 8,
  },
  elite: {
    id: 'elite',
    name: '精英',
    hp: 260,
    speed: 3.2,
    damage: 22,
    radius: 1.0,
    xp: 12,
    gold: [30, 55],
    color: '#ff4fd8',
    shape: 'tetra',
    behavior: 'chase',
    mass: 3.5,
    armor: 0.2,
    elite: true,
    unlockWave: 9,
  },
};

export const BOSSES = {
  colossus: {
    id: 'colossus',
    name: '熔核巨像',
    hp: 5400,
    speed: 2.0,
    damage: 32,
    radius: 2.6,
    xp: 90,
    gold: [200, 300],
    color: '#ff5a2b',
    shape: 'boss_core',
    behavior: 'boss_ring',
    mass: 40,
    armor: 0.16,
    boss: true,
    ringCd: 2.4,
    ringBullets: 22,
    ringSpeed: 11,
    chargeCd: 6.5,
  },
  hierophant: {
    id: 'hierophant',
    name: '冰霜使徒',
    hp: 13000,
    speed: 2.3,
    damage: 34,
    radius: 2.8,
    xp: 130,
    gold: [260, 380],
    color: '#66d9ff',
    shape: 'boss_frost',
    behavior: 'boss_frost',
    mass: 45,
    armor: 0.2,
    boss: true,
    ringCd: 3.0,
    ringBullets: 18,
    ringSpeed: 9,
    summonCd: 7.5,
    iceCd: 5.0,
  },
  devourer: {
    id: 'devourer',
    name: '虚空吞噬者',
    hp: 52000,
    speed: 2.6,
    damage: 40,
    radius: 3.2,
    xp: 220,
    gold: [400, 600],
    color: '#b14cff',
    shape: 'boss_void',
    behavior: 'boss_void',
    mass: 60,
    armor: 0.24,
    boss: true,
    ringCd: 2.2,
    ringBullets: 28,
    ringSpeed: 13,
    summonCd: 6,
    pullRadius: 22,
  },
};

export const BOSS_ORDER = ['colossus', 'hierophant', 'devourer'];

export function enemyScale(wave, difficulty) {
  return {
    // Gentler quadratic so early waves stay killable; the difficulty comes from
    // enemy count and composition rather than a brick wall of HP.
    hp: (1 + (wave - 1) * 0.19 + Math.pow(wave - 1, 1.7) * 0.028) * difficulty.enemyHpMul,
    damage: (1 + (wave - 1) * 0.075) * difficulty.enemyDmgMul,
    speed: 1 + Math.min(0.5, (wave - 1) * 0.03),
    xp: 1 + Math.floor((wave - 1) * 0.16),
    gold: 1 + (wave - 1) * 0.07,
  };
}

export function poolForWave(wave) {
  return Object.values(ENEMIES).filter((e) => e.unlockWave <= wave);
}

export function weightedPick(pool, wave, rng = Math.random) {
  // favor recently-unlocked types slightly less, so variety stays high
  const weighted = pool.map((e) => {
    const age = wave - e.unlockWave;
    return { e, weight: 1 / (1 + age * 0.06) };
  });
  const pick =
    typeof rng.weighted === 'function'
      ? rng.weighted(weighted).e
      : weighted[Math.floor(rng() * weighted.length)].e;
  return pick;
}

export function bossForWave(wave) {
  const idx = Math.floor(wave / WAVES_BOSS_EVERY) - 1;
  if (idx < 0 || idx >= BOSS_ORDER.length) return idx >= BOSS_ORDER.length ? BOSSES.devourer : null;
  return BOSSES[BOSS_ORDER[idx]];
}

const WAVES_BOSS_EVERY = 5;

export { WAVES_BOSS_EVERY };
