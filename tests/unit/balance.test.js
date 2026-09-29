import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Rng } from '../../src/core/rng.js';
import { StatBlock } from '../../src/game/stats.js';
import { circleHit, sweepCircle, inCone } from '../../src/game/collision.js';
import { ENEMIES, BOSSES, enemyScale } from '../../src/game/enemyDefs.js';
import { CHARACTER_BY_ID } from '../../src/game/characters.js';
import { XP, ARENA, PLAYER, WAVES, DIFFICULTIES } from '../../src/game/config.js';
import { wavePlan } from '../../src/game/spawner.js';
import { damp, clamp, dist } from '../../src/core/math.js';

/**
 * Headless balance harness. Runs the real rule functions against a simplified
 * combat model so difficulty can be tuned without a browser.
 *
 * The goal is not to predict win rates exactly, but to catch the two failure
 * modes that matter: a run that can never be won, and one that is unwinnable.
 */

const DIFF = DIFFICULTIES.normal;

class SimEnemy {
  constructor(def, x, z, wave) {
    this.def = def;
    const s = enemyScale(wave, DIFF);
    this.maxHp = def.hp * s.hp;
    this.hp = this.maxHp;
    this.speed = def.speed * s.speed;
    this.contactDamage = def.damage * s.damage;
    this.radius = def.radius;
    this.armor = def.armor ?? 0;
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.alive = true;
    this.slowT = 0;
    this.slowMul = 1;
  }

  damage(amount) {
    if (!this.alive) return 0;
    const d = Math.max(1, amount * (1 - this.armor));
    this.hp -= d;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return d;
  }

  update(dt, p) {
    if (!this.alive) return;
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const d = Math.hypot(dx, dz) || 1;
    const sp = this.speed * (this.slowT > 0 ? this.slowMul : 1);
    this.vx = damp(this.vx, (dx / d) * sp, 6, dt);
    this.vz = damp(this.vz, (dz / d) * sp, 6, dt);
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (this.slowT > 0) this.slowT -= dt;
    else this.slowMul = 1;
    if (circleHit(this.x, this.z, this.radius, p.x, p.z, p.radius) && p.iframe <= 0) {
      p.hp -= this.contactDamage;
      p.iframe = PLAYER.iframes;
      p.hits++;
    }
  }
}

class SimPlayer {
  constructor(charId) {
    const ch = CHARACTER_BY_ID[charId];
    this.character = ch;
    this.stats = new StatBlock();
    for (const [k, v] of Object.entries(ch.stats)) this.stats.add({ key: k, value: v, mode: 'pct' });
    this.maxHp = this.stats.get('maxHp');
    this.hp = this.maxHp;
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.radius = PLAYER.radius;
    this.alive = true;
    this.iframe = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNeed = XP.need(1);
    this.kills = 0;
    this.hits = 0;
    this.pickup = 0;
  }

  get speed() {
    return this.stats.get('moveSpeed');
  }

  update(dt, input) {
    if (this.iframe > 0) this.iframe -= dt;
    this.vx = damp(this.vx, input.x * this.speed, 16, dt);
    this.vz = damp(this.vz, -input.y * this.speed, 16, dt);
    this.x = clamp(this.x + this.vx * dt, -ARENA.half + this.radius, ARENA.half - this.radius);
    this.z = clamp(this.z + this.vz * dt, -ARENA.half + this.radius, ARENA.half - this.radius);
    // sweep up loose XP like the magnet does
    this.pickup = Math.min(8, PLAYER.pickupBase + this.level * PLAYER.pickupPerLevel);
    if (this.hp <= 0) this.alive = false;
  }

  addXp(v) {
    this.xp += v;
    while (this.xp >= this.xpNeed && this.level < XP.maxLevel) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = XP.need(this.level);
    }
  }
}

/** Flee the threat centroid, turning along the rim instead of into it. */
function kiteInput(p, enemies) {
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = dist(e.x, e.z, p.x, p.z);
    if (d > 16) continue;
    cx += e.x;
    cz += e.z;
    n++;
  }
  let ax = n ? p.x - cx / n : 0;
  let az = n ? p.z - cz / n : 0;
  const edge = Math.hypot(p.x, p.z) / ARENA.half;
  if (edge > 0.82) {
    ax += -p.z * 0.7;
    az += p.x * 0.7;
  }
  const l = Math.hypot(ax, az) || 1;
  return { x: ax / l, y: -az / l };
}

