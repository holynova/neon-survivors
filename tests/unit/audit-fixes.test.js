/**
 * Regression tests for the 2026-11 audit fixes (group D, #58).
 * Each test pins a bug that was silently live: a stat, rule or system the
 * game advertised but never applied.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../../src/game/player.js';
import { CHARACTER_BY_ID } from '../../src/game/characters.js';
import { PLAYER } from '../../src/game/config.js';
import { BASE_STATS, StatBlock } from '../../src/game/stats.js';
import { WEAPONS, WEAPON_BY_ID, EVOLVED_WEAPONS, weaponStats } from '../../src/game/weaponDefs.js';
import { WeaponInstance, updateWeapons } from '../../src/game/weapons.js';
import { buildCardPool } from '../../src/game/upgrades.js';
import { Input } from '../../src/core/input.js';
import { FX } from '../../src/fx/particles.js';

const fakeWorld = { scene: { add() {} } };
const mkPlayer = (id) => new Player(CHARACTER_BY_ID[id], fakeWorld);

test('starting HP is 120 everywhere (config, stats base, live player)', () => {
  assert.equal(PLAYER.maxHp, 120);
  assert.equal(BASE_STATS.maxHp, 120);
  assert.equal(mkPlayer('vanguard').maxHp, 120);
});

test('every character stat bonus is applied (not just 4 of 8 keys)', () => {
  const v = mkPlayer('vanguard');
  assert.ok(Math.abs(v.stats.get('pickupRange') - 2.2 * 1.12) < 1e-9, 'vanguard pickup');
  assert.ok(Math.abs(v.stats.get('critChance') - 0.08) < 1e-9, 'vanguard crit');

  const e = mkPlayer('engineer');
  assert.ok(Math.abs(e.stats.get('pickupRange') - 2.2 * 1.2) < 1e-9, 'engineer pickup');
  assert.ok(Math.abs(e.stats.get('attackSpeed') - 1.12) < 1e-9, 'engineer attack speed');

  const d = mkPlayer('demolitionist');
  assert.equal(d.maxHp, 135, 'demolitionist +15 HP');
  assert.ok(Math.abs(d.stats.get('damage') - 1.08) < 1e-9, 'demo damage');

  const c = mkPlayer('cryomancer');
  assert.ok(Math.abs(c.stats.get('dodge') - 0.04) < 1e-9, 'cryomancer dodge');
  assert.ok(Math.abs(c.stats.get('area') - 1.18) < 1e-9, 'cryomancer area');
});

test('ability cooldown divides by the cooldown stat (快速冷却 helps)', () => {
  const p = mkPlayer('vanguard');
  assert.equal(p.abilityCooldown, 9);
  p.stats.add({ key: 'cooldown', value: 0.09, mode: 'pct' });
  assert.ok(p.abilityCooldown < 9, `expected < 9s, got ${p.abilityCooldown}`);
  assert.ok(Math.abs(p.abilityCooldown - 9 / 1.09) < 1e-9);
});

test('体质强化 raises the actual health pool, not just the stat', () => {
  const p = {
    character: CHARACTER_BY_ID.vanguard,
    stats: new StatBlock(),
    elementDmg: { fire: 1, frost: 1, arc: 1, kinetic: 1 },
    rules: {},
    recipes: {},
    rerolls: 0,
    level: 1,
    gold: 0,
    hp: 80,
    maxHp: 120,
    abilityDurationBonus: 0,
    weapons: [{
      def: WEAPON_BY_ID.scatter, level: 1,
      canEvolve: () => false, upgrade() {}, evolve: () => null,
    }],
    addWeapon() {}, removeWeapon() {}, heal() {}, onKill() {},
  };
  const pool = buildCardPool(p, 3);
  const card = pool.find((c) => c.id.startsWith('pass_max_hp'));
  assert.ok(card, '体质强化 card exists');
  card.apply(p);
  assert.equal(p.stats.get('maxHp'), 142);
  assert.equal(p.maxHp, 142, 'p.maxHp must be synced or the card does nothing');
});

test('arcwelder extra bounces reach the tesla bolt', () => {
  const mkWorld = (rules) => {
    const captured = {};
    const fp = { alive: true, weapons: [], stats: new StatBlock(), rules };
    const w = new WeaponInstance('tesla', fp);
    fp.weapons = [w];
    return {
      captured,
      world: {
        player: fp,
        aimVector: () => ({ x: 1, z: 0 }),
        muzzlePosition: () => ({ x: 0, y: 1, z: 0 }),
        spawnBolt: (cfg) => { captured.bounces = cfg.bounces; return {}; },
        fx: { muzzleFlash() {} },
        juice: { addTrauma() {} },
        audio: { shot() {} },
      },
    };
  };
  const base = mkWorld({});
  updateWeapons(base.world, 1 / 60);
  assert.equal(base.captured.bounces, 4);

  const welder = mkWorld({ extraBounces: 2 });
  updateWeapons(welder.world, 1 / 60);
  assert.equal(welder.captured.bounces, 6, 'arcwelder +2 bounces');

  const stacked = mkWorld({ extraBounces: 4 });
  updateWeapons(stacked.world, 1 / 60);
  assert.equal(stacked.captured.bounces, 8, '+2 from 连锁过载 stacks');
});

test('railgun fires once per cooldown, not once per charge', () => {
  let fires = 0;
  const fp = { alive: true, weapons: [], stats: new StatBlock(), rules: {} };
  const w = new WeaponInstance('railgun', fp);
  fp.weapons = [w];
  const world = {
    player: fp,
    aimVector: () => ({ x: 1, z: 0 }),
    muzzlePosition: () => ({ x: 0, y: 1, z: 0 }),
    railgunFire: () => { fires++; },
    railgunChargeStart() {},
    fx: { muzzleFlash() {} },
    juice: { addTrauma() {} },
    audio: { shot() {} },
  };
  // 5s at 60fps: charge 0.85s + cd 2.2s => fires at ~0.85s and ~3.05s.
  for (let i = 0; i < 300; i++) updateWeapons(world, 1 / 60);
  assert.equal(fires, 2, `railgun fired ${fires}x in 5s (buggy: 5x)`);
});

test('orbital tick uses the derived cooldown once (no double division)', () => {
  let strikes = 0;
  const stats = new StatBlock();
  stats.add({ key: 'attackSpeed', value: 0.5, mode: 'pct' }); // 1.5x
  const fp = { alive: true, weapons: [], stats, rules: {} };
  const w = new WeaponInstance('orbital', fp);
  fp.weapons = [w];
  w.orbitalTick = 0;
  const world = { player: fp, orbitalStrike: () => { strikes++; } };
  updateWeapons(world, 1 / 60);
  assert.equal(strikes, 1);
  // stats.cd is already 0.45 / 1.5 = 0.3; dividing again would give 0.2.
  assert.ok(Math.abs(w.orbitalTick - 0.3) < 1e-9, `orbitalTick ${w.orbitalTick}`);
});

test('all 8 evolved weapons exist, beat base max level, and stay out of the new-weapon pool', () => {
  assert.equal(EVOLVED_WEAPONS.length, 8);
  for (const e of EVOLVED_WEAPONS) {
    assert.ok(WEAPON_BY_ID[e.id], `${e.id} resolvable`);
    assert.equal(e.maxLevel, 1, `${e.id} is a finished weapon`);
    assert.equal(e.levels.length, 0);
    const baseMax = weaponStats(WEAPON_BY_ID[e.baseId], WEAPON_BY_ID[e.baseId].maxLevel);
    const evo = weaponStats(e, 1);
    assert.ok(
      (evo.damage ?? 0) >= (baseMax.damage ?? 0),
      `${e.id} damage ${evo.damage} should beat base max ${baseMax.damage}`,
    );
    assert.ok(!WEAPONS.some((w) => w.id === e.id), `${e.id} must not be a base weapon`);
  }
  // every base weapon has an evolvable recipe now (scatter had none)
  for (const w of WEAPONS) {
    assert.ok(w.evolve?.recipes, `${w.id} has no evolve recipe`);
    assert.ok(WEAPON_BY_ID[w.evolve.id], `${w.id} evolve target missing`);
  }
});

test('evolve() swaps the weapon and consumes the recipe (no undefined def)', () => {
  const fp = {
    alive: true, weapons: [], stats: new StatBlock(), rules: {},
    removeWeapon(id) { this.weapons = this.weapons.filter((w) => w.def.id !== id); },
    addWeapon(w) { this.weapons.push(w); },
  };
  const smg = new WeaponInstance('smg', fp);
  smg.level = 3;
  fp.weapons = [smg];
  const recipes = { magnetic_core: 1 };
  assert.equal(smg.canEvolve(recipes), true);
  const next = smg.evolve(recipes);
  assert.ok(next, 'evolve returns the new weapon');
  assert.equal(next.def.id, 'smg_evolved');
  assert.equal(next.def.name, '脉冲加特林');
  assert.equal(next.level, 1);
  assert.equal(recipes.magnetic_core, 0, 'recipe consumed');
  assert.equal(fp.weapons.length, 1);
  assert.equal(fp.weapons[0].def.id, 'smg_evolved');
});

test('evolved weapons fire through their base pattern', () => {
  const fp = { alive: true, weapons: [], stats: new StatBlock(), rules: {} };
  const w = new WeaponInstance('tesla_evolved', fp);
  fp.weapons = [w];
  let bolt = null;
  let strikes = 0;
  const world = {
    player: fp,
    aimVector: () => ({ x: 1, z: 0 }),
    muzzlePosition: () => ({ x: 0, y: 1, z: 0 }),
    spawnBolt: (cfg) => { bolt = cfg; return {}; },
    orbitalStrike: () => { strikes++; },
    fx: { muzzleFlash() {} },
    juice: { addTrauma() {} },
    audio: { shot() {} },
  };
  updateWeapons(world, 1 / 60);
  assert.ok(bolt, 'evolved tesla fires');
  assert.equal(bolt.bounces, 8);

  const orb = new WeaponInstance('orbital_evolved', fp);
  fp.weapons = [orb];
  orb.orbitalTick = 0;
  updateWeapons(world, 1 / 60);
  assert.equal(strikes, 1, 'evolved orbital strikes');
});

test('evolved weapons offer no level-up cards', () => {
  const p = {
    character: CHARACTER_BY_ID.engineer,
    stats: new StatBlock(),
    elementDmg: { fire: 1, frost: 1, arc: 1, kinetic: 1 },
    rules: {},
    recipes: {},
    rerolls: 0,
    level: 5,
    gold: 0,
    hp: 100,
    maxHp: 120,
    abilityDurationBonus: 0,
    weapons: [{
      def: WEAPON_BY_ID.smg_evolved, level: 1,
      canEvolve: () => false, upgrade() {}, evolve: () => null,
    }],
    addWeapon() {}, removeWeapon() {}, heal() {}, onKill() {},
  };
  const pool = buildCardPool(p, 6);
  assert.equal(pool.filter((c) => c.tags.includes('level')).length, 0);
});

test('quality switch changes the live particle budget', () => {
  // ParticleSystem reads window.devicePixelRatio at construction.
  if (typeof globalThis.window === 'undefined') globalThis.window = { devicePixelRatio: 1 };
  const fx = new FX(new THREE.Scene(), 'high');
  const total = () => fx.all.reduce((n, s) => n + s.max, 0);
  assert.equal(total(), 24000);
  fx.setQuality('low');
  assert.equal(total(), 4016, 'low budget is 4000 (+256 floor on the ring system)');
  fx.setQuality('med');
  assert.equal(total(), 12000);
  fx.setQuality('high');
  assert.equal(total(), 24000, 'raising the cap again works');
});

test('touch joystick drives the input axis (node-safe, no constructor)', () => {
  const inp = Object.create(Input.prototype);
  inp.keys = new Set();
  inp.enabled = true;
  inp.touchMove = { x: 0, y: 0 };
  inp.touchDash = false;
  assert.deepEqual(inp.axis(), { x: 0, y: 0 });
  inp.touchMove = { x: 0.6, y: 0.8 };
  const a = inp.axis();
  assert.ok(Math.abs(a.x - 0.6) < 1e-9 && Math.abs(a.y - 0.8) < 1e-9);
  assert.equal(inp.dashing, false);
  inp.touchDash = true;
  assert.equal(inp.dashing, true);
});

test('cryomancer blurb matches the real frost slow (40%)', () => {
  assert.match(CHARACTER_BY_ID.cryomancer.blurb, /40%/);
  assert.doesNotMatch(CHARACTER_BY_ID.cryomancer.blurb, /45%/);
});

test('no middle dots in user-facing card, weapon or character text', () => {
  const bad = [];
  for (const w of [...WEAPONS, ...EVOLVED_WEAPONS]) {
    if (w.desc.includes('·')) bad.push(w.id);
  }
  for (const c of Object.values(CHARACTER_BY_ID)) {
    if (c.blurb.includes('·') || c.ability.desc.includes('·')) bad.push(c.id);
    const p = {
      character: c,
      stats: new StatBlock(),
      elementDmg: { fire: 1, frost: 1, arc: 1, kinetic: 1 },
      rules: { ...(c.rules ?? {}) },
      recipes: { magnetic_core: 1, arc_core: 1, ember_core: 2, frost_core: 1, quantum_core: 1, void_core: 1 },
      rerolls: 0, level: 5, gold: 0, hp: 100, maxHp: 120, abilityDurationBonus: 0,
      weapons: [{
        def: WEAPON_BY_ID[c.weapon], level: 2,
        canEvolve(rec) {
          const r = this.def.evolve?.recipes;
          if (!r) return false;
          return Object.entries(r).every(([k, n]) => (rec[k] ?? 0) >= n);
        },
        upgrade() {}, evolve: () => null,
      }],
      addWeapon() {}, removeWeapon() {}, heal() {}, onKill() {},
    };
    for (const card of buildCardPool(p, 6)) {
      if (card.title.includes('·') || card.desc.includes('·')) bad.push(`${c.id}:${card.id}`);
    }
  }
  assert.deepEqual(bad, []);
});
