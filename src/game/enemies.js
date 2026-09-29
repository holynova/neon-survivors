import * as THREE from 'three';
import { ENEMIES, BOSSES, enemyScale } from './enemyDefs.js';
import { circleHit, SpatialHash } from './collision.js';
import { clamp, damp, angleDiff, wrapDelta } from '../core/math.js';
import { ARENA } from './config.js';
import { makeEnemyMaterial, HealthBarPool } from '../fx/enemyMaterial.js';

const geoCache = new Map();

function geoFor(shape) {
  if (geoCache.has(shape)) return geoCache.get(shape);
  let g;
  switch (shape) {
    case 'tetra':
      g = new THREE.TetrahedronGeometry(0.72);
      break;
    case 'octa':
      g = new THREE.OctahedronGeometry(0.66);
      break;
    case 'box':
      g = new THREE.BoxGeometry(1.1, 1.1, 1.1);
      break;
    case 'cone':
      g = new THREE.ConeGeometry(0.6, 1.35, 7);
      break;
    case 'blade':
      g = new THREE.OctahedronGeometry(0.78, 0);
      break;
    case 'tiny':
      g = new THREE.IcosahedronGeometry(0.34, 0);
      break;
    case 'ring':
      g = new THREE.TorusGeometry(0.5, 0.2, 8, 16);
      break;
    case 'boss_core':
      g = new THREE.IcosahedronGeometry(2.3, 1);
      break;
    case 'boss_frost':
      g = new THREE.OctahedronGeometry(2.5, 1);
      break;
    case 'boss_void':
      g = new THREE.IcosahedronGeometry(2.7, 2);
      break;
    default:
      g = new THREE.SphereGeometry(0.6, 10, 8);
  }
  geoCache.set(shape, g);
  return g;
}

/**
 * Extra silhouette pieces bolted onto the base geometry per enemy type.
 *
 * A single primitive reads as "a shape" at this camera distance. Adding a
 * direction marker (nose/spikes) or armour plates gives each type a profile
 * you can identify without relying on colour, which matters because several
 * types share similar hues under the rim shader.
 */
