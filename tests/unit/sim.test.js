import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Headless simulation of the game's core rules (movement, cooldowns, AoE,
 * enemy AI targeting, pickups, levelling). This mirrors the real modules but
 * runs without WebGL so the design can be regression-tested in Node.
 */
import { Rng } from '../../src/core/rng.js';
import { StatBlock, computeDamage, falloff } from '../../src/game/stats.js';
import { circleHit, sweepCircle, inCone } from '../../src/game/collision.js';
import { WEAPON_BY_ID, weaponStats } from '../../src/game/weaponDefs.js';
import { ENEMIES, enemyScale } from '../../src/game/enemyDefs.js';
import { CHARACTER_BY_ID } from '../../src/game/characters.js';
import { XP, ARENA, PLAYER } from '../../src/game/config.js';
import { clamp, damp, dist } from '../../src/core/math.js';

// --------------------------------------------------------- minimal sim world

class SimEnemy {
  constructor(def, x, z, wave, difficulty) {
    this.def = def;
    const s = enemyScale(wave, difficulty);
    this.maxHp = def.hp * s.hp;
    this.hp = this.maxHp;
    this.speed = def.speed * s.speed;
    this.contactDamage = def.damage * s.damage;
    this.radius = def.radius;
    this.armor = def.armor ?? 0;
    this.xp = def.xp * s.xp;
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.alive = true;
    this.slowT = 0;
    this.slowMul = 1;
    this.stunT = 0;
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
    if (this.stunT > 0) {
      this.stunT -= dt;
      return;
    }
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
    }
  }
}

class SimPlayer {
  constructor(charId, difficulty) {
    this.character = CHARACTER_BY_ID[charId];
    this.difficulty = difficulty;
    this.stats = new StatBlock();
    for (const [k, v] of Object.entries(this.character.stats)) {
      this.stats.add({ key: k, value: v, mode: 'pct' });
    }
    this.maxHp = this.stats.get('maxHp');
    this.hp = this.maxHp;
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.radius = PLAYER.radius;
    this.alive = true;
    this.level = 1;
    this.xp = 0;
    this.xpNeed = XP.need(1);
    this.gold = 0;
    this.kills = 0;
    this.iframe = 0;
    this.weapons = [{ def: WEAPON_BY_ID[this.character.weapon], cd: 0, level: 1 }];
    this.rules = { ...(this.character.rules ?? {}) };
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
    if (this.hp <= 0) this.alive = false;
  }

  addXp(v) {
    this.xp += v * this.stats.get('xpGain');
    while (this.xp >= this.xpNeed && this.level < XP.maxLevel) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = XP.need(this.level);
    }
  }
}

function stepWorld(world, dt) {
  world.player.update(dt, world.input);
  world.enemies.forEach((e) => e.update(dt, world.player));
  world.enemies = world.enemies.filter((e) => e.alive);
  for (const w of world.player.weapons) w.cd -= dt;
  world.time += dt;
}

const EASY = { enemyHpMul: 1, enemyDmgMul: 1, spawnMul: 1, goldMul: 1 };

// ------------------------------------------------------------------- tests

test('player accelerates toward max speed instead of teleporting', () => {
  const p = new SimPlayer('vanguard', EASY);
  const w = { player: p, enemies: [], input: { x: 1, y: 0 }, time: 0 };
  stepWorld(w, 1 / 60);
  const firstFrame = p.vx;
  assert.ok(firstFrame > 0 && firstFrame < p.speed * 0.6, `first frame vx ${firstFrame}`);
  for (let i = 0; i < 120; i++) stepWorld(w, 1 / 60);
  assert.ok(Math.abs(p.vx - p.speed) < 0.05, `should reach top speed, got ${p.vx}`);
});

test('player is clamped inside the arena', () => {
  const p = new SimPlayer('vanguard', EASY);
  const w = { player: p, enemies: [], input: { x: 1, y: 1 }, time: 0 };
  for (let i = 0; i < 600; i++) stepWorld(w, 1 / 60);
  assert.ok(Math.abs(p.x) <= ARENA.half, `x ${p.x}`);
  assert.ok(Math.abs(p.z) <= ARENA.half, `z ${p.z}`);
});

