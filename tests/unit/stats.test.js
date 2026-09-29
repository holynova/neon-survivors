import test from 'node:test';
import assert from 'node:assert/strict';
import { StatBlock, computeDamage, falloff, BASE_STATS } from '../../src/game/stats.js';
import { WEAPON_BY_ID, weaponStats } from '../../src/game/weaponDefs.js';
import { CHARACTER_BY_ID } from '../../src/game/characters.js';
import { Rng } from '../../src/core/rng.js';

test('StatBlock starts at base values', () => {
  const s = new StatBlock();
  for (const k of Object.keys(BASE_STATS)) {
    assert.equal(s.get(k), BASE_STATS[k], `${k} should equal base`);
  }
});

test('flat and percent modifiers stack', () => {
  const s = new StatBlock();
  s.add({ key: 'moveSpeed', value: 0.5, mode: 'pct' });
  s.add({ key: 'moveSpeed', value: 0.25, mode: 'pct' });
  assert.ok(Math.abs(s.get('moveSpeed') - BASE_STATS.moveSpeed * 1.75) < 1e-9);

  const t = new StatBlock();
  t.add({ key: 'maxHp', value: 22, mode: 'flat' });
  t.add({ key: 'maxHp', value: 28, mode: 'flat' });
  assert.equal(t.get('maxHp'), 150);
});

test('cooldown is clamped so it cannot invert', () => {
  const s = new StatBlock();
  for (let i = 0; i < 40; i++) s.add({ key: 'cooldown', value: 0.2, mode: 'pct' });
  assert.ok(s.get('cooldown') >= 0.2);
});

test('dodge never exceeds 75%', () => {
  const s = new StatBlock();
  s.add({ key: 'dodge', value: 5, mode: 'pct' });
  assert.equal(s.get('dodge'), 0.75);
});

test('percent stats never go negative', () => {
  const s = new StatBlock();
  s.add({ key: 'damage', value: -10, mode: 'pct' });
  assert.equal(s.get('damage'), 0);
});

test('computeDamage applies crit and variance, floor at 1', () => {
  const rng = new Rng(3);
  // no variance, no crits
  const noCrit = computeDamage(100, { critChance: 0, rng: () => 0.5, variance: 0 });
  assert.equal(noCrit.damage, 100);
  assert.equal(noCrit.crit, false);

  // guaranteed crit
  const crit = computeDamage(100, {
    critChance: 1,
    critDamage: 2.5,
    rng: () => 0.5,
    variance: 0,
  });
  assert.equal(crit.crit, true);
  assert.equal(crit.damage, 250);

  // tiny base damage is floored at 1
  const tiny = computeDamage(0.01, { critChance: 0, rng: () => 0.5, variance: 0 });
  assert.equal(tiny.damage, 1);

  // crit chance respects the roll
  let crits = 0;
  for (let i = 0; i < 2000; i++) {
    if (computeDamage(10, { critChance: 0.25, rng: () => rng.next(), variance: 0 }).crit) crits++;
  }
  assert.ok(crits > 350 && crits < 650, `got ${crits}/2000 crits`);
});

test('variance stays within the configured band', () => {
  const r = new Rng(21);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 2000; i++) {
    const d = computeDamage(100, { critChance: 0, rng: () => r.next(), variance: 0.1 }).damage;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  assert.ok(min >= 89.9 && min <= 90.1, `min ${min}`);
  assert.ok(max <= 110.1 && max >= 109.9, `max ${max}`);
});

test('falloff is 1 at center and `floor` at the rim', () => {
  assert.equal(falloff(0, 5), 1);
  assert.ok(Math.abs(falloff(5, 5, 0.5) - 0.5) < 1e-9);
  assert.ok(Math.abs(falloff(2.5, 5, 0.5) - 0.75) < 1e-9);
  // beyond the radius, clamped to the floor
  assert.ok(Math.abs(falloff(20, 5, 0.5) - 0.5) < 1e-9);
});

test('StatBlock values are only reachable via get(), never as plain fields', () => {
  // Guards a real bug class: reading `stats.damage` returns undefined and
  // silently poisons every derived weapon stat with NaN.
  const s = new StatBlock();
  for (const k of Object.keys(BASE_STATS)) {
    assert.equal(s[k], undefined, `${k} must not be exposed as a field`);
    assert.equal(typeof s.get(k), 'number', `${k} must be reachable via get()`);
  }
});

test('weapon stat derivation stays finite for every weapon and character', () => {
  // Mirrors WeaponInstance.stats without needing a live player.
  for (const def of Object.values(WEAPON_BY_ID)) {
    for (const char of Object.values(CHARACTER_BY_ID)) {
      const st = new StatBlock();
      for (const [k, v] of Object.entries(char.stats)) st.add({ key: k, value: v, mode: 'pct' });
      for (let level = 1; level <= def.maxLevel; level++) {
        const s = weaponStats(def, level);
        const damage = st.get('damage');
        const attackSpeed = st.get('attackSpeed');
        const cooldown = st.get('cooldown');
        const area = st.get('area');
        const out = { ...s };
        if (out.damage != null) out.damage *= damage;
        if (out.cd) out.cd /= attackSpeed * cooldown;
        if (out.cooldown) out.cooldown /= attackSpeed * cooldown;
        if (out.spin) out.spin *= attackSpeed;
        if (out.radius) out.radius *= area;
        if (out.range) out.range *= area;
        if (out.cone) out.cone *= 1 + (area - 1) * 0.6;
        if (out.speed) out.speed *= st.get('projectileSpeed');
        for (const [k, v] of Object.entries(out)) {
          if (typeof v !== 'number') continue;
          assert.ok(Number.isFinite(v), `${char.id}/${def.id} Lv${level}: ${k} = ${v}`);
          if (['damage', 'cd', 'cooldown', 'speed', 'count', 'pellets'].includes(k)) {
            assert.ok(v > 0, `${char.id}/${def.id} Lv${level}: ${k} must stay positive, got ${v}`);
          }
        }
      }
    }
  }
});

test('snapshot exposes every base key', () => {
  const s = new StatBlock();
  s.add({ key: 'damage', value: 0.5, mode: 'pct' });
  const snap = s.snapshot();
  assert.deepEqual(Object.keys(snap).sort(), Object.keys(BASE_STATS).sort());
  assert.ok(Math.abs(snap.damage - 1.5) < 1e-9);
});
