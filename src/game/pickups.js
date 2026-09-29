import * as THREE from 'three';
import { ARENA, XP } from './config.js';
import { PICKUP_AUTOMAGNET } from './stats.js';
import { clamp } from '../core/math.js';

const TYPE_COLOR = {
  xp: new THREE.Color('#5ff2ff'),
  coin: new THREE.Color('#ffd166'),
  heal: new THREE.Color('#4dff9d'),
  magnet: new THREE.Color('#ff6ec7'),
  bomb: new THREE.Color('#ff5a2b'),
  chest: new THREE.Color('#ffb13b'),
};

/**
 * Drop pickups with magnet attraction. Uses one InstancedMesh (octahedra) for
 * all gem types plus a per-type glow sprite.
 */
export class PickupSystem {
  constructor(world, max = 900) {
    this.world = world;
    this.items = [];
    this.max = max;
    const geo = new THREE.OctahedronGeometry(0.32, 0);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    world.scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  spawn(type, x, z, value = 1) {
    if (this.items.length >= this.max) {
      // recycle the oldest xp gem
      const idx = this.items.findIndex((i) => i.type === 'xp');
      if (idx >= 0) this.items.splice(idx, 1);
      else return null;
    }
    const it = {
      type,
      x,
      y: 0.7,
      z,
      value,
      vx: (Math.random() - 0.5) * 3,
      vy: 2.6 + Math.random() * 2,
      vz: (Math.random() - 0.5) * 3,
      t: 0,
      life: 26,
      spin: Math.random() * 6.28,
      attracted: false,
      radius: type === 'coin' ? 0.3 : 0.34,
    };
    this.items.push(it);
    return it;
  }

  burstXp(x, z, value) {
    // split large xp into gems for a satisfying pop
    const idx = XP.gemValue.findLastIndex((v) => v <= value);
    const gemValue = idx >= 0 ? XP.gemValue[idx] : 1;
    let left = value;
    let guard = 0;
    while (left > 0 && guard++ < 24) {
      const v = Math.min(gemValue, left);
      left -= v;
      const it = this.spawn('xp', x, z, v);
      if (it) {
        const a = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 3.5;
        it.vx = Math.cos(a) * sp;
        it.vz = Math.sin(a) * sp;
        it.vy = 3 + Math.random() * 2.4;
      }
    }
  }

  clear() {
    this.items.length = 0;
    this.mesh.count = 0;
  }

  update(dt, player, world) {
    const magR = player.pickupRange;
    const magSpeed = player.stats.get('magnetSpeed');
    const attract = (it) => {
      const dx = player.x - it.x;
      const dz = player.z - it.z;
      const d = Math.hypot(dx, dz);
      // XP gems always home in once close, so levelling never depends on
      // pixel-perfect pickup walking.
      const range = it.type === 'xp' ? Math.max(magR, PICKUP_AUTOMAGNET) : magR;
      if (d < range || it.attracted) {
        it.attracted = true;
        const k = clamp(6 + (18 / Math.max(d, 0.35)) * magSpeed, 5, 42);
        it.vx = damp(it.vx, (dx / Math.max(d, 1e-4)) * k, 6, dt);
        it.vz = damp(it.vz, (dz / Math.max(d, 1e-4)) * k, 6, dt);
      } else {
        it.vx *= Math.exp(-3.4 * dt);
        it.vz *= Math.exp(-3.4 * dt);
      }
    };

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      if (it.t > it.life) {
        this.items.splice(i, 1);
        continue;
      }
      it.vy -= 16 * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;
      if (it.y < 0.32) {
        it.y = 0.32;
        it.vy *= -0.34;
        it.vx *= 0.7;
        it.vz *= 0.7;
      }
      it.spin += dt * 3.4;
      attract(it);

      const d = Math.hypot(player.x - it.x, player.z - it.z);
      if (d < 0.85 && player.alive) {
        if (this.collect(it, player, world)) {
          this.items.splice(i, 1);
          continue;
        }
      }
    }
    this._render(dt);
  }

  collect(it, player, world) {
    switch (it.type) {
      case 'xp':
        player.addXp(it.value);
        world.audio.pickup();
        world.fx.trailPuff(it.x, it.y, it.z, [0.4, 0.95, 1], 0.4, 0.22);
        return true;
      case 'coin':
        world.addGold(it.value);
        world.audio.coin();
        world.floaters.spawn(it.x, 1.2, it.z, `+${it.value}`, 'coin');
        return true;
      case 'heal':
        player.heal(it.value);
        world.fx.shockRing(it.x, it.z, 2, [0.3, 1, 0.5], 0.4);
        return true;
      case 'magnet':
        for (const o of this.items) o.attracted = true;
        world.floaters.spawn(player.x, 2.6, player.z, '磁力全开', 'xp');
        world.fx.shockRing(player.x, player.z, 14, [1, 0.4, 0.8], 0.7);
        world.audio.levelUp();
        return true;
      case 'bomb':
        for (const e of world.enemies.list) {
          if (!e.alive) continue;
          const d = Math.hypot(e.x - it.x, e.z - it.z);
          if (d < 14) {
            e.damage(60 * (1 - d / 14), 'blast', { color: [1, 0.5, 0.2], noCrit: true });
            world.fx.explosion(e.x, e.baseY, e.z, 1.6, [1, 0.5, 0.2]);
          }
        }
        world.juice.addTrauma(0.5);
        world.juice.screenFlash('#ff8a3b', 0.35, 0.3);
        world.audio.explosion(1.5);
        return true;
      default:
        return true;
    }
  }

  _render(dt) {
    const t = this.world.time;
    const n = Math.min(this.items.length, this.max);
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      const bob = Math.sin(t * 3 + it.spin) * 0.12;
      const s = it.type === 'coin' ? 0.85 : 1;
      this._p.set(it.x, it.y + bob, it.z);
      this._e.set(it.spin * 0.7, it.spin, 0);
      this._q.setFromEuler(this._e);
      this._s.set(s, s, s);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      const c = TYPE_COLOR[it.type] ?? TYPE_COLOR.xp;
      const fade = it.t > it.life - 3 ? (Math.sin(t * 16) * 0.5 + 0.5) * 0.7 + 0.3 : 1;
      this.mesh.instanceColor.setXYZ(i, c.r * 1.8 * fade, c.g * 1.8 * fade, c.b * 1.8 * fade);
    }
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  get count() {
    return this.items.length;
  }
}

function damp(a, b, lambda, dt) {
  return b + (a - b) * Math.exp(-lambda * dt);
}

export { TYPE_COLOR };