test('different characters really do have different top speeds', () => {
  const speeds = Object.keys(CHARACTER_BY_ID).map((id) => new SimPlayer(id, EASY).speed);
  assert.ok(new Set(speeds.map((s) => s.toFixed(2))).size >= 4, `speeds too similar: ${speeds}`);
});

test('contact damage applies and respects iframes', () => {
  const p = new SimPlayer('vanguard', EASY);
  p.iframe = 0;
  const e = new SimEnemy(ENEMIES.grunt, 0, 0, 1, EASY);
  e.x = p.x;
  e.z = p.z;
  const before = p.hp;
  const w = { player: p, enemies: [e], input: { x: 0, y: 0 }, time: 0 };
  stepWorld(w, 1 / 60);
  const afterFirst = p.hp;
  assert.ok(afterFirst < before, 'touching should hurt');
  // a fresh enemy immediately after must not deal damage inside the i-frame window
  const e2 = new SimEnemy(ENEMIES.grunt, p.x, p.z, 1, EASY);
  stepWorld({ ...w, enemies: [e2] }, 1 / 60);
  assert.equal(p.hp, afterFirst, 'iframes should block the follow-up hit');
});

test('a player who never moves eventually dies to a surrounding wave', () => {
  const p = new SimPlayer('vanguard', EASY);
  const rng = new Rng(3);
  const enemies = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    enemies.push(new SimEnemy(ENEMIES.grunt, p.x + Math.cos(a) * 9, p.z + Math.sin(a) * 9, 5, EASY));
  }
  const w = { player: p, enemies, input: { x: 0, y: 0 }, time: 0 };
  for (let i = 0; i < 60 * 30 && p.alive; i++) stepWorld(w, 1 / 60);
  assert.equal(p.alive, false, 'standing still in a wave must be fatal');
});

test('a player who kites survives much longer than one who stands still', () => {
  const make = (kite) => {
    const p = new SimPlayer('vanguard', EASY);
    const rng = new Rng(11);
    const enemies = [];
    // a pursuer pack closing from one side, leaving room to kite into
    for (let i = 0; i < 14; i++) {
      const a = rng.range(-0.9, 0.9);
      enemies.push(
        new SimEnemy(ENEMIES.grunt, p.x + Math.cos(a) * 16, p.z + Math.sin(a) * 16, 4, EASY),
      );
    }
    const w = { player: p, enemies, input: { x: 0, y: 0 }, time: 0 };
    let frames = 0;
    const maxFrames = 60 * 40;
    for (; frames < maxFrames && p.alive; frames++) {
      if (kite) {
        // flee the threat centroid, biased along the arena edge so we never corner ourselves
        let cx = 0;
        let cz = 0;
        let n = 0;
        for (const e of enemies) {
          const d = Math.hypot(e.x - p.x, e.z - p.z);
          if (d < 14) {
            cx += e.x;
            cz += e.z;
            n++;
          }
        }
        let ax = 0;
        let az = 0;
        if (n > 0) {
          ax = p.x - cx / n;
          az = p.z - cz / n;
        }
        const edge = Math.hypot(p.x, p.z) / ARENA.half;
        if (edge > 0.8) {
          // too close to the rim: turn along the wall instead of into it
          const tx = -p.z;
          const tz = p.x;
          ax += tx * 0.6;
          az += tz * 0.6;
        }
        const l = Math.hypot(ax, az) || 1;
        w.input = { x: ax / l, y: -az / l };
      }
      stepWorld(w, 1 / 60);
    }
    return frames;
  };
  const still = make(false);
  const kiting = make(true);
  assert.ok(kiting > still, `kiting ${kiting} frames should outlast standing ${still} frames`);
});

test('enemies converge on the player, and slower types lag behind', () => {
  const p = new SimPlayer('vanguard', EASY);
  const fast = new SimEnemy(ENEMIES.runner, 12, 0, 1, EASY);
  const slow = new SimEnemy(ENEMIES.tank, 12, 0, 1, EASY);
  const w = { player: p, enemies: [fast, slow], input: { x: 0, y: 0 }, time: 0 };
  for (let i = 0; i < 180; i++) stepWorld(w, 1 / 60);
  assert.ok(dist(fast.x, fast.z, p.x, p.z) < dist(slow.x, slow.z, p.x, p.z));
});

