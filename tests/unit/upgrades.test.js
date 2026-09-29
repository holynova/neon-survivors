import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../../src/core/rng.js';
import { StatBlock } from '../../src/game/stats.js';
import { rollCards, buildCardPool, RECIPES } from '../../src/game/upgrades.js';
import { buildShop } from '../../src/game/shop.js';
import { CHARACTER_BY_ID } from '../../src/game/characters.js';
import { WEAPON_BY_ID, weaponStats } from '../../src/game/weaponDefs.js';
import { RARITY, XP } from '../../src/game/config.js';

/** Minimal player stand-in satisfying everything the card pool touches. */
function fakePlayer(charId = 'vanguard', weapons = [charId === 'vanguard' ? 'scatter' : 'smg']) {
  const char = CHARACTER_BY_ID[charId];
  const p = {
    character: char,
    stats: new StatBlock(),
    elementDmg: { fire: 1, frost: 1, arc: 1, kinetic: 1 },
    rules: { ...(char.rules ?? {}) },
    recipes: {},
    rerolls: 0,
    level: 1,
    gold: 200,
    hp: 80,
    maxHp: 100,
    abilityDurationBonus: 0,
    levelUps: [],
    weaponList: weapons,
    weapons: weapons.map((id, i) => ({
      def: WEAPON_BY_ID[id],
      level: 1,
      canEvolve(rec) {
        const r = this.def.evolve?.recipes;
        if (!r) return false;
        return Object.entries(r).every(([k, n]) => (rec[k] ?? 0) >= n);
      },
      upgrade() {
        this.level++;
        return true;
      },
      evolve() {
        return null;
      },
    })),
    addWeapon(id) {
      this.levelUps.push(`add:${id}`);
      return null;
    },
    removeWeapon() {},
    heal(v) {
      this.levelUps.push(`heal:${v}`);
    },
    onKill() {},
  };
  return p;
}

test('XP curve is strictly increasing', () => {
  let prev = 0;
  for (let l = 1; l <= XP.maxLevel; l++) {
    const n = XP.need(l);
    assert.ok(n > prev, `level ${l} needs ${n}, not more than ${prev}`);
    prev = n;
  }
});

test('XP gem values are ascending and cover a range', () => {
  for (let i = 1; i < XP.gemValue.length; i++) {
    assert.ok(XP.gemValue[i] > XP.gemValue[i - 1]);
  }
  assert.equal(XP.gemValue[0], 1);
});

test('card pool offers every unowned weapon', () => {
  const p = fakePlayer('vanguard', ['scatter']);
  const pool = buildCardPool(p, 1);
  const newWeapons = pool.filter((c) => c.tags.includes('new')).map((c) => c.id);
  assert.equal(newWeapons.length, 7, 'should offer the 7 unowned weapons');
  assert.ok(newWeapons.every((id) => id.startsWith('new_')));
});

test('card pool offers level-ups only for owned, non-maxed weapons', () => {
  const p = fakePlayer('vanguard', ['scatter']);
  p.weapons[0].level = 4; // maxed
  const pool = buildCardPool(p, 3);
  const lvls = pool.filter((c) => c.tags.includes('level')).map((c) => c.id);
  assert.equal(lvls.length, 0, 'maxed weapon must not offer a level-up');

  p.weapons[0].level = 2;
  const pool2 = buildCardPool(p, 3);
  assert.ok(pool2.some((c) => c.id === 'wpn_scatter_2'));
});

test('evolution cards only appear with enough materials', () => {
  const p = fakePlayer('engineer', ['smg']);
  let pool = buildCardPool(p, 5);
  assert.equal(pool.filter((c) => c.tags.includes('evolve')).length, 0, 'no materials, no evolve card');

  p.recipes.magnetic_core = 1;
  pool = buildCardPool(p, 5);
  const evo = pool.filter((c) => c.tags.includes('evolve'));
  assert.equal(evo.length, 1);
  assert.equal(evo[0].rarity, 'legendary');
});

