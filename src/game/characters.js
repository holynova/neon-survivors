/**
 * Playable characters. Each changes *rules*, not just numbers.
 */

export const CHARACTERS = [
  {
    id: 'vanguard',
    name: '猎人',
    nameEn: 'Vanguard',
    weapon: 'scatter',
    tagline: '均衡、易上手的近身猎手',
    color: '#ffb13b',
    shape: 'hunter',
    difficulty: 1,
    blurb: '霰弹枪在近距离拥有最高的瞬时爆发。击杀有概率额外掉落金币。',
    stats: { moveSpeed: 0.14, pickupRange: 0.12, critChance: 0.03 },
    rules: { killCoinChance: 0.15 },
    ability: {
      name: '过载冲锋',
      desc: '3 秒内移速 +80%、攻速 +60%',
      duration: 3,
      mods: { moveSpeed: 0.8, attackSpeed: 0.6 },
    },
    exclusiveCards: [
      {
        id: 'coin',
        title: '赏金直觉',
        desc: '击杀额外掉落金币概率翻倍至 30%',
        rarity: 'rare',
        apply: (p) => {
          p.rules.killCoinChance = 0.3;
        },
      },
      {
        id: 'overload',
        title: '双重过载',
        desc: '主动技能持续时间 +1.5 秒',
        rarity: 'rare',
        apply: (p) => {
          p.abilityDurationBonus += 1.5;
        },
      },
    ],
  },
  {
    id: 'engineer',
    name: '工程师',
    nameEn: 'Engineer',
    weapon: 'smg',
    tagline: '用自动化铺满战场',
    color: '#41b8ff',
    shape: 'engineer',
    difficulty: 2,
    blurb: '每 5 次击杀召唤一架自动索敌无人机。主动部署治疗信标。',
    stats: { attackSpeed: 0.12, moveSpeed: 0.06, pickupRange: 0.2 },
    rules: { dronePerKills: 5, droneMax: 4 },
    ability: {
      name: '部署信标',
      desc: '原地部署治疗信标，持续 6 秒',
      duration: 6,
      beacon: true,
    },
    exclusiveCards: [
      {
        id: 'drone',
        title: '无人机改进',
        desc: '召唤间隔 5 杀 → 3 杀',
        rarity: 'rare',
        apply: (p) => {
          p.rules.dronePerKills = 3;
        },
      },
      {
        id: 'beacon',
        title: '强化信标',
        desc: '治疗信标治疗量 +80%',
        rarity: 'rare',
        apply: (p) => {
          p.rules.beaconPower = (p.rules.beaconPower ?? 1) * 1.8;
        },
      },
    ],
  },
  {
    id: 'demolitionist',
    name: '爆破手',
    nameEn: 'Demolitionist',
    weapon: 'grenade',
    tagline: '范围伤害与清群',
    color: '#ff7a3b',
    shape: 'demo',
    difficulty: 2,
    blurb: '所有爆炸半径 +35%；爆炸击杀额外 +30% 经验。',
    stats: { damage: 0.08, area: 0.08, moveSpeed: -0.05, maxHp: 15 },
    rules: { blastRadius: 1.35, blastXp: 0.3 },
    ability: {
      name: '集束装药',
      desc: '向瞄准方向连发 5 枚集束炸弹',
      duration: 0.6,
      barrage: 5,
    },
    exclusiveCards: [
      {
        id: 'radius',
        title: '扩张爆破',
        desc: '爆炸半径额外 +25%',
        rarity: 'rare',
        apply: (p) => {
          p.rules.blastRadius *= 1.25;
        },
      },
      {
        id: 'fuse',
        title: '瞬发引信',
        desc: '爆炸伤害 +22%',
        rarity: 'rare',
        apply: (p) => {
          p.stats.add({ key: 'damage', value: 0.22, mode: 'pct' });
        },
      },
    ],
  },
  {
    id: 'arcwelder',
    name: '电刑者',
    nameEn: 'Arcwelder',
    weapon: 'tesla',
    tagline: '连锁与控场',
    color: '#a97bff',
    shape: 'welder',
    difficulty: 3,
    blurb: '弹跳次数 +2，命中附加麻痹。主动：全场敌人感电。',
    stats: { area: 0.12, attackSpeed: 0.08, moveSpeed: -0.03 },
    rules: { extraBounces: 2 },
    ability: {
      name: '电网过载',
      desc: '全场敌人感电 2.5 秒，持续伤害并麻痹',
      duration: 2.5,
      globalShock: true,
    },
    exclusiveCards: [
      {
        id: 'bounce',
        title: '连锁过载',
        desc: '弹跳次数额外 +2',
        rarity: 'epic',
        apply: (p) => {
          p.rules.extraBounces += 2;
        },
      },
      {
        id: 'stun',
        title: '高压麻痹',
        desc: '麻痹时间 +60%',
        rarity: 'rare',
        apply: (p) => {
          p.rules.stunMul = (p.rules.stunMul ?? 1) * 1.6;
        },
      },
    ],
  },
  {
    id: 'cryomancer',
    name: '霜蚀者',
    nameEn: 'Cryomancer',
    weapon: 'frost',
    tagline: '减速与风筝',
    color: '#6fe3ff',
    shape: 'cryo',
    difficulty: 3,
    blurb: '命中使敌人减速 45%，自身留下冰霜轨迹。主动：范围冻结。',
    stats: { area: 0.18, moveSpeed: 0.1, dodge: 0.04 },
    rules: { frostTrail: true },
    ability: {
      name: '绝对零度',
      desc: '半径 12 范围冻结敌人 3 秒',
      duration: 3,
      freezeRadius: 12,
    },
    exclusiveCards: [
      {
        id: 'trail',
        title: '极寒之路',
        desc: '冰霜轨迹半径与减速效果提升',
        rarity: 'rare',
        apply: (p) => {
          p.rules.trailPower = (p.rules.trailPower ?? 1) * 1.6;
        },
      },
      {
        id: 'chill',
        title: '深度冰封',
        desc: '冰霜伤害 +30%、减速 +10%',
        rarity: 'rare',
        apply: (p) => {
          p.elementDmg.frost += 0.3;
          p.rules.extraSlow = (p.rules.extraSlow ?? 0) + 0.1;
        },
      },
    ],
  },
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

export function characterStartWeapon(def) {
  return def.weapon;
}