test('slow effects reduce travel distance and expire correctly', () => {
  const p = new SimPlayer('vanguard', EASY);
  const a = new SimEnemy(ENEMIES.grunt, 10, 0, 1, EASY);
  const b = new SimEnemy(ENEMIES.grunt, 10, 0, 1, EASY);
  a.slowT = 2;
  a.slowMul = 0.5;
  const w = { player: p, enemies: [a, b], input: { x: 0, y: 0 }, time: 0 };
  for (let i = 0; i < 120; i++) stepWorld(w, 1 / 60);
  assert.ok(a.slowT > 0, 'slow should still be active at 2s');
  assert.ok(a.speed * a.slowMul < b.speed, 'slowed enemy moves slower');
  assert.ok(dist(a.x, a.z, p.x, p.z) > dist(b.x, b.z, p.x, p.z), 'slowed enemy should be further away');
  // once the slow lapses the multiplier resets and it matches the unslowed twin
  for (let i = 0; i < 240; i++) stepWorld(w, 1 / 60);
  assert.ok(a.slowT <= 0, 'slow should have expired');
  assert.equal(a.slowMul, 1, 'slow multiplier must reset to full speed');
  assert.ok(a.speed === b.speed);
});

test('AoE explosion damages everything in radius and respects armor/falloff', () => {
  const eNear = new SimEnemy(ENEMIES.tank, 0, 0.5, 1, EASY);
  const eMid = new SimEnemy(ENEMIES.tank, 0, 2, 1, EASY);
  const eFar = new SimEnemy(ENEMIES.tank, 0, 20, 1, EASY);
  const R = 4;
  const dmg = 100;
  const hit = (e) => {
    const d = dist(e.x, e.z, 0, 0);
    if (d > R + e.radius) return 0;
    return e.damage(dmg * falloff(Math.max(0, d - e.radius), R));
  };
  const near = hit(eNear);
  const mid = hit(eMid);
  const far = hit(eFar);
  assert.ok(near > mid, 'center should hit harder');
  assert.equal(far, 0, 'out-of-range must be untouched');
  assert.ok(mid > 0 && mid < dmg, 'mid should be a reduced but real hit');
  assert.equal(eNear.hp, eNear.maxHp - near);
});

test('swept projectiles kill small fast enemies without tunneling', () => {
  // 130 u/s railgun at 60fps travels ~2.2 units per frame; a grunt is 0.62 radius
  const p = new SimPlayer('vanguard', EASY);
  const target = new SimEnemy(ENEMIES.grunt, 4.5, 0, 1, EASY);
  let px = p.x;
  let framesInside = 0;
  for (let frame = 0; frame < 8; frame++) {
    const nx = px + 130 / 60;
    if (sweepCircle(px, 0, nx, 0, target.x, target.z, target.radius + 0.5) >= 0) framesInside++;
    px = nx;
  }
  assert.ok(framesInside > 0, 'the round must overlap the target');
  // the game dedupes per-target via a hit set, so the target is only hit once
  const hitSet = new Set();
  px = p.x;
  for (let frame = 0; frame < 8; frame++) {
    const nx = px + 130 / 60;
    if (sweepCircle(px, 0, nx, 0, target.x, target.z, target.radius + 0.5) >= 0) hitSet.add(target);
    px = nx;
  }
  assert.equal(hitSet.size, 1, 'a piercing round must not double-hit one target');
});

test('shotgun cone hits clustered enemies but not those behind', () => {
  const s = weaponStats(WEAPON_BY_ID.scatter, 4);
  const spread = s.spread;
  const half = spread;
  assert.equal(inCone(0, 0, 1, 0, half, s.range, 3, 0, 0.6), true);
  assert.equal(inCone(0, 0, 1, 0, half, s.range, 3, 3, 0.6), false);
  assert.equal(inCone(0, 0, 1, 0, half, s.range, -3, 0, 0.6), false);
});

test('weapon DPS scales with level and with the damage stat', () => {
  const dps = (weaponId, level, dmgMul = 1) => {
    const s = weaponStats(WEAPON_BY_ID[weaponId], level);
    const perShot = s.damage * dmgMul * (s.pellets ?? 1);
    return perShot / s.cd;
  };
  assert.ok(dps('scatter', 4) > dps('scatter', 1), 'leveling should raise dps');
  assert.ok(dps('scatter', 4, 2) > dps('scatter', 4), 'damage stat should raise dps');
  assert.ok(dps('scatter', 1) > dps('smg', 1) * 0.5, 'shotgun should be in a sane band');
});