const DETAILS = {
  // runner: swept-back spikes, reads as "fast"
  runner: () => {
    const g = new THREE.Group();
    const spike = new THREE.ConeGeometry(0.16, 0.62, 4);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(spike);
      m.position.set(0, -0.16 + i * 0.22, -0.62 - i * 0.06);
      m.rotation.x = Math.PI / 2 + 0.5;
      g.add(m);
    }
    return g;
  },
  // tank: shoulder plates + a low stance, reads as "heavy"
  tank: () => {
    const g = new THREE.Group();
    const plate = new THREE.BoxGeometry(1.5, 0.26, 1.2);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(plate);
      m.position.set(s * 0.42, 0.42, 0);
      m.rotation.z = s * 0.24;
      g.add(m);
    }
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0));
    core.position.set(0, 0.72, 0);
    g.add(core);
    return g;
  },
  // shooter: forward barrel, reads as "it shoots at you"
  shooter: () => {
    const g = new THREE.Group();
    const barrel = new THREE.CylinderGeometry(0.1, 0.14, 0.9, 6);
    const m = new THREE.Mesh(barrel);
    m.position.set(0, 0.1, 0.85);
    m.rotation.x = Math.PI / 2;
    g.add(m);
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 6, 12));
    muzzle.position.set(0, 0.1, 1.28);
    g.add(muzzle);
    return g;
  },
  // dasher: a single long forward lance, reads as "it will charge"
  dasher: () => {
    const g = new THREE.Group();
    const lance = new THREE.ConeGeometry(0.2, 1.35, 4);
    const m = new THREE.Mesh(lance);
    m.position.set(0, 0, 1.0);
    m.rotation.x = Math.PI / 2;
    g.add(m);
    const fin = new THREE.BoxGeometry(0.9, 0.1, 0.3);
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(fin);
      f.position.set(s * 0.42, 0, -0.2);
      g.add(f);
    }
    return g;
  },
  // orbiter: a spinning ring, reads as "it circles you"
  orbiter: () => {
    const g = new THREE.Group();
    // NB: BufferGeometry has no .rotation — rotate the geometry itself.
    const ring = new THREE.TorusGeometry(0.85, 0.06, 6, 20);
    ring.rotateX(Math.PI / 2);
    g.add(new THREE.Mesh(ring));
    // a second, counter-rotating ring so the motion reads at a glance
    const ring2 = new THREE.TorusGeometry(0.62, 0.045, 6, 18);
    ring2.rotateZ(Math.PI / 2);
    g.add(new THREE.Mesh(ring2));
    return g;
  },
  // splitter: a visible core seam, reads as "it splits"
  splitter: () => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const lobe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.44, 0));
      lobe.position.set(s * 0.42, 0, 0);
      g.add(lobe);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 6, 16));
    band.rotation.y = Math.PI / 2;
    g.add(band);
    return g;
  },
  // elite: a crown so it reads as dangerous at a glance
  elite: () => {
    const g = new THREE.Group();
    const crown = new THREE.ConeGeometry(0.14, 0.5, 4);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const m = new THREE.Mesh(crown);
      m.position.set(Math.cos(a) * 0.5, 0.62, Math.sin(a) * 0.5);
      g.add(m);
    }
    return g;
  },
  // boss silhouettes: orbiting shards must sit OUTSIDE the body radius or they
  // hide inside the mesh and read as noise.
  colossus: () => {
    const g = new THREE.Group();
    const shard = new THREE.TetrahedronGeometry(0.62);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const m = new THREE.Mesh(shard);
      m.position.set(Math.cos(a) * 3.4, Math.sin(i * 1.3) * 0.8, Math.sin(a) * 3.4);
      m.userData.orbit = a;
      m.userData.r = 3.4;
      m.userData.bob = i * 1.1;
      g.add(m);
    }
    return g;
  },
  hierophant: () => {
    const g = new THREE.Group();
    const spike = new THREE.ConeGeometry(0.42, 2.6, 5);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const m = new THREE.Mesh(spike);
      m.position.set(Math.cos(a) * 3.5, -0.6, Math.sin(a) * 3.5);
      m.rotation.z = Math.PI;
      m.userData.orbit = a;
      m.userData.r = 3.5;
      m.userData.bob = i * 0.8;
      g.add(m);
    }
    return g;
  },
  devourer: () => {
    const g = new THREE.Group();
    const tentacle = new THREE.ConeGeometry(0.42, 4.4, 5);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const m = new THREE.Mesh(tentacle);
      m.position.set(Math.cos(a) * 3.6, -2.0, Math.sin(a) * 3.6);
      m.rotation.x = Math.PI;
      m.userData.orbit = a;
      m.userData.r = 3.6;
      m.userData.bob = i * 0.7;
      g.add(m);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 12));
    eye.position.y = 2.4;
    g.add(eye);
    return g;
  },
};

function matFor(def) {
  return makeEnemyMaterial({
    color: def.color,
    elite: def.elite,
    boss: def.boss,
    small: def.radius < 0.5,
  });
}

export class Enemy {
  constructor() {
    this.alive = false;
    this.mesh = null;
    this.halo = null;
  }