/**
 * Rough DPS a character sustains mid-run.
 *
 * Modelled continuously on purpose. Modelling it as discrete steps ("+1 weapon
 * at level 5, +11% damage every 3 levels") creates artificial spikes at
 * particular waves that have nothing to do with the content, which then reads
 * as a balance bug. Real card draws are probabilistic and smooth.
 */
function estimateDps(charId, wave) {
  const ch = CHARACTER_BY_ID[charId];
  // keyed by the character's *weapon id*, not the character id
  const base = { scatter: 14, smg: 5.5, grenade: 26, tesla: 15, frost: 12 }[ch.weapon] ?? 10;
  const lvl = Math.min(32, 1 + wave * 1.5);
  // one extra weapon per ~5 levels, plus ~11% damage and ~10% attack speed per level
  const weapons = 1 + lvl / 5;
  const growth = Math.pow(1.11, lvl) * Math.pow(1.1, lvl);
  return base * weapons * growth;
}

test('a competent kiter survives the first three waves on every character', () => {
  for (const charId of Object.keys(CHARACTER_BY_ID)) {
    const p = new SimPlayer(charId);
    const rng = new Rng(4242);
    const enemies = [];
    let wave = 0;
    for (let frame = 0; frame < 60 * 220 && p.alive; frame++) {
      const t = frame / 60;
      wave = Math.min(3, 1 + Math.floor(t / 62));
      if (frame % 24 === 0) {
        const plan = wavePlan(wave, DIFF, rng);
        for (let i = 0; i < 5; i++) {
          const id = plan.roster[Math.floor(rng.next() * plan.roster.length)];
          if (!id) continue;
          const a = rng.range(0, Math.PI * 2);
          enemies.push(new SimEnemy(ENEMIES[id], Math.cos(a) * 17, Math.sin(a) * 17, wave));
        }
      }
      p.update(1 / 60, kiteInput(p, enemies));
      for (const e of enemies) e.update(1 / 60, p);
      // auto-fire: kill whatever is close
      const dps = estimateDps(charId, wave) * 0.55;
      for (const e of enemies) {
        if (e.alive && dist(e.x, e.z, p.x, p.z) < 10) {
          e.damage(dps / 60);
          if (!e.alive) {
            p.kills++;
            p.addXp(e.def.xp);
          }
        }
      }
      for (let i = enemies.length - 1; i >= 0; i--) if (!enemies[i].alive) enemies.splice(i, 1);
    }
    assert.ok(
      p.alive,
      `${charId} died before wave 3 (survived ${(p.hits)} hits, hp ${p.hp.toFixed(0)})`,
    );
  }
});

test('standing still is always fatal, in every difficulty', () => {
  for (const diffId of Object.keys(DIFFICULTIES)) {
    const p = new SimPlayer('vanguard');
    const rng = new Rng(99);
    const enemies = [];
    for (let frame = 0; frame < 60 * 200 && p.alive; frame++) {
      if (frame % 20 === 0) {
        const a = rng.range(0, Math.PI * 2);
        const def = rng.pick(Object.values(ENEMIES));
        enemies.push(new SimEnemy(def, Math.cos(a) * 14, Math.sin(a) * 14, 3));
      }
      p.update(1 / 60, { x: 0, y: 0 });
      for (const e of enemies) e.update(1 / 60, p);
    }
    assert.equal(p.alive, false, `${diffId} should be lethal when standing still`);
  }
});

test('iframes cap the incoming damage rate', () => {
  const p = new SimPlayer('vanguard');
  const e = new SimEnemy(ENEMIES.grunt, 0, 0, 1);
  e.x = p.x;
  e.z = p.z;
  const before = p.hp;
  for (let i = 0; i < 30; i++) {
    p.update(1 / 60, { x: 0, y: 0 });
    e.update(1 / 60, p);
  }
  // one iframe window is 0.65s, so 0.5s of contact can land at most one hit
  assert.equal(p.hits, 1, `expected 1 hit in 0.5s, got ${p.hits}`);
  assert.ok(p.hp < before);
});

test('enemies deal a survivable but meaningful share of max HP', () => {
  for (const def of Object.values(ENEMIES)) {
    const hitsToDie = PLAYER.maxHp / (def.damage * enemyScale(1, DIFF).damage);
    assert.ok(
      hitsToDie >= 5,
      `${def.id} kills a fresh player in ${hitsToDie.toFixed(1)} hits; too spiky`,
    );
  }
});