test('character-exclusive cards only appear for that character', () => {
  const hunter = buildCardPool(fakePlayer('vanguard', ['scatter']), 2);
  assert.ok(hunter.some((c) => c.id.startsWith('excl_vanguard')));
  assert.equal(hunter.filter((c) => c.id.startsWith('excl_arcwelder')).length, 0);

  const welder = buildCardPool(fakePlayer('arcwelder', ['tesla']), 2);
  assert.ok(welder.some((c) => c.id.startsWith('excl_arcwelder')));
  assert.equal(welder.filter((c) => c.id.startsWith('excl_vanguard')).length, 0);
});

test('every card has valid metadata and a working apply', () => {
  for (const charId of Object.keys(CHARACTER_BY_ID)) {
    const p = fakePlayer(charId, [CHARACTER_BY_ID[charId].weapon]);
    const pool = buildCardPool(p, 6);
    assert.ok(pool.length > 10, `${charId} card pool too small`);
    for (const c of pool) {
      assert.ok(c.id && c.title && c.desc, `${charId}: card missing text (${c.id})`);
      assert.ok(c.icon, `${c.id} missing icon`);
      assert.ok(RARITY[c.rarity], `${c.id} has bad rarity ${c.rarity}`);
      assert.ok(typeof c.apply === 'function', `${c.id} missing apply`);
      assert.ok(c.weight > 0, `${c.id} has non-positive weight`);
    }
  }
});

test('rollCards returns distinct, valid, countable cards', () => {
  const p = fakePlayer('demolitionist', ['grenade']);
  const rng = new Rng(2024);
  for (let i = 0; i < 200; i++) {
    const cards = rollCards(p, 3, rng, { wave: 8 });
    assert.equal(cards.length, 3, 'always exactly 3');
    assert.equal(new Set(cards.map((c) => c.id)).size, 3, 'no duplicates');
    for (const c of cards) assert.ok(RARITY[c.rarity]);
  }
});

test('luck increases the share of rare+ cards', () => {
  const measure = (luck) => {
    const p = fakePlayer('vanguard', ['scatter']);
    for (let i = 0; i < 40; i++) p.stats.add({ key: 'luck', value: 0.1, mode: 'pct' });
    const target = luck ? p : fakePlayer('vanguard', ['scatter']);
    if (!luck) for (let i = 0; i < 40; i++) target.stats.add({ key: 'luck', value: -0.1, mode: 'pct' });
    const rng = new Rng(555);
    let high = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const cards = rollCards(target, 3, rng, { wave: 12 });
      for (const c of cards) if (c.rarity !== 'common') high++;
    }
    return high / (N * 3);
  };
  const unlucky = measure(false);
  const lucky = measure(true);
  assert.ok(lucky > unlucky, `lucky ${lucky} should beat unlucky ${unlucky}`);
  assert.ok(unlucky > 0.05, `baseline rare rate ${unlucky} looks broken`);
});

test('later waves surface higher rarities more often', () => {
  const rate = (wave) => {
    const p = fakePlayer('vanguard', ['scatter']);
    const rng = new Rng(999);
    let high = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      for (const c of rollCards(p, 3, rng, { wave })) if (c.rarity !== 'common') high++;
    }
    return high / (N * 3);
  };
  assert.ok(rate(15) > rate(1), 'wave 15 should skew richer than wave 1');
});

test('applying a passive card actually changes the stat block', () => {
  const p = fakePlayer('vanguard', ['scatter']);
  const before = p.stats.get('damage');
  const card = buildCardPool(p, 1).find((c) => c.id.startsWith('pass_damage'));
  card.apply(p);
  assert.ok(p.stats.get('damage') > before);
});

