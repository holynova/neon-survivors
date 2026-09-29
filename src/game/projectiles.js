import * as THREE from 'three';
import { circleHit, circleOverlapArea, segmentHitsCircle, sweepCircle } from './collision.js';
import { computeDamage, falloff } from './stats.js';
import { clamp, dist } from '../core/math.js';

/**
 * Projectile system: bullets, tesla bolts, grenades, missiles, and enemy bullets.
 * Each projectile owns a small mesh from a shared pool.
 */

const MAX = 900;

export class ProjectileSystem {
  constructor(world) {
    this.world = world;
    this.items = [];
    this.freeMeshes = [];

    // shared geometry set
    this.geoBullet = new THREE.SphereGeometry(0.5, 8, 6);
    this.geoBolt = new THREE.SphereGeometry(0.5, 8, 6);
    this.geoMissile = new THREE.ConeGeometry(0.34, 1.1, 6);
    this.geoOrb = new THREE.IcosahedronGeometry(0.5, 0);
    this.geoGrenade = new THREE.IcosahedronGeometry(0.5, 0);
    this.geoEnemy = new THREE.SphereGeometry(0.5, 8, 6);

    this.meshPool = [];
    for (let i = 0; i < MAX; i++) {
      this.meshPool.push(this._makeMesh());
    }
    this.meshes = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 0),
      new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      MAX,
    );
    this.meshes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.meshes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.meshes.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.meshes.frustumCulled = false;
    this.meshes.count = 0;
    world.scene.add(this.meshes);
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  _makeMesh() {
    const m = new THREE.Mesh(this.geoBullet, new THREE.MeshBasicMaterial({ toneMapped: false }));
    m.visible = false;
    this.world.scene.add(m);
    return m;
  }

  _acquire() {
    return this.meshPool.pop() ?? this._makeMesh();
  }

  _releaseMesh(m) {
    m.visible = false;
    this.freeMeshes.push(m);
  }

  spawn(cfg) {
    const p = {
      kind: 'bullet',
      owner: 'player',
      x: 0, y: 1, z: 0,
      vx: 0, vy: 0, vz: 0,
      angle: 0,
      speed: 30,
      damage: 10,
      life: 1,
      radius: 0.3,
      knock: 0,
      color: [1, 1, 1],
      pierce: 0,
      hit: new Set(),
      bounces: 0,
      decay: 1,
      stun: 0,
      slow: 0,
      slowDur: 0,
      explode: null,
      fuse: 0,
      arc: 0,
      height: 0,
      turn: 0,
      accel: 0,
      target: null,
      maxAir: 6,
      tracer: false,
      canCrit: true,
      critStats: false,
      weapon: null,
      mesh: null,
      spin: Math.random() * 6.28,
      ...cfg,
    };
    this.items.push(p);
    return p;
  }

  clear() {
    for (const p of this.items) if (p.mesh) this._releaseMesh(p.mesh);
    this.items.length = 0;
    this.meshes.count = 0;
  }

  update(dt, world) {
    const enemies = world.enemies;
    const player = world.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      p.spin += dt * 8;

      // Remember where we started this step so the swept hit test below has a
      // real segment to work with.
      p.prevX = p.x;
      p.prevZ = p.z;

      let dead = p.life <= 0;

      // kind-specific motion
      switch (p.kind) {
        case 'bullet':
          p.x += p.vx * dt;
          p.z += p.vz * dt;
          break;
        case 'bolt': {
          const step = p.speed * dt;
          p.x += p.vx * dt;
          p.z += p.vz * dt;
          this._boltSparks(p, step, world);
          break;
        }
        // (all other kinds advance below in the shared integration block)
        case 'grenade': {
          p.vy -= 22 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          if (p.y <= 0.25) {
            p.y = 0.25;
            p.vy = 0;
            p.landed = true;
            p.fuse -= dt;
            if (p.fuse <= 0) dead = true;
          }
          break;
        }
        case 'missile': {
          // steer toward target
          if (p.target && p.target.alive) {
            const ta = Math.atan2(p.target.z - p.z, p.target.x - p.x);
            const cur = Math.atan2(p.vz, p.vx);
            const diff = ((ta - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
            const na = cur + clamp(diff, -p.turn * dt, p.turn * dt);
            const sp = Math.hypot(p.vx, p.vz);
            const target = Math.min(sp + p.accel * dt, 42);
            p.vx = Math.cos(na) * target;
            p.vz = Math.sin(na) * target;
          }
          p.x += p.vx * dt;
          p.z += p.vz * dt;
          p.height += dt * 1.4;
          world.fx.trailPuff(p.x, p.height, p.z, p.color, 0.34, 0.24);
          if (world.effectsOn && Math.random() < 0.7) {
            world.fx.smoke.emit({
              x: p.x, y: p.height, z: p.z,
              vx: (Math.random() - 0.5), vy: 0.6, vz: (Math.random() - 0.5),
              color: [0.3, 0.28, 0.3], size: 0.5, life: 0.5, drag: 2,
            });
          }
          break;
        }
        case 'orbit':
          break;
        default:
          p.x += p.vx * dt;
          p.z += p.vz * dt;
      }

      if (!dead) dead = this._collide(p, world, enemies, player, dt);

      if (dead) {
        this._onExpire(p, world);
        this.items.splice(i, 1);
        if (p.mesh) this._releaseMesh(p.mesh);
      }
    }
    this._render(dt);
  }

  _boltSparks(p, step, world) {
    if (world.effectsOn) {
      for (let k = 0; k < 2; k++) {
        const back = Math.random() * step;
        const l = Math.hypot(p.vx, p.vz) || 1;
        world.fx.trail.emit({
          x: p.x - (p.vx / l) * back,
          y: p.y - (p.vy / l) * back,
          z: p.z - (p.vz / l) * back,
          vx: (Math.random() - 0.5) * 3,
          vy: Math.random() * 2,
          vz: (Math.random() - 0.5) * 3,
          color: p.color,
          size: 0.3,
          life: 0.16,
          drag: 4,
        });
      }
    }
  }

  _collide(p, world, enemies, player) {
    if (p.owner === 'enemy') {
      if (player.alive && circleHit(p.x, p.z, p.radius, player.x, player.z, player.radius)) {
        p.life = 0;
        return true;
      }
      // player shots can pop enemy bullets
      for (const b of this.items) {
        if (b.owner !== 'player' || b === p) continue;
        if (b.kind === 'bullet' && circleHit(b.x, b.z, b.radius, p.x, p.z, p.radius)) {
          world.fx.hitSparks(p.x, p.y, p.z, 1, 0, [1, 1, 1], 0.7);
          b.life = Math.min(b.life, 0.02);
          p.life = 0;
          return true;
        }
      }
      return false;
    }

    if (p.kind === 'grenade') return false;

    // find target
    if (p.target && !p.target.alive) p.target = null;
    if (p.kind === 'missile' && !p.target) {
      p.target = world.nearestEnemy(p.x, p.z, 26);
    }

    // Swept test from the previous position: a 130 u/s railgun covers ~2.2
    // units per frame and would otherwise tunnel straight through small targets.
    const list = enemies.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      if (p.hit.has(e)) continue;
      if (sweepCircle(p.prevX, p.prevZ, p.x, p.z, e.x, e.z, e.radius + p.radius) < 0) continue;
      this._hitEnemy(p, e, world);
      p.hit.add(e);
      if (p.kind === 'bolt' && p.bounces > 0) {
        p.bounces--;
        p.damage *= p.decay;
        const next = world.nearestEnemy(
          e.x + p.vx * 0.6,
          e.z + p.vz * 0.6,
          9,
          (o) => o.alive && !p.hit.has(o),
        );
        if (next) {
          p.x = e.x;
          p.z = e.z;
          p.y = e.baseY;
          const a = Math.atan2(next.z - e.z, next.x - e.x);
          p.vx = Math.cos(a) * p.speed;
          p.vz = Math.sin(a) * p.speed;
          world.beams.bolt(p.x, p.y, p.z, next.x, next.baseY, next.z, {
            color: p.color, width: 0.2, dur: 0.14, jitter: 0.4,
          });
          world.audio.zap();
        } else {
          p.life = 0;
        }
        return false;
      }
      if (p.pierce > 0) {
        p.pierce--;
        return false;
      }
      p.life = 0;
      return true;
    }
    return false;
  }

  _hitEnemy(p, e, world) {
    const stats = world.player.stats;
    const element = p.element ?? 'kinetic';
    const elemMul = world.player.elementDmg[element] ?? 1;
    const critSource = p.critStats === false ? null : stats;
    const res = computeDamage(p.damage, {
      multiplier: critSource ? 1 : 1,
      critChance: p.canCrit ? stats.get('critChance') : 0,
      critDamage: stats.get('critDamage'),
      rng: Math.random,
      variance: 0.1,
    });
    const dealt = e.damage(res.damage * elemMul, p.kind === 'grenade' ? 'blast' : 'projectile', {
      color: p.color,
      crit: res.crit,
      noCrit: p.noCrit,
      source: p,
    });
    // Direct hits must count toward the run's damage total, not just AoE and
    // kills — otherwise the HUD under-reports every non-explosive weapon.
    world.player.damageDealt += dealt;

    // lifesteal
    const ls = stats.get('lifesteal');
    if (ls > 0 && dealt > 0) world.player.heal(dealt * ls);

    world.fx.hitSparks(
      p.x,
      p.y,
      p.z,
      p.vx || Math.cos(p.angle),
      p.vz || Math.sin(p.angle),
      p.color,
      res.crit ? 1.5 : 1,
    );
    if (res.crit) {
      world.floaters.spawn(e.x, e.baseY + 1.4, e.z, `${Math.round(dealt)}!`, 'crit');
    } else {
      world.floaters.spawn(e.x, e.baseY + 1.2, e.z, `${Math.round(dealt)}`, 'dmg');
    }
    if (p.knock > 0) {
      const l = Math.hypot(p.vx, p.vz) || 1;
      const k = p.knock / Math.max(0.5, e.mass * 0.6);
      e.knockX += (p.vx / l) * k;
      e.knockZ += (p.vz / l) * k;
    }
    if (p.stun > 0) e.stunT = Math.max(e.stunT, p.stun * (world.player.rules.stunMul ?? 1));
    if (p.slow > 0) {
      e.slowT = Math.max(e.slowT, p.slowDur);
      e.slowMul = Math.min(e.slowMul, 1 - Math.min(0.85, p.slow + (world.player.rules.extraSlow ?? 0)));
    }
    if (p.kind === 'bolt') {
      world.beams.bolt(p.x, p.y, p.z, e.x, e.baseY, e.z, { color: p.color, width: 0.18, dur: 0.12, jitter: 0.35 });
    }
    if (p.explode) this.explode(p, world);
  }

  explode(p, world) {
    const radius = p.explode.radius;
    const color = p.explode.color ?? p.color;
    const list = world.enemies.list;
    const blastMul = world.player.rules.blastRadius ?? 1;
    const R = radius * blastMul;
    for (const e of list) {
      if (!e.alive) continue;
      const d = dist(e.x, e.z, p.x, p.z);
      if (d > R + e.radius) continue;
      const f = falloff(Math.max(0, d - e.radius), R);
      const res = computeDamage(p.explode.damage, {
        critChance: world.player.stats.get('critChance'),
        critDamage: world.player.stats.get('critDamage'),
        rng: Math.random,
        variance: 0.14,
        canCrit: !p.noCrit,
      });
      const dealt = e.damage(res.damage * f * (world.player.elementDmg[p.explode.element ?? 'fire'] ?? 1), 'blast', {
        color,
        crit: res.crit,
      });
      world.player.damageDealt += dealt;
      if (res.crit) world.floaters.spawn(e.x, e.baseY + 1.6, e.z, `${Math.round(dealt)}!`, 'crit');
      else if (d < R * 0.7) world.floaters.spawn(e.x, e.baseY + 1.3, e.z, `${Math.round(dealt)}`, 'dmg');
      const ls = world.player.stats.get('lifesteal');
      if (ls > 0 && dealt > 0) world.player.heal(dealt * ls);
      const l = Math.hypot(e.x - p.x, e.z - p.z) || 1;
      e.knockX += ((e.x - p.x) / l) * p.explode.knock * f;
      e.knockZ += ((e.z - p.z) / l) * p.explode.knock * f;
      e.hitFlash = 1;
    }
    world.fx.explosion(p.x, Math.max(0.3, p.y), p.z, R, color);
    world.shockRing(p.x, p.z, R * 1.1, color, 0.42);
    world.juice.addTrauma(0.3);
    world.juice.hitstop(world.loop, 0.05);
    world.audio.explosion(clamp(R / 3, 0.7, 1.6));
    world.decal.spawn({ x: p.x, z: p.z, r: R * 0.8, dur: 2.4, color: [color[0] * 0.4, color[1] * 0.3, color[2] * 0.25] });
  }

  _onExpire(p, world) {
    switch (p.kind) {
      case 'grenade':
        this.explode(
          {
            x: p.x,
            y: 0.4,
            z: p.z,
            explode: { radius: p.radius, damage: p.damage, knock: p.knock, color: p.color, element: 'fire' },
          },
          world,
        );
        break;
      case 'missile':
        this.explode(
          {
            x: p.x,
            y: 0.4,
            z: p.z,
            explode: { radius: p.radius, damage: p.damage, knock: p.knock, color: p.color, element: 'fire' },
          },
          world,
        );
        break;
      case 'railgun':
        if (p.explode) this.explode(p, world);
        break;
      case 'enemy':
        world.fx.hitSparks(p.x, p.y, p.z, p.vx, p.vz, p.color, 0.6);
        break;
      default:
        if (p.tracer) world.fx.trailPuff(p.x, p.y, p.z, p.color, 0.3, 0.16);
        break;
    }
  }

  _render(dt) {
    const n = Math.min(this.items.length, MAX);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = this.items[i];
      const s = p.kind === 'bullet' ? p.radius * (p.tracer ? 0.85 : 1.6) : p.radius * 2.2;
      let len = s;
      let tilt = 0;
      let roll = p.spin;
      if (p.kind === 'grenade') len = p.radius * 2;
      if (p.kind === 'missile') {
        const a = Math.atan2(p.vz, p.vx);
        this._e.set(0, -a, Math.PI / 2);
        len = 1.5;
      } else {
        const a = Math.atan2(p.vz, p.vx);
        this._e.set(0, -a, 0);
      }
      this._q.setFromEuler(this._e);
      this._p.set(p.x, p.y ?? 1, p.z);
      this._s.set(s, s, len);
      this._m.compose(this._p, this._q, this._s);
      this.meshes.setMatrixAt(k, this._m);
      const boost = p.kind === 'railgun' ? 2.4 : 1.6;
      this.meshes.instanceColor.setXYZ(k, p.color[0] * boost, p.color[1] * boost, p.color[2] * boost);
      k++;
    }
    this.meshes.count = k;
    if (k > 0) {
      this.meshes.instanceMatrix.needsUpdate = true;
      this.meshes.instanceColor.needsUpdate = true;
    }
  }

  get count() {
    return this.items.length;
  }
}

export { MAX };
