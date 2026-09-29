import { WEAPONS, WEAPON_BY_ID } from './weaponDefs.js';
import { RECIPES } from './upgrades.js';
import { rollCards } from './upgrades.js';

export const SHOP_ITEMS = [
  {
    id: 'weapon',
    title: '武器',
    desc: '购买一件新武器',
    rarity: 'rare',
    icon: '⚔',
    price: [80, 150, 220, 300, 380],
    weight: 42,
    can: (p) => p.weapons.length < 6,
    make: (rng, ctx) => {
      const pool = WEAPONS.filter((w) => !ctx.owned.has(w.id));
      if (!pool.length) return null;
      const w = rng.pick(pool);
      return {
        title: w.name,
        desc: `${w.desc}\n可升级至 ${w.maxLevel} 级`,
        rarity: w.tier >= 3 ? 'epic' : w.tier === 2 ? 'rare' : 'common',
        apply: (p) => p.addWeapon(w.id),
      };
    },
  },
  {
    id: 'upgrade',
    title: '武器强化',
    desc: '将随机武器提升一级',
    rarity: 'common',
    icon: '⬆',
    price: [60, 110, 170, 240, 310],
    weight: 46,
    can: (p) => p.weapons.some((w) => w.level < w.def.maxLevel),
    make: (rng, ctx) => {
      const w = rng.pick(ctx.upgradable);
      return {
        title: `${w.def.name} Lv${w.level + 1}`,
        desc: '提升该武器等级',
        rarity: w.level >= 3 ? 'epic' : w.level === 2 ? 'rare' : 'common',
        apply: (p) => p.weapons.find((x) => x.def.id === w.def.id)?.upgrade(),
      };
    },
  },
  {
    id: 'heal',
    title: '修复',
    desc: '恢复 45% 最大生命',
    rarity: 'common',
    icon: '❤',
    price: [40, 50, 60, 70, 80],
    weight: 30,
    can: (p) => p.hp < p.maxHp,
    make: () => ({
      title: '维修',
      desc: '恢复 45% 最大生命',
      rarity: 'common',
      apply: (p) => p.heal(p.maxHp * 0.45),
    }),
  },
  {
    id: 'reroll',
    title: '重随卡牌',
    desc: '升级三选一时刷新选项',
    rarity: 'rare',
    icon: '↻',
    price: [30, 35, 40, 45, 50],
    weight: 24,
    repeatable: true,
    make: () => ({
      title: '重随',
      desc: '立即获得一次额外的卡牌刷新',
      rarity: 'rare',
      apply: (p, world) => {
        p.rerolls = (p.rerolls ?? 0) + 1;
      },
    }),
  },
  {
    id: 'maxhp',
    title: '强化装甲',
    desc: '最大生命 +25 并立即回满该数值',
    rarity: 'common',
    icon: '⛨',
    price: [70, 90, 110, 130, 150],
    weight: 28,
    make: () => ({
      title: '强化装甲',
      desc: '最大生命 +25',
      rarity: 'common',
      apply: (p) => {
        p.stats.add({ key: 'maxHp', value: 25, mode: 'flat' });
        p.maxHp = p.stats.get('maxHp');
        p.hp = Math.min(p.maxHp, p.hp + 25);
      },
    }),
  },
  {
    id: 'recipe',
    title: '进化材料',
    desc: '获得一件进化核心',
    rarity: 'epic',
    icon: '⬢',
    price: [120, 150, 180, 220, 260],
    weight: 22,
    make: (rng) => {
      const entry = rng.pick(RECIPES);
      const [k, name] = entry;
      return {
        title: name,
        material: k,
        desc: `获得进化材料「${name}」×1`,
        rarity: 'epic',
        apply: (p) => {
          p.recipes[k] = (p.recipes[k] ?? 0) + 1;
        },
      };
    },
  },
];

export function buildShop(player, wave, rng, slots = 4) {
  const owned = new Set(player.weapons.map((w) => w.def.id));
  const upgradable = player.weapons.filter((w) => w.level < w.def.maxLevel);
  const ctx = { owned, upgradable };
  const out = [];
  // each shop type may appear at most once per shop (except explicitly repeatable ones)
  const remaining = SHOP_ITEMS.filter((s) => (s.can ? s.can(player, wave, ctx) : true));
  const repeatableStock = 2;

  while (out.length < slots && remaining.length) {
    const def = rng.weighted(remaining, (s) => {
      const w = s.repeatable ? s.weight * 0.35 : s.weight;
      const used = out.filter((o) => o.kind === s.id).length;
      return w * (s.repeatable ? Math.max(0.15, repeatableStock - used) : used > 0 ? 0 : 1);
    });
    const made = def.make(rng, ctx);
    if (!made) {
      remaining.splice(remaining.indexOf(def), 1);
      continue;
    }
    const base = def.price[Math.min(def.price.length - 1, wave - 1)];
    out.push({
      ...made,
      // `make()` returns only the randomised parts; the icon and display name
      // live on the definition and must be carried over or the card renders
      // "undefined" as its glyph.
      icon: made.icon ?? def.icon,
      kind: def.id,
      id: `${def.id}_${out.length}`,
      price: Math.round(base * rng.range(0.9, 1.12)),
      sold: false,
    });
    if (!def.repeatable) remaining.splice(remaining.indexOf(def), 1);
  }
  return out;
}

export function rollLevelUpCards(player, wave, rng, count = 3) {
  return rollCards(player, count, rng, { wave });
}

export { WEAPON_BY_ID };