  init(def, scale, wave, difficulty) {
    this.def = def;
    this.maxHp = def.hp * scale.hp;
    this.hp = this.maxHp;
    this.speed = def.speed * scale.speed;
    // NB: `damage()` is the method below — the stat must not shadow it.
    this.contactDamage = def.damage * scale.damage;
    this.radius = def.radius;
    this.mass = def.mass ?? 1;
    this.armor = def.armor ?? 0;
    this.xpValue = def.xp * scale.xp;
    this.goldValue = def.gold;
    this.boss = !!def.boss;
    this.elite = !!def.elite;
    this.wave = wave;
    this.behavior = def.behavior;

    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.facing = 0;
    this.alive = true;

    this.slowT = 0;
    this.slowMul = 1;
    this.stunT = 0;
    this.freezeT = 0;
    this.shockT = 0;
    this.hitFlash = 0;
    this.knockX = 0;
    this.knockZ = 0;
    this.scalePulse = 0;

    this.state = 'idle';
    this.timer = 0;
    this.cd = Math.random() * 1.4;
    this.dashT = 0;
    this.dashX = 0;
    this.dashZ = 0;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.spawnT = 0;

    this.deadBy = null;
    this.orbitTouch = new Map();

    if (!this.mesh) {
      this.mesh = new THREE.Mesh(geoFor(def.shape), matFor(def));
      this.mesh.castShadow = !!def.boss;
      // Ground ring doubles as the dasher's charge telegraph, so it stays —
      // but only the telegraph path turns it up. As a permanent marker it just
      // littered the arena with circles.
      this.halo = new THREE.Mesh(
        new THREE.RingGeometry(def.radius * 1.3, def.radius * 1.55, 28),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(def.color),
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.halo.rotation.x = -Math.PI / 2;
      this.halo.position.y = 0.04;
      this.group = new THREE.Group();
      this.group.add(this.mesh);
      this.group.add(this.halo);
    } else {
      this.mesh.geometry = geoFor(def.shape);
      this.mesh.material.dispose();
      this.mesh.material = matFor(def);
    }

    // Silhouette detailing, rebuilt when the pooled enemy changes type.
    if (this.detailKey !== def.id) {
      if (this.detail) {
        this.detail.traverse((o) => {
          if (o.isMesh) o.geometry.dispose();
        });
        this.group.remove(this.detail);
      }
      const make = DETAILS[def.id];
      this.detail = make ? make() : null;
      if (this.detail) {
        // Detail pieces get their own material: a shared one means small parts
        // (barrels, fins) read as dark sticks against the body, and each
        // material would need separate hit-flash bookkeeping.
        this.detailMat = makeEnemyMaterial({
          color: def.color,
          elite: def.elite,
          boss: def.boss,
          small: true,
        });
        this.detailMat.uniforms.uRimStrength.value = 1.45;
        this.detailMat.uniforms.uEmissiveStrength.value = 0.5;
        this.detail.traverse((o) => {
          if (o.isMesh) o.material = this.detailMat;
          if (o.userData.orbit !== undefined && o.userData.baseY === undefined) {
            o.userData.baseY = o.position.y;
          }
        });
        this.group.add(this.detail);
      }
      this.detailKey = def.id;
    }
    this.mesh.scale.setScalar(1);
    this.group.visible = true;
    this.group.position.set(0, 0, 0);
    this.baseY = def.boss ? 2.2 : def.shape === 'ring' ? 1.0 : 0.72;
    this.group.position.y = 0;
    return this;
  }

  get color() {
    const c = new THREE.Color(this.def.color);
    return [c.r, c.g, c.b];
  }

  /** Returns damage actually dealt. Handles armor, flash, death. */
  damage(amount, cause = 'hit', opts = {}) {
    if (!this.alive) return 0;
    const dealt = Math.max(1, amount * (1 - this.armor));
    this.hp -= dealt;
    this.hitFlash = 1;
    this.scalePulse = Math.min(0.35, this.scalePulse + 0.14);
    if (!opts.silent) this.world?.audio?.hit(clamp(dealt / 24, 0.3, 1.4));
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deadBy = cause;
      this.world?.onEnemyKilled(this, cause, opts);
    }
    return dealt;
  }

  dispose() {
    this.group.removeFromParent();
  }
}

