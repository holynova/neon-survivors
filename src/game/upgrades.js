import { RARITY, XP, PLAYER } from './config.js';
import { WEAPONS, WEAPON_BY_ID, weaponStats } from './weaponDefs.js';
import { ENEMIES } from './enemyDefs.js';

let uid = 1;
const nextId = () => uid++;

export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

/**
 * All upgrade cards. Each entry is a factory producing a concrete card object.
 * `apply(player, world)` mutates the player.
 */

function card({ id, title, desc, rarity = 'common', icon = '◆', apply, weight = 100, tags = [], repeatable = true, material = null }) {
  return { id, title, desc, rarity, icon, apply, weight, tags, repeatable, material };
}

const PASSIVES = [
  ['max_hp', '体质强化', '最大生命 +22', (p) => p.stats.add({ key: 'maxHp', value: 22, mode: 'flat' })],
  ['move_speed', '神经加速', '移动速度 +9%', (p) => p.stats.add({ key: 'moveSpeed', value: 0.09, mode: 'pct' })],
  ['damage', '弹药改良', '全局伤害 +11%', (p) => p.stats.add({ key: 'damage', value: 0.11, mode: 'pct' })],
  ['attack_speed', '快速扳机', '攻击速度 +10%', (p) => p.stats.add({ key: 'attackSpeed', value: 0.1, mode: 'pct' })],
  ['area', '扩展弹道', '范围/作用面积 +12%', (p) => p.stats.add({ key: 'area', value: 0.12, mode: 'pct' })],
  ['crit_chance', '精准瞄具', '暴击率 +6%', (p) => p.stats.add({ key: 'critChance', value: 0.06, mode: 'pct' })],
  ['crit_damage', '破坏要害', '暴击伤害 +30%', (p) => p.stats.add({ key: 'critDamage', value: 0.3, mode: 'pct' })],
  ['pickup', '磁力线圈', '拾取范围 +28%', (p) => p.stats.add({ key: 'pickupRange', value: 0.28, mode: 'pct' })],
  ['armor', '复合装甲', '受伤减免 +3', (p) => p.stats.add({ key: 'armor', value: 3, mode: 'flat' })],
  ['regen', '纳米修复', '每秒恢复 +0.7 生命', (p) => p.stats.add({ key: 'hpRegen', value: 0.7, mode: 'flat' })],
  ['projectile_speed', '高压弹头', '弹速 +18%', (p) => p.stats.add({ key: 'projectileSpeed', value: 0.18, mode: 'pct' })],
  ['luck', '战利品嗅觉', '幸运 +15%（影响掉落与卡牌稀有度）', (p) => p.stats.add({ key: 'luck', value: 0.15, mode: 'pct' })],
  ['xp_gain', '经验增幅', '经验获取 +14%', (p) => p.stats.add({ key: 'xpGain', value: 0.14, mode: 'pct' })],
  ['gold_gain', '贪婪', '金币获取 +18%', (p) => p.stats.add({ key: 'goldGain', value: 0.18, mode: 'pct' })],
  ['lifesteal', '吸血符文', '造成伤害的 1.2% 转化为治疗', (p) => p.stats.add({ key: 'lifesteal', value: 0.012, mode: 'flat' })],
  ['dodge', '相位闪避', '闪避率 +6%', (p) => p.stats.add({ key: 'dodge', value: 0.06, mode: 'pct' })],
  ['magnet', '加速磁吸', '磁吸速度 +40%', (p) => p.stats.add({ key: 'magnetSpeed', value: 0.4, mode: 'pct' })],
  ['cooldown', '快速冷却', '冷却缩减 +9%', (p) => p.stats.add({ key: 'cooldown', value: 0.09, mode: 'pct' })],
  ['thorns', '荆棘力场', '受击反弹 30% 伤害', (p) => p.stats.add({ key: 'thorns', value: 0.3, mode: 'flat' })],
];

const ELEMENT_PASSIVES = [
  ['burn', '燃烧领域', '火焰伤害 +26%', (p) => p.elementDmg.fire += 0.26],
  ['chill', '极寒印记', '冰霜伤害 +26%', (p) => p.elementDmg.frost += 0.26],
  ['shock', '过载电容', '感电伤害 +26%', (p) => p.elementDmg.arc += 0.26],
  ['kinetic', '动能强化', '动能伤害 +20%', (p) => p.elementDmg.kinetic += 0.2],
  ['crit_up', '致命节奏', '暴击伤害 +18%、暴击率 +3%', (p) => {
    p.stats.add({ key: 'critDamage', value: 0.18, mode: 'pct' });
    p.stats.add({ key: 'critChance', value: 0.03, mode: 'pct' });
  }],
];