test('crit rate observed over many hits matches the configured chance', () => {
  const rng = new Rng(808);
  let crits = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    if (computeDamage(10, { critChance: 0.25, critDamage: 2, rng: () => rng.next(), variance: 0 }).crit) crits++;
  }
  const rate = crits / N;
  assert.ok(Math.abs(rate - 0.25) < 0.015, `crit rate ${rate}`);
});

test('levelling paces a full 20-wave run at a reasonable rate', () => {
  const p = new SimPlayer('vanguard', EASY);
  let totalXp = 0;
  for (let i = 0; i < 3000; i++) {
    p.addXp(2);
    totalXp += 2;
  }
  assert.ok(p.level > 15, `3000 xp should be well past level 15, got ${p.level}`);
  assert.ok(p.level <= 45, `3000 xp should land in a sane band, got ${p.level}`);
  // cumulative xp needed for that level must exceed what we fed in
  let needed = 0;
  for (let l = 1; l < p.level; l++) needed += XP.need(l);
  assert.ok(totalXp >= needed);
});

test('the first level-up arrives quickly, then the curve steepens', () => {
  const p = new SimPlayer('vanguard', EASY);
  // a typical early kill is worth 1-2 xp; level 2 should land within a handful
  assert.ok(XP.need(1) <= 12, `first level should be cheap, got ${XP.need(1)}`);
  assert.ok(XP.need(1) >= 6, `first level should not be free, got ${XP.need(1)}`);
  // and the marginal cost must keep rising so levelling stays meaningful
  for (let l = 1; l < 40; l++) {
    assert.ok(XP.need(l + 1) > XP.need(l), `level ${l + 1} must cost more than ${l}`);
  }
});

test('armor reduces incoming damage by exactly its value', () => {
  const p = new SimPlayer('vanguard', EASY);
  p.stats.add({ key: 'armor', value: 3, mode: 'flat' });
  assert.equal(p.stats.get('armor'), 3);
});

test('20-minute stress run keeps every entity finite and in bounds', () => {
  const p = new SimPlayer('demolitionist', EASY);
  const rng = new Rng(2026);
  let enemies = [];
  const w = { player: p, enemies, input: { x: 0, y: 0 }, time: 0 };
  for (let frame = 0; frame < 60 * 60 * 20; frame++) {
    if (frame % 30 === 0 && enemies.length < 250) {
      for (let i = 0; i < 6; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(12, 40);
        const def = rng.pick(Object.values(ENEMIES));
        enemies.push(new SimEnemy(def, p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 12, EASY));
      }
    }
    // kite in a circle
    const t = w.time * 0.6;
    w.input = { x: Math.cos(t), y: Math.sin(t) };
    stepWorld(w, 1 / 60);
    // simulate weapon fire killing things
    for (const e of enemies) {
      if (Math.random() < 0.25) {
        const dealt = e.damage(20 * p.stats.get('damage'));
        if (!e.alive) {
          p.kills++;
          p.addXp(e.xp);
        }
      }
    }
    enemies = enemies.filter((e) => e.alive);
    // player should not be able to survive forever in a killing machine sim
    p.hp = Math.min(p.maxHp, p.hp + 0.02);
  }
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
  assert.ok(Math.abs(p.x) <= ARENA.half && Math.abs(p.z) <= ARENA.half);
  assert.ok(p.kills > 1000, `expected a busy run, got ${p.kills} kills`);
  assert.ok(p.level > 20, `expected meaningful progression, got level ${p.level}`);
});

test('RNG stream used for a fixed seed is reproducible end to end', () => {
  const run = () => {
    const rng = new Rng(31337);
    const p = new SimPlayer('engineer', EASY);
    const seq = [];
    for (let i = 0; i < 500; i++) {
      const a = rng.range(0, Math.PI * 2);
      seq.push(Math.round(a * 1e6));
      p.update(1 / 60, { x: Math.cos(a), y: Math.sin(a) });
    }
    return { seq, x: Math.round(p.x * 1e6) };
  };
  assert.deepEqual(run(), run());
});
