import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEAPONS,
  WEAPON_BY_ID,
  weaponStats,
  canLevelUp,
  coneOffsets,
} from '../../src/game/weaponDefs.js';
import { CHARACTERS, CHARACTER_BY_ID } from '../../src/game/characters.js';
import { BASE_STATS } from '../../src/game/stats.js';
import { ENEMIES, BOSSES, enemyScale, poolForWave, bossForWave } from '../../src/game/enemyDefs.js';
import { wavePlan, isBossWave } from '../../src/game/spawner.js';
import { DIFFICULTIES, DIFFICULTY, WAVES } from '../../src/game/config.js';
import { Rng } from '../../src/core/rng.js';

// ------------------------------------------------------------------ weapons

test('every weapon has a complete definition', () => {
  assert.ok(WEAPONS.length >= 8, 'need at least 8 weapons');
  const ids = new Set();
  for (const w of WEAPONS) {
    assert.ok(w.id && w.name && w.desc && w.color, `${w.id} missing metadata`);
    assert.match(w.color, /^#[0-9a-f]{6}$/i);
    assert.ok(w.maxLevel >= 2, `${w.id} maxLevel too small`);
    assert.equal(w.levels.length, w.maxLevel - 1, `${w.id} level table mismatch`);
    assert.ok(w.base.damage != null || w.base.cd != null || w.base.count != null);
    assert.ok(!ids.has(w.id), `duplicate id ${w.id}`);
    ids.add(w.id);
  }
});

test('weaponStats strictly improves with level', () => {
  for (const w of WEAPONS) {
    const base = weaponStats(w, 1);
    for (let lvl = 2; lvl <= w.maxLevel; lvl++) {
      const s = weaponStats(w, lvl);
      const better =
        (s.damage ?? 0) > (base.damage ?? 0) ||
        (s.pellets ?? 0) > (base.pellets ?? 0) ||
        (s.count ?? 0) > (base.count ?? 0) ||
        (s.bounces ?? 0) > (base.bounces ?? 0) ||
        (s.pierce ?? 0) > (base.pierce ?? 0) ||
        (s.radius ?? 0) > (base.radius ?? 0) ||
        (s.slow ?? 0) > (base.slow ?? 0) ||
        (s.cone ?? 0) > (base.cone ?? 0) ||
        (s.range ?? 0) > (base.range ?? 0) ||
        (s.dps ? true : false) ||
        (s.cd ?? 99) < (base.cd ?? 99);
      assert.ok(better, `${w.id} Lv${lvl} is not stronger than Lv1`);
    }
  }
});

test('canLevelUp stops at maxLevel', () => {
  const w = WEAPON_BY_ID.scatter;
  for (let l = 1; l < w.maxLevel; l++) assert.equal(canLevelUp(w, l), true);
  assert.equal(canLevelUp(w, w.maxLevel), false);
  assert.equal(canLevelUp(w, w.maxLevel + 5), false);
});

test('coneOffsets produces a symmetric, bounded spread', () => {
  const rng = new Rng(3);
  const offs = coneOffsets(7, 0.4, () => rng.next());
  assert.equal(offs.length, 7);
  for (const o of offs) assert.ok(Math.abs(o) <= 0.4 + 1e-9);
  assert.ok(offs[0] < 0 && offs[offs.length - 1] > 0, 'spread must straddle the axis');
  assert.deepEqual(coneOffsets(1, 0.4, Math.random), [0]);
});

test('weapons are behaviourally distinct (no duplicate stat signatures)', () => {
  const sigs = new Set();
  for (const w of WEAPONS) {
    const s = weaponStats(w, w.maxLevel);
    const sig = JSON.stringify({
      pellets: s.pellets ?? 0,
      bounces: s.bounces ?? 0,
      explode: s.radius && s.fuse ? 'aoe' : 0,
      pierce: s.pierce ?? 0,
      cone: s.cone ? 'cone' : 0,
      orbit: s.spin ? 'orbit' : 0,
      charge: s.charge ? 'charge' : 0,
    });
    assert.ok(!sigs.has(sig), `${w.id} duplicates another weapon's pattern`);
    sigs.add(sig);
  }
});

// --------------------------------------------------------------- characters

test('every character is fully specified and unique', () => {
  assert.ok(CHARACTERS.length >= 5);
  const ids = new Set();
  const weapons = new Set();
  for (const c of CHARACTERS) {
    assert.ok(c.id && c.name && c.nameEn && c.blurb && c.tagline);
    assert.ok(WEAPON_BY_ID[c.weapon], `${c.id} starts with unknown weapon`);
    assert.ok(c.ability?.name && c.ability?.desc, `${c.id} missing ability`);
    assert.ok(Array.isArray(c.exclusiveCards) && c.exclusiveCards.length >= 2, `${c.id} needs 2+ exclusives`);
    for (const x of c.exclusiveCards) {
      assert.ok(x.id && x.title && x.desc && typeof x.apply === 'function');
    }
    assert.ok(!ids.has(c.id));
    ids.add(c.id);
    weapons.add(c.weapon);
  }
  assert.equal(weapons.size, CHARACTERS.length, 'each character should start with a unique weapon');
});

// maxHp/armor are absolute values, everything else is a fraction.
const FLAT_CHAR_STATS = new Set(['maxHp', 'armor']);

test('character stat bonuses are sane', () => {
  for (const c of CHARACTERS) {
    assert.ok(Object.keys(c.stats).length >= 1, `${c.id} has no stat bonus`);
    for (const [k, v] of Object.entries(c.stats)) {
      assert.ok(k in BASE_STATS, `${c.id}.${k} is not a known stat`);
      if (FLAT_CHAR_STATS.has(k)) {
        assert.ok(v > -BASE_STATS[k] && v <= BASE_STATS[k] * 0.5, `${c.id}.${k} = ${v} out of range`);
      } else {
        assert.ok(v > -0.5 && v <= 0.5, `${c.id}.${k} = ${v} out of range`);
      }
    }
    // character rules must actually differ from the baseline
    assert.ok(c.rules && Object.keys(c.rules).length >= 1, `${c.id} has no rule modifier`);
  }
});

test('characters do not all share the same stat profile', () => {
  const profiles = CHARACTERS.map((c) => JSON.stringify(c.stats));
  assert.equal(new Set(profiles).size, CHARACTERS.length, `duplicate stat profiles: ${profiles}`);
  const rules = CHARACTERS.map((c) => JSON.stringify(c.rules));
  assert.equal(new Set(rules).size, CHARACTERS.length, `duplicate rule sets: ${rules}`);
});

// ------------------------------------------------------------------ enemies

test('every enemy is well formed', () => {
  for (const e of Object.values(ENEMIES)) {
    assert.ok(e.id && e.name && e.shape && e.behavior, `${e.id} incomplete`);
    assert.ok(e.hp > 0 && e.speed > 0 && e.damage > 0 && e.radius > 0);
    assert.ok(e.xp > 0);
    assert.equal(e.gold.length, 2);
    assert.ok(e.gold[0] <= e.gold[1]);
    assert.ok(e.unlockWave >= 1);
    assert.ok(BEHAVIORS.has(e.behavior), `${e.id} unknown behavior ${e.behavior}`);
  }
});

const BEHAVIORS = new Set([
  'chase', 'charger', 'ranged', 'dasher', 'orbit',
  'boss_ring', 'boss_frost', 'boss_void',
]);

test('bosses are tougher than any regular enemy', () => {
  const maxHp = Math.max(...Object.values(ENEMIES).map((e) => e.hp));
  for (const b of Object.values(BOSSES)) {
    assert.ok(b.hp > maxHp, `${b.id} hp should exceed ${maxHp}`);
    assert.ok(b.radius > 1.8, `${b.id} should be large`);
    assert.ok(b.boss === true);
    assert.ok(b.xp >= 50);
  }
});

test('enemy scaling is monotonic across waves', () => {
  let prev = null;
  for (let w = 1; w <= WAVES.total; w++) {
    const s = enemyScale(w, DIFFICULTY);
    if (prev) {
      assert.ok(s.hp >= prev.hp, `hp must not drop at wave ${w}`);
      assert.ok(s.damage >= prev.damage, `damage must not drop at wave ${w}`);
    }
    prev = s;
  }
});

test('difficulty scales hp/damage in the right direction', () => {
  const easy = enemyScale(10, DIFFICULTIES.easy);
  const hard = enemyScale(10, DIFFICULTIES.hard);
  const night = enemyScale(10, DIFFICULTIES.nightmare);
  assert.ok(easy.hp < hard.hp && hard.hp < night.hp);
  assert.ok(easy.damage < hard.damage && hard.damage < night.damage);
});

test('unlock gating: early waves only have starters', () => {
  const w1 = poolForWave(1).map((e) => e.id);
  assert.deepEqual(w1, ['grunt']);
  const w20 = poolForWave(20).map((e) => e.id);
  assert.equal(w20.length, Object.keys(ENEMIES).length);
});

// ------------------------------------------------------------------- waves

test('boss waves are every 5 and map to an escalating boss', () => {
  for (let w = 1; w <= WAVES.total; w++) {
    assert.equal(isBossWave(w), w % 5 === 0, `wave ${w}`);
  }
  assert.equal(bossForWave(5).id, 'colossus');
  assert.equal(bossForWave(10).id, 'hierophant');
  assert.equal(bossForWave(15).id, 'devourer');
  assert.equal(bossForWave(20).id, 'devourer');
  assert.equal(bossForWave(3), null);
});

test('wavePlan grows in size and only uses unlocked enemies', () => {
  const rng = new Rng(7);
  let prevBudget = null;
  for (let w = 1; w <= WAVES.total; w++) {
    const plan = wavePlan(w, DIFFICULTY, rng);
      // A wave must contain enough bodies that minDuration is a real wait,
      // not dead air, and few enough that it can actually be cleared.
      assert.ok(
        plan.roster.length >= 8,
        `wave ${w} has only ${plan.roster.length} enemies; that is dead air`,
      );
    assert.ok(plan.roster.length > 0, `wave ${w} empty`);
    for (const id of plan.roster) {
      assert.ok(ENEMIES[id], `unknown enemy ${id}`);
      assert.ok(ENEMIES[id].unlockWave <= w, `${id} spawned before unlock at wave ${w}`);
    }
    assert.equal(plan.isBoss, isBossWave(w));
    assert.equal(plan.duration, plan.isBoss ? WAVES.bossDuration : WAVES.duration);
    // the spawn budget grows strictly every wave
    if (prevBudget != null) {
      assert.ok(plan.budget > prevBudget, `budget must grow at wave ${w}`);
    }
    prevBudget = plan.budget;
    // and the roster fills most of that budget (enemy costs are 1..5)
    assert.ok(
      plan.roster.length >= plan.budget / 5 - 1,
      `wave ${w} roster ${plan.roster.length} too small for budget ${plan.budget}`,
    );
  }
});

test('wavePlan is deterministic for a given rng seed', () => {
  const a = wavePlan(9, DIFFICULTY, new Rng(1234));
  const b = wavePlan(9, DIFFICULTY, new Rng(1234));
  assert.deepEqual(a.roster, b.roster);
  const c = wavePlan(9, DIFFICULTY, new Rng(4321));
  assert.notDeepEqual(a.roster, c.roster, 'different seeds should diverge');
});

test('later waves introduce more variety than wave 1', () => {
  const rng = new Rng(31);
  const seen = new Set(wavePlan(1, DIFFICULTY, rng).roster);
  const lateRng = new Rng(31);
  for (let w = 2; w <= 10; w++) for (const id of wavePlan(w, DIFFICULTY, lateRng).roster) seen.add(id);
  assert.ok(seen.size >= 6, `expected 6+ distinct types over waves 1-10, got ${seen.size}`);
});

test('harder difficulty produces bigger waves', () => {
  const easy = wavePlan(8, DIFFICULTIES.easy);
  const hard = wavePlan(8, DIFFICULTIES.hard);
  assert.ok(hard.budget > easy.budget);
});

// ------------------------------------------------------------ fx budgets

/**
 * Additive particle sprites saturate to a flat white blob when enough of them
 * overlap. The Frost Lance originally emitted 3 puffs x 6 motes = 18 additive
 * particles per shot at 12 shots/s (~216/sec), which blew out the middle of the
 * screen and hid the player — it read as the weapon "firing infinitely".
 *
 * The per-shot budget now lives in the weapon definition, so this test can hold
 * the line without a browser. See fxConeBudget() below.
 */
function fxConeBudget(weapon, level = 1) {
  const s = weaponStats(weapon, level);
  const shotsPerSec = s.cd ? 1 / s.cd : 0;
  const fx = s.fx;
  if (!fx) return { shotsPerSec, perShot: 0, perSec: 0, decalsPerSec: 0 };
  return {
    shotsPerSec,
    perShot: fx.puffs * fx.motes,
    perSec: fx.puffs * fx.motes * shotsPerSec,
    decalsPerSec: fx.puffs * fx.decal * shotsPerSec,
  };
}

test('the frost lance declares an explicit per-shot fx budget', () => {
  const frost = WEAPON_BY_ID.frost;
  const fx = frost.base.fx;
  assert.ok(fx, 'frost must declare an fx budget');
  assert.ok(fx.puffs >= 1 && fx.puffs <= 6, `puffs out of range: ${fx.puffs}`);
  assert.ok(fx.motes >= 1 && fx.motes <= 3, `motes out of range: ${fx.motes}`);
  for (const k of ['trail', 'decal']) {
    assert.ok(fx[k] >= 0 && fx[k] <= 1, `${k} must be a probability: ${fx[k]}`);
  }
});

test('no weapon emits an unbounded stream of additive particles', () => {
  // ~60 additive sprites/sec is already a dense but readable effect. The old
  // frost budget was ~216/sec; anything past this reads as a screen-wide flash.
  const BUDGET_PER_SEC = 60;
  for (const w of WEAPONS) {
    const b = fxConeBudget(w, 4);
    assert.ok(
      b.perSec <= BUDGET_PER_SEC,
      `${w.id} emits ~${b.perSec.toFixed(0)} additive particles/sec (budget ${BUDGET_PER_SEC})`,
    );
    assert.ok(
      b.decalsPerSec <= 8,
      `${w.id} spawns ~${b.decalsPerSec.toFixed(1)} ground decals/sec`,
    );
  }
});

test('the frost budget stays within limits at every level', () => {
  const frost = WEAPON_BY_ID.frost;
  for (let lvl = 1; lvl <= frost.maxLevel; lvl++) {
    const b = fxConeBudget(frost, lvl);
    assert.ok(b.perSec <= 60, `level ${lvl} emits ~${b.perSec.toFixed(0)}/sec`);
    // The budget must not scale with level — only damage/range should.
    assert.equal(b.perShot, fxConeBudget(frost, 1).perShot, `level ${lvl} changed the particle count`);
  }
});