test('recipe cards add materials', () => {
  const p = fakePlayer('vanguard', ['scatter']);
  const pool = buildCardPool(p, 4);
  const recipes = pool.filter((c) => c.tags.includes('recipe'));
  assert.ok(recipes.length >= RECIPES.length, 'every material should be obtainable');
  for (const card of recipes) {
    card.apply(p);
    assert.equal(p.recipes[card.material], 1, `${card.material} not credited`);
  }
  assert.deepEqual(Object.keys(p.recipes).sort(), RECIPES.map((r) => r[0]).sort());
});

// -------------------------------------------------------------------- shop

test('shop builds priced, affordable slots', () => {
  const p = fakePlayer('vanguard', ['scatter']);
  const rng = new Rng(64);
  const items = buildShop(p, 3, rng, 4);
  assert.equal(items.length, 4);
  for (const it of items) {
    assert.ok(it.id && it.title && it.desc, 'missing metadata');
    assert.ok(it.price > 0, `${it.title} has no price`);
    assert.equal(it.sold, false);
    assert.ok(RARITY[it.rarity]);
  }
});

test('shop prices rise with wave number', () => {
  const p = fakePlayer('vanguard', ['scatter']);
  const at = (w) => buildShop(p, w, new Rng(5), 4).reduce((s, i) => s + i.price, 0);
  const early = at(1);
  const late = at(15);
  assert.ok(late > early, `wave 15 total ${late} should exceed wave 1 total ${early}`);
});

test('shop hides heal when already at full health', () => {
  const p = fakePlayer('vanguard', ['scatter']);
  p.hp = p.maxHp;
  for (let i = 0; i < 20; i++) {
    const items = buildShop(p, 3, new Rng(i), 4);
    assert.equal(items.filter((i) => i.title === '维修').length, 0);
  }
});

test('shop never exceeds the 6 weapon slot cap', () => {
  const all = ['scatter', 'smg', 'tesla', 'grenade', 'frost', 'orbital'];
  const p = fakePlayer('vanguard', all);
  for (let i = 0; i < 30; i++) {
    const items = buildShop(p, 4, new Rng(i), 4);
    assert.equal(items.filter((i) => i.kind === 'weapon').length, 0);
  }
});

test('shop items are unique types within one shop', () => {
  const p = fakePlayer('vanguard', ['scatter']);
  for (let i = 0; i < 60; i++) {
    const items = buildShop(p, 4, new Rng(i), 4);
    const nonRepeatable = items.filter((i) => i.kind !== 'reroll').map((i) => i.kind);
    assert.equal(new Set(nonRepeatable).size, nonRepeatable.length, 'duplicate shop offers');
  }
});

test('buying an upgrade shop item raises the weapon level', () => {
  const p = fakePlayer('vanguard', ['scatter']);
  const items = buildShop(p, 2, new Rng(11), 4);
  const up = items.find((i) => i.kind === 'upgrade');
  assert.ok(up, 'expected an upgrade offer');
  const before = p.weapons[0].level;
  up.apply(p, p);
  assert.equal(p.weapons[0].level, before + 1);
});

test('buying armor raises maxHp and heals by the same amount', () => {
  const p = fakePlayer('vanguard', ['scatter']);
  p.hp = 50;
  let armor = null;
  for (let seed = 0; seed < 50 && !armor; seed++) {
    armor = buildShop(p, 2, new Rng(seed), 4).find((i) => i.kind === 'maxhp') ?? null;
  }
  assert.ok(armor, 'armor should appear in some shop');
  const maxBefore = p.stats.get('maxHp');
  armor.apply(p, p);
  assert.equal(p.stats.get('maxHp'), maxBefore + 25);
  assert.equal(p.hp, 75);
});

test('weaponStats used by shop previews match live values', () => {
  const w = WEAPON_BY_ID.scatter;
  const s = weaponStats(w, 3);
  assert.ok(s.pellets >= 5);
  assert.ok(s.damage > w.base.damage);
});