export function buildCardPool(player, wave) {
  const cards = [];
  const owned = new Set(player.weapons.map((w) => w.def.id));

  // new weapons
  for (const w of WEAPONS) {
    if (owned.has(w.id)) continue;
    cards.push(
      card({
        id: `new_${w.id}`,
        title: w.name,
        desc: `${w.desc}\n【稀有度 ${w.tier}】${w.maxLevel} 级上限`,
        rarity: w.tier >= 3 ? 'epic' : w.tier === 2 ? 'rare' : 'common',
        icon: '⚔',
        weight: 70,
        tags: ['weapon', 'new'],
        apply: (p) => p.addWeapon(w.id),
      }),
    );
  }

  // weapon level ups
  for (const inst of player.weapons) {
    if (inst.level < inst.def.maxLevel) {
      const preview = weaponStats(inst.def, inst.level + 1);
      cards.push(
        card({
          id: `wpn_${inst.def.id}_${inst.level}`,
          title: `${inst.def.name} Lv${inst.level + 1}`,
          desc: inst.def.id === 'scatter'
            ? `弹丸 ${preview.pellets} 发 · 伤害 ${Math.round(preview.damage)}`
            : inst.def.id === 'grenade'
              ? `伤害 ${Math.round(preview.damage)} · 爆炸半径 ${preview.radius?.toFixed(1)}`
              : inst.def.id === 'tesla'
                ? `伤害 ${Math.round(preview.damage)} · 弹跳 ${preview.bounces} 次`
                : inst.def.id === 'orbital'
                  ? `轨道体 ${preview.count} 颗 · 伤害 ${Math.round(preview.damage)}`
                  : `伤害 ${Math.round(preview.damage ?? 0)} · 冷却 ${(preview.cd ?? 0).toFixed(2)}s`,
          rarity: inst.level >= 3 ? 'epic' : inst.level === 2 ? 'rare' : 'common',
          icon: '⬆',
          weight: 110,
          tags: ['weapon', 'level'],
          apply: (p) => {
            const t = p.weapons.find((x) => x.def.id === inst.def.id);
            t?.upgrade();
          },
        }),
      );
    }
    // evolve
    if (inst.canEvolve(player.recipes)) {
      cards.push(
        card({
          id: `evo_${inst.def.id}`,
          title: `进化：${inst.def.evolve.name}`,
          desc: `将 ${inst.def.name} 进化为传说武器\n伤害与机制全面强化`,
          rarity: 'legendary',
          icon: '★',
          weight: 46,
          tags: ['weapon', 'evolve'],
          apply: (p) => p.weapons.find((x) => x.def.id === inst.def.id)?.evolve(p.recipes),
        }),
      );
    }
  }

  for (const [id, title, desc, apply] of PASSIVES) {
    cards.push(
      card({
        id: `pass_${id}_${nextId()}`,
        title,
        desc,
        rarity: 'common',
        icon: '✦',
        weight: 92,
        tags: ['passive'],
        apply,
      }),
    );
  }
  for (const [id, title, desc, apply] of ELEMENT_PASSIVES) {
    cards.push(
      card({
        id: `elem_${id}_${nextId()}`,
        title,
        desc,
        rarity: 'rare',
        icon: '◈',
        weight: 54,
        tags: ['element'],
        apply,
      }),
    );
  }

  // character-exclusive
  for (const c of player.character.exclusiveCards ?? []) {
    cards.push(
      card({
        id: `excl_${player.character.id}_${c.id}_${nextId()}`,
        title: c.title,
        desc: c.desc,
        rarity: c.rarity ?? 'rare',
        icon: '❖',
        weight: 62,
        tags: ['exclusive'],
        apply: c.apply,
      }),
    );
  }

  // consumables
  cards.push(
    card({
      id: `heal_${nextId()}`,
      title: '应急医疗包',
      desc: '立即恢复 45 点生命',
      rarity: 'common',
      icon: '❤',
      weight: 30,
      tags: ['heal'],
      apply: (p) => p.heal(45),
    }),
  );
  cards.push(
    card({
      id: `gold_${nextId()}`,
      title: '战利品',
      desc: '获得 60 金币',
      rarity: 'common',
      icon: '◉',
      weight: 30,
      tags: ['gold'],
      apply: (p, world) => world?.addGold(60),
    }),
  );

  // evolution materials
  for (const [key, name, rarity] of RECIPES) {
    cards.push(
      card({
        id: `recipe_${key}_${nextId()}`,
        title: name,
        desc: `获得进化材料「${name}」×1\n集齐后可在升级卡中进化武器`,
        rarity,
        icon: '⬢',
        weight: 42,
        tags: ['recipe', `recipe:${key}`],
        material: key,
        apply: (p) => {
          p.recipes[key] = (p.recipes[key] ?? 0) + 1;
        },
      }),
    );
  }

  return cards;
}

export const RECIPES = [
  ['magnetic_core', '电磁核心', 'rare'],
  ['arc_core', '电弧核心', 'rare'],
  ['ember_core', '余烬核心', 'rare'],
  ['frost_core', '霜结核心', 'rare'],
  ['quantum_core', '量子核心', 'epic'],
  ['void_core', '虚空核心', 'epic'],
];

/** Pick `count` distinct cards, rarity-weighted & luck-biased. */
export function rollCards(player, count, rng, opts = {}) {
  const wave = opts.wave ?? 1;
  const pool = buildCardPool(player, wave);
  if (!pool.length) return [];
  const luck = player.stats.get('luck');
  const luckBias = 1 + (luck - 1) * 0.6;
  const out = [];
  const used = new Set();
  let guard = 0;
  while (out.length < count && guard++ < 300) {
    const c = rng.weighted(pool, (x) => {
      if (used.has(x.id)) return 0;
      const base = x.weight;
      // wave scaling pushes epic/legendary up a bit
      const rBoost = 1 + Math.min(1.2, (wave - 1) * 0.035) * (RARITY[x.rarity].mult - 1);
      let w = base * rBoost;
      if (x.rarity !== 'common') w *= Math.max(0.6, luckBias);
      // slight bias toward upgrading what you already have
      if (x.tags.includes('level')) w *= 1 + Math.min(0.4, player.weapons.length * 0.06);
      return Math.max(0.01, w);
    });
    if (!c) break;
    used.add(c.id);
    out.push(c);
  }
  return out;
}

export { card, nextId };