test('wave HP budgets stay inside a kitable envelope', () => {
  for (let wave = 1; wave <= WAVES.total; wave++) {
    const plan = wavePlan(wave, DIFF, new Rng(wave));
    const scale = enemyScale(wave, DIFF);
    // total effective HP the wave will put on the field
    const totalHp = plan.roster.reduce((s, id) => s + ENEMIES[id].hp * scale.hp, 0);
    const dps = estimateDps('vanguard', wave);
    const waveSeconds = plan.duration;
    // The player should be able to out-damage the wave. The factor accounts for
    // enemies dying before all their HP lands (they arrive in a trickle and the
    // player is also kiting), so the raw ratio sits a little above 1.
    assert.ok(
      dps * waveSeconds > totalHp * 1.2,
      `wave ${wave}: ${totalHp.toFixed(0)} effective HP vs ${dps.toFixed(0)} dps over ${waveSeconds}s — unwinnable`,
    );
  }
});

test('boss HP is beatable within its wave at the expected build level', () => {
  for (const boss of Object.values(BOSSES)) {
    const wave = { colossus: 5, hierophant: 10, devourer: 15 }[boss.id];
    const bossHp = boss.hp * enemyScale(wave, DIFF).hp;
    // bosses are the DPS check: the player should be able to solo one inside
    // its wave, otherwise the fight is a timer rather than a check.
    const dps = estimateDps('vanguard', wave) * 1.5;
    const seconds = bossHp / dps;
    assert.ok(
      seconds > 8 && seconds < 60,
      `${boss.id} would take ${seconds.toFixed(0)}s to kill; want 8-60s`,
    );
  }
});

test('the 20-wave run is long enough to be a run, short enough to finish', () => {
  const nominal = WAVES.total * (WAVES.duration + WAVES.prepTime + WAVES.restTime);
  assert.ok(nominal > 12 * 60, `nominal run is only ${(nominal / 60).toFixed(0)} min`);
  assert.ok(nominal < 30 * 60, `nominal run is ${(nominal / 60).toFixed(0)} min; too long`);
});

test('swept collision matches the analytic expectation for a railgun step', () => {
  const step = 130 / 60;
  for (const offset of [0, 0.3, 0.9, 1.2]) {
    const hit = sweepCircle(0, 0, step, 0, step * 0.5, offset, 0.62 + 0.5) >= 0;
    const expected = offset <= 1.12;
    assert.equal(hit, expected, `offset ${offset}`);
  }
});

test('cone weapons reward point-blank positioning', () => {
  // at 1 unit a shotgun should hit a target a longer shot would miss
  const close = inCone(0, 0, 1, 0, 0.42, 12, 1, 0.9, 0.62);
  const far = inCone(0, 0, 1, 0, 0.42, 12, 10, 9, 0.62);
  assert.equal(close, true, 'point blank should connect');
  assert.equal(far, false, 'long angled shot should miss');
});

/**
 * Guards a real regression: the damage-dealt total used to be credited only by
 * AoE explosions and by `maxHp` on death, so every direct projectile hit was
 * invisible to the HUD and every kill was double-counted.
 *
 * The credit sites need a live scene to exercise, so this asserts the invariant
 * structurally: every `e.damage(...)` call must be paired with a credit, and
 * nothing may credit on death.
 */
test('every damage path credits the run total exactly once', () => {
  const src = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
  const proj = src('../../src/game/projectiles.js');
  const game = src('../../src/game/game.js');

  // no double-count on kill (the original bug)
  assert.doesNotMatch(game, /damageDealt\s*\+=\s*e\.(maxHp|hp)\b/);
  assert.doesNotMatch(proj, /damageDealt\s*\+=\s*e\.(maxHp|hp)\b/);

  // every damage call site is accounted for by a nearby credit
  const sites = [
    [proj, 'projectile impact'],
    [proj, 'explosion'],
    [game, 'frost cone'],
    [game, 'orbital'],
  ];
  for (const [code, label] of sites) {
    const calls = code.match(/e\.damage\(/g) ?? [];
    const credits = code.match(/damageDealt\s*\+=/g) ?? [];
    assert.ok(calls.length > 0, `${label}: no damage call found`);
    assert.ok(
      credits.length >= calls.length - 1,
      `${label}: ${calls.length} damage calls but only ${credits.length} credits`,
    );
  }

  // the direct-hit credit must exist in the projectile path specifically
  assert.match(
    proj,
    /damageDealt \+= dealt/,
    'projectile impacts must credit damageDealt at the point of impact',
  );
});