export class EnemyManager {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.free = [];
    this.hash = new SpatialHash(3.2);
    this.queryBuf = [];
  }

  spawn(defId, x, z, wave, difficulty) {
    const def = ENEMIES[defId] ?? BOSSES[defId];
    if (!def) return null;
    const scale = enemyScale(wave, difficulty);
    const e = (this.free.pop() ?? new Enemy()).init(def, scale, wave, difficulty);
    e.world = this.world;
    e.x = x;
    e.z = z;
    e.spawnT = 0.35;
    e.group.position.set(x, 0, z);
    this.world.scene.add(e.group);
    this.list.push(e);
    return e;
  }

  spawnBoss(id, x, z, wave, difficulty) {
    const def = BOSSES[id];
    if (!def) return null;
    const scale = enemyScale(wave, difficulty);
    const e = (this.free.pop() ?? new Enemy()).init(def, scale, wave, difficulty);
    e.world = this.world;
    e.x = x;
    e.z = z;
    e.spawnT = 1.2;
    e.group.position.set(x, 0, z);
    this.world.scene.add(e.group);
    this.list.push(e);
    this.world.onBossSpawn(e);
    return e;
  }

  clear() {
    for (const e of this.list) {
      e.group.removeFromParent();
      this.free.push(e);
    }
    this.list.length = 0;
    this.hash.clear();
    this.bars?.clear();
  }

  nearest(x, z, maxDist, filter) {
    let best = null;
    let bd = maxDist * maxDist;
    for (const e of this.list) {
      if (!e.alive) continue;
      if (filter && !filter(e)) continue;
      const dx = e.x - x;
      const dz = e.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  countAlive() {
    let n = 0;
    for (const e of this.list) if (e.alive) n++;
    return n;
  }

  update(dt, player, world) {
    const t = world.time;
    // rebuild hash
    this.hash.clear();
    for (const e of this.list) {
      if (e.alive) this.hash.insert(e, e.x, e.z);
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive) {
        e.group.removeFromParent();
        this.list.splice(i, 1);
        this.free.push(e);
        continue;
      }
      this.updateOne(e, dt, player, world, t);
    }

    this._updateHealthBars(world);
  }

  /**
   * Show a bar for anything that is damaged, elite, or a boss. Full-health
   * trash stays bar-free so the screen doesn't turn into a field of gauges.
   */
  _updateHealthBars(world) {
    if (!this.bars) this.bars = new HealthBarPool(world.scene, 220);
    const cam = world.camera;
    this.bars.begin(cam);
    for (const e of this.list) {
      if (!e.alive || e.spawnT > 0) continue;
      // bosses already have a dedicated HUD bar; a second one over a huge
      // sprite just clutters the read.
      if (e.boss) continue;
      const frac = e.hp / e.maxHp;
      const damaged = frac < 0.995;
      if (!damaged && !e.elite) continue;
      const w = e.elite ? 1.5 : 1.05;
      const h = e.elite ? 0.15 : 0.11;
      const y = e.group.position.y + e.radius * 1.7 + 0.75;
      const c = new THREE.Color(e.def.color);
      // full → empty shifts toward red so the state reads at a glance
      const col = [c.r, c.g, c.b];
      if (frac < 0.4) {
        col[0] = 1;
        col[1] = c.g * 0.5;
        col[2] = c.b * 0.5;
      }
      this.bars.push(e.x, y, e.z, w, h, frac, col);
    }
    this.bars.end();
  }

  updateOne(e, dt, player, world, t) {
    if (e.spawnT > 0) {
      e.spawnT -= dt;
      e.group.scale.setScalar(clamp(1 - e.spawnT * 2.2, 0.05, 1) * (1 + e.scalePulse));
      this.syncVisual(e, dt, t);
      return;
    }

    if (e.slowT > 0) e.slowT -= dt; else e.slowMul = 1;
    if (e.stunT > 0) e.stunT -= dt;
    if (e.freezeT > 0) e.freezeT -= dt;
    if (e.shockT > 0) e.shockT -= dt;
    if (e.hitFlash > 0) e.hitFlash -= dt * 5;
    if (e.scalePulse > 0) e.scalePulse = Math.max(0, e.scalePulse - dt * 2.4);

    const dx = player.x - e.x;
    const dz = player.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = dx / d;
    const nz = dz / d;
    const canAct = e.stunT <= 0 && e.freezeT <= 0;
    const speed = e.speed * (e.slowT > 0 ? e.slowMul : 1);

    e.timer += dt;

    if (canAct) {
      switch (e.behavior) {
        case 'chase':
          this.steer(e, nx, nz, speed, dt);
          break;
        case 'charger': {
          if (e.dashT > 0) {
            e.dashT -= dt;
            e.vx = e.dashX * e.def.dashSpeed;
            e.vz = e.dashZ * e.def.dashSpeed;
          } else {
            this.steer(e, nx, nz, speed, dt);
            e.cd -= dt;
            if (e.cd <= 0 && d < 12) {
              e.cd = e.def.dashCd[0] + Math.random() * (e.def.dashCd[1] - e.def.dashCd[0]);
              e.dashT = e.def.dashDur;
              e.dashX = nx;
              e.dashZ = nz;
              world.fx.trailPuff(e.x, e.baseY, e.z, [1, 0.6, 0.2], 0.6, 0.4);
            }
          }
          break;
        }
        case 'dasher': {
          if (e.dashT > 0) {
            e.dashT -= dt;
            e.vx = e.dashX * e.def.dashSpeed;
            e.vz = e.dashZ * e.def.dashSpeed;
            world.fx.trailPuff(e.x, e.baseY, e.z, [0.2, 0.9, 1], 0.55, 0.35);
          } else if (e.state === 'idle') {
            this.steer(e, nx, nz, speed * 0.7, dt);
            e.cd -= dt;
            if (e.cd <= 0 && d < 16) {
              e.state = 'telegraph';
              e.timer = 0;
            }
          } else if (e.state === 'telegraph') {
            e.vx *= 0.85;
            e.vz *= 0.85;
            e.facing = Math.atan2(nz, nx);
            if (e.timer >= e.def.telegraph) {
              e.state = 'idle';
              e.dashT = e.def.dashDur;
              e.dashX = nx;
              e.dashZ = nz;
              e.cd = e.def.dashCd[0] + Math.random() * (e.def.dashCd[1] - e.def.dashCd[0]);
              world.audio.shot('grenade');
              world.juice.addTrauma(0.08);
            }
          }
          break;
        }
        case 'ranged': {
          const keep = e.def.keepDist;
          if (d > keep + 2) this.steer(e, nx, nz, speed, dt);
          else if (d < keep - 2) this.steer(e, -nx, -nz, speed * 0.85, dt);
          else {
            e.vx = damp(e.vx, -nz * speed * e.orbitDir, 8, dt);
            e.vz = damp(e.vz, nx * speed * e.orbitDir, 8, dt);
            e.facing = Math.atan2(nz, nx);
          }
          e.cd -= dt;
          if (e.cd <= 0 && d < 20) {
            e.cd = e.def.shotCd * (0.8 + Math.random() * 0.4);
            world.enemyShoot(e, nx, nz, e.def.bulletSpeed, e.def.bulletDamage);
          }
          break;
        }
        case 'orbit': {
          const R = e.def.orbitR;
          const ang = Math.atan2(e.z - player.z, e.x - player.x) + e.orbitDir * (speed / R) * dt;
          const tx = player.x + Math.cos(ang) * R;
          const tz = player.z + Math.sin(ang) * R;
          e.vx = (tx - e.x) / Math.max(dt, 1e-4) * 0.35;
          e.vz = (tz - e.z) / Math.max(dt, 1e-4) * 0.35;
          e.facing = ang + Math.PI / 2;
          break;
        }
        case 'boss_ring':
          this.steer(e, nx, nz, speed, dt);
          e.cd -= dt;
          if (e.cd <= 0) {
            e.cd = e.def.ringCd;
            world.bossRing(e, e.def.ringBullets, e.def.ringSpeed, e.def.bulletDamage ?? e.contactDamage * 0.6);
          }
          e.timer2 = (e.timer2 ?? 0) + dt;
          if (e.timer2 >= e.def.chargeCd) {
            e.timer2 = 0;
            e.dashT = 1.0;
            e.dashX = nx;
            e.dashZ = nz;
            world.juice.addTrauma(0.25);
            world.audio.boss();
          }
          if (e.dashT > 0) {
            e.dashT -= dt;
            e.vx = e.dashX * 15;
            e.vz = e.dashZ * 15;
          }
          break;
        case 'boss_frost':
          this.steer(e, nx, nz, speed, dt);
          e.cd -= dt;
          if (e.cd <= 0) {
            e.cd = e.def.ringCd;
            world.bossRing(e, e.def.ringBullets, e.def.ringSpeed, e.contactDamage * 0.55);
          }
          e.timer2 = (e.timer2 ?? 0) + dt;
          if (e.timer2 >= e.def.iceCd) {
            e.timer2 = 0;
            world.bossIce(e);
          }
          e.timer3 = (e.timer3 ?? 0) + dt;
          if (e.timer3 >= e.def.summonCd) {
            e.timer3 = 0;
            world.bossSummon(e, 'swarmling', 5);
          }
          break;
        case 'boss_void':
          this.steer(e, nx, nz, speed, dt);
          e.cd -= dt;
          if (e.cd <= 0) {
            e.cd = e.def.ringCd;
            world.bossSpiral(e, e.def.ringBullets, e.def.ringSpeed);
          }
          e.timer2 = (e.timer2 ?? 0) + dt;
          if (e.timer2 >= 1.0) {
            e.timer2 = 0;
            world.bossPull(e);
          }
          e.timer3 = (e.timer3 ?? 0) + dt;
          if (e.timer3 >= e.def.summonCd) {
            e.timer3 = 0;
            world.bossSummon(e, 'splitter', 3);
          }
          break;
        default:
          this.steer(e, nx, nz, speed, dt);
      }
    } else {
      e.vx *= 0.9;
      e.vz *= 0.9;
    }

    // knockback impulse decay
    e.x += (e.vx + e.knockX) * dt;
    e.z += (e.vz + e.knockZ) * dt;
    e.knockX *= Math.exp(-9 * dt);
    e.knockZ *= Math.exp(-9 * dt);

    // arena bounds (bosses clamp inside, others can be pushed out)
    const lim = ARENA.half + (e.boss ? 4 : 10);
    if (Math.abs(e.x) > lim) e.x = Math.sign(e.x) * lim;
    if (Math.abs(e.z) > lim) e.z = Math.sign(e.z) * lim;

    // contact damage
    if (canAct && player.alive && circleHit(e.x, e.z, e.radius, player.x, player.z, player.radius)) {
      const dealt = player.damage(e.contactDamage, e);
      if (dealt > 0) {
        e.knockX -= nx * e.mass * 2.6;
        e.knockZ -= nz * e.mass * 2.6;
        world.juice.addTrauma(clamp(dealt / 60, 0.1, 0.5));
      }
    }

    // status
    if (e.shockT > 0 && world.time % 0.25 < dt) {
      e.damage(e.maxHp * 0.012 * (1 + world.player.stats.get('damage')), 'shock', {
        color: [0.7, 0.6, 1],
        noCrit: true,
        silent: true,
      });
    }

    this.syncVisual(e, dt, t);
  }

  steer(e, nx, nz, speed, dt) {
    e.vx = damp(e.vx, nx * speed, 6, dt);
    e.vz = damp(e.vz, nz * speed, 6, dt);
    e.facing = Math.atan2(nz, nx);
  }

  syncVisual(e, dt, t) {
    const g = e.group;
    g.position.x = e.x;
    g.position.z = e.z;
    const bob = e.behavior === 'orbit' ? 0 : Math.sin(t * 4 + e.x * 0.7) * 0.09;
    g.position.y = e.baseY + bob + (e.freezeT > 0 ? -0.05 : 0);
    const spin = e.behavior === 'orbit' ? t * e.def.spin : 0;
    g.rotation.y = -e.facing + Math.PI / 2 + spin;
    if (e.mesh) {
      const s = 1 + e.scalePulse;
      g.scale.setScalar(s);
      e.mesh.rotation.x += dt * (e.boss ? 0.7 : 2.2);
      e.mesh.rotation.z += dt * (e.boss ? 0.4 : 1.1);
      // rim shader: drive hit flash and freeze through uniforms, not by
      // rewriting material.color each frame.
      const u = e.mesh.material.uniforms;
      if (u) {
        u.uFlash.value = Math.max(0, e.hitFlash);
        u.uFreeze.value = e.freezeT > 0 ? Math.min(1, e.freezeT * 2.5) : 0;
      }
    }
    if (e.detailMat?.uniforms) {
      const u = e.detailMat.uniforms;
      u.uFlash.value = Math.max(0, e.hitFlash);
      u.uFreeze.value = e.freezeT > 0 ? Math.min(1, e.freezeT * 2.5) : 0;
    }
    // orbiting decoration pieces
    if (e.detail) {
      for (const c of e.detail.children) {
        // only pieces that declared an orbit radius are repositioned; the rest
        // (plain rings, fins) just spin in place
        if (c.userData.orbit === undefined) continue;
        const a = c.userData.orbit + t * (e.boss ? 0.5 : 0.15);
        const r = c.userData.r;
        if (Number.isFinite(r)) {
          c.position.x = Math.cos(a) * r;
          c.position.z = Math.sin(a) * r;
        }
        c.position.y = (c.userData.baseY ?? c.position.y) + Math.sin(t * 1.6 + (c.userData.bob ?? 0)) * 0.35;
        c.rotation.y += dt * 1.4;
      }
    }
    if (e.halo) {
      e.halo.rotation.z += dt * 1.6;
      // The ring is only meaningful as a telegraph, so it is hidden otherwise.
      const bossRing = e.boss ? 0.26 + 0.1 * Math.sin(t * 3 + e.z) : 0;
      const frozenRing = e.freezeT > 0 && !e.boss ? 0.28 : 0;
      let k = 0;
      if (e.behavior === 'dasher' && e.state === 'telegraph') {
        k = clamp(e.timer / e.def.telegraph, 0, 1);
      }
      e.halo.material.opacity = Math.max(bossRing, frozenRing, k * 0.85);
      e.halo.scale.setScalar(1 + k * 1.8 + (e.boss ? 0.05 * Math.sin(t * 2) : 0));
    }
  }
}
