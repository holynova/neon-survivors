/**
 * Weapon catalogue. Pure data + pure firing-pattern helpers → unit testable.
 *
 * Every weapon exposes:
 *  id, name, nameEn, desc, color, tier, sound, maxLevel, base{...}, levels[...]
 * `fire` is implemented by weapons.js (needs world access).
 */

export const WEAPONS = [
  {
    id: 'scatter',
    name: '霰弹枪',
    nameEn: 'Scatter',
    desc: '近距离高爆发锥形散射，每发弹丸独立计算暴击',
    color: '#ffb13b',
    element: 'kinetic',
    tier: 1,
    sound: 'shotgun',
    maxLevel: 4,
    base: { pellets: 5, spread: 0.42, damage: 14, cd: 0.9, speed: 34, life: 0.42, range: 12, knock: 3.2, size: 0.34 },
    levels: [
      { pellets: 6, cd: 0.85 },
      { pellets: 8, damage: 19, spread: 0.5 },
      { pellets: 9, damage: 25, cd: 0.78, knock: 5 },
    ],
    evolve: { id: 'scatter_evolved', name: '爆裂霰弹枪' },
  },
  {
    id: 'smg',
    name: '脉冲机枪',
    nameEn: 'Pulse SMG',
    desc: '高射速单体弹，射速随机抖动；连续射击逐步提速',
    color: '#41b8ff',
    element: 'kinetic',
    tier: 1,
    sound: 'smg',
    maxLevel: 4,
    base: { damage: 5, cd: 0.12, speed: 52, life: 0.85, range: 20, knock: 0.7, size: 0.2, jitter: 0.1 },
    levels: [{ cd: 0.105 }, { damage: 7, pierce: 1 }, { damage: 8, cd: 0.09, multi: 2 }],
    evolve: { id: 'smg_evolved', name: '脉冲加特林', recipes: { magnetic_core: 1 } },
  },
  {
    id: 'tesla',
    name: '特斯拉线圈',
    nameEn: 'Tesla Coil',
    desc: '命中后弹跳至其他敌人，伤害逐次衰减并附加感电麻痹',
    color: '#a97bff',
    element: 'arc',
    tier: 2,
    sound: 'tesla',
    maxLevel: 4,
    base: { damage: 14, cd: 0.75, speed: 40, life: 0.7, range: 16, bounces: 4, decay: 0.88, stun: 0.25, size: 0.4 },
    levels: [{ bounces: 5 }, { damage: 20, bounces: 6, decay: 0.92 }, { damage: 26, cd: 0.6, stun: 0.45 }],
    evolve: { id: 'tesla_evolved', name: '风暴电网', recipes: { arc_core: 1 } },
  },
  {
    id: 'grenade',
    name: '榴弹发射器',
    nameEn: 'Grenade Launcher',
    desc: '抛物线弹丸，落地后引信引爆造成范围伤害与冲击波',
    color: '#ff7a3b',
    element: 'fire',
    tier: 2,
    sound: 'grenade',
    maxLevel: 4,
    base: { damage: 22, cd: 1.5, speed: 18, life: 1.5, radius: 3.4, fuse: 0.45, arc: 7, knock: 6, size: 0.44 },
    levels: [{ radius: 4 }, { damage: 34, count: 2 }, { damage: 46, radius: 4.8, cd: 1.25 }],
    evolve: { id: 'grenade_evolved', name: '集束爆轰', recipes: { ember_core: 1 } },
  },
  {
    id: 'frost',
    name: '霜冻喷枪',
    nameEn: 'Frost Lance',
    desc: '持续锥形粒子流，命中附加减速并留下冰霜痕迹',
    color: '#6fe3ff',
    element: 'frost',
    tier: 2,
    sound: 'frost',
    maxLevel: 4,
    base: { damage: 3.2, cd: 0.075, dps: true, cone: 0.42, range: 9, slow: 0.4, slowDur: 1.6, spread: 0.5 },
    levels: [{ cone: 0.5, range: 10 }, { damage: 4.4, slow: 0.5 }, { damage: 5.6, cone: 0.58, range: 11.5 }],
    evolve: { id: 'frost_evolved', name: '绝对零域', recipes: { frost_core: 1 } },
  },
  {
    id: 'orbital',
    name: '轨道护卫',
    nameEn: 'Orbital Guard',
    desc: '环绕轨道体，接触造成伤害与强击退，转速决定攻速',
    color: '#7dffb0',
    element: 'kinetic',
    tier: 3,
    sound: 'smg',
    maxLevel: 4,
    base: { count: 2, damage: 10, radius: 3.2, spin: 2.6, cd: 0.45, knock: 6, size: 0.4 },
    levels: [{ count: 3 }, { damage: 14, radius: 3.8 }, { count: 4, damage: 18, spin: 3.4 }],
    evolve: { id: 'orbital_evolved', name: '卫星阵列', recipes: { quantum_core: 1 } },
  },
  {
    id: 'railgun',
    name: '狙击重炮',
    nameEn: 'Railgun',
    desc: '长充能贯穿光矛，命中后小范围爆炸并造成击退',
    color: '#ff5f6d',
    element: 'arc',
    tier: 3,
    sound: 'railgun',
    maxLevel: 4,
    base: { damage: 58, cd: 2.2, charge: 0.85, speed: 130, life: 0.9, range: 40, pierce: 99, radius: 2.6, knock: 12, size: 0.5 },
    levels: [{ damage: 78 }, { damage: 104, cd: 1.9 }, { damage: 138, radius: 3.6, cd: 1.6 }],
    evolve: { id: 'railgun_evolved', name: '歼星重锤', recipes: { void_core: 1 } },
  },
  {
    id: 'swarm',
    name: '蜂群飞弹',
    nameEn: 'Swarm Missiles',
    desc: '自动锁定追踪弹，最多同时在空并分散锁定最近目标',
    color: '#ffe066',
    element: 'fire',
    tier: 3,
    sound: 'swarm',
    maxLevel: 4,
    base: { damage: 20, cd: 1.0, count: 2, maxAir: 6, speed: 15, accel: 42, turn: 5.2, life: 3.2, radius: 2.0, knock: 4, size: 0.36 },
    levels: [{ count: 3 }, { damage: 28, maxAir: 8 }, { damage: 38, count: 4, cd: 0.85 }],
    evolve: { id: 'swarm_evolved', name: '饱和打击', recipes: { ember_core: 2 } },
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/** Resolve a weapon's stats at a given level. */
export function weaponStats(weapon, level) {
  const s = { ...weapon.base };
  for (let i = 0; i < level - 1 && i < weapon.levels.length; i++) {
    Object.assign(s, weapon.levels[i]);
  }
  return s;
}

export function canLevelUp(weapon, level) {
  return level < weapon.maxLevel;
}

/** Pure firing-pattern helpers (unit tested). */
export function coneOffsets(count, spread, rng) {
  const out = [];
  if (count === 1) return [0];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const base = (t - 0.5) * 2 * spread;
    out.push(base + (rng() - 0.5) * (spread / Math.max(2, count)));
  }
  return out;
}

export function nextTargetScore(airCount, maxAir) {
  return airCount >= maxAir;
}
