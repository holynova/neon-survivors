import * as THREE from 'three';
import { QUALITY } from '../game/config.js';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aLife;      // 0..1 remaining
  attribute vec3  aColor;
  attribute float aSpin;
  varying float vLife;
  varying vec3  vColor;
  varying float vSpin;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uGravity;
  void main() {
    vLife = aLife;
    vColor = aColor;
    vSpin = aSpin;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float s = aSize * (0.25 + 0.75 * aLife);
    gl_PointSize = s * uPixelRatio * (300.0 / max(-mv.z, 0.001));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying float vLife;
  varying vec3  vColor;
  varying float vSpin;
  uniform int   uShape;   // 0 = soft dot, 1 = spark streak, 2 = ring
  uniform float uTime;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float a;
    if (uShape == 1) {
      // streak: elongated along rotated axis
      float c = cos(vSpin), s = sin(vSpin);
      vec2 p = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
      p.x *= 0.28;
      float dd = length(p);
      a = smoothstep(0.5, 0.03, dd);
      a *= smoothstep(0.0, 0.35, vLife);
    } else if (uShape == 2) {
      a = smoothstep(0.5, 0.42, d) * smoothstep(0.24, 0.34, d);
    } else {
      a = smoothstep(0.5, 0.0, d);
      a = pow(a, 1.6);
      a *= smoothstep(0.0, 0.22, vLife);
    }
    if (a < 0.004) discard;
    float boost = 0.65 + 0.85 * vLife;
    gl_FragColor = vec4(vColor * boost, a);
  }
`;

/**
 * A single Points system holding up to `max` particles.
 * CPU simulates (simple, flexible), GPU renders. Attributes uploaded once per frame.
 */
export class ParticleSystem {
  constructor(scene, {
    max = QUALITY.particles.high,
    shape = 0,
    blending = THREE.AdditiveBlending,
    depthWrite = false,
    name = 'particles',
  } = {}) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.life = new Float32Array(max);
    this.lifeMax = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.spin = new Float32Array(max);
    this.spinV = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.bounce = new Uint8Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    geo.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uGravity: { value: 0 },
        uShape: { value: shape },
      },
      transparent: true,
      depthWrite,
      depthTest: true,
      blending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.name = name;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = geo;
    this._dirty = false;
  }

  setPixelRatio(r) {
    this.material.uniforms.uPixelRatio.value = r;
  }

  setShape(shape) {
    this.material.uniforms.uShape.value = shape;
  }

  emit(o) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    const i3 = i * 3;
    // a NaN here would poison the whole buffer (and everything swapped into it)
    const n = (v, d = 0) => (Number.isFinite(v) ? v : d);
    this.pos[i3] = n(o.x);
    this.pos[i3 + 1] = n(o.y);
    this.pos[i3 + 2] = n(o.z);
    this.vel[i3] = n(o.vx);
    this.vel[i3 + 1] = n(o.vy);
    this.vel[i3 + 2] = n(o.vz);
    const c = o.color || [1, 1, 1];
    this.color[i3] = n(c[0], 1);
    this.color[i3 + 1] = n(c[1], 1);
    this.color[i3 + 2] = n(c[2], 1);
    const dur = Number.isFinite(o.life) && o.life > 0.02 ? o.life : 0.6;
    const sz = Number.isFinite(o.size) && o.size > 0 ? o.size : 1;
    this.size[i] = sz;
    this.size0[i] = sz;
    this.life[i] = 1;
    this.lifeMax[i] = dur;
    this.spin[i] = n(o.spin);
    this.spinV[i] = n(o.spinV);
    this.drag[i] = Number.isFinite(o.drag) ? o.drag : 1.6;
    this.grav[i] = n(o.gravity);
    this.bounce[i] = o.bounce ? 1 : 0;
    this._dirty = true;
    return i;
  }

  update(dt, time = 0) {
    this.material.uniforms.uTime.value = time;
    if (this.count === 0) {
      if (this._dirty) {
        this.geo.setDrawRange(0, 0);
        this._dirty = false;
      }
      return;
    }
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt / this.lifeMax[i];
      if (this.life[i] <= 0) {
        this._swapDown(i, --n);
        i--;
        continue;
      }
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 2] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.03) {
        if (this.bounce[i]) {
          this.pos[i3 + 1] = 0.03;
          this.vel[i3 + 1] = Math.abs(this.vel[i3 + 1]) * 0.42;
          this.vel[i3] *= 0.7;
          this.vel[i3 + 2] *= 0.7;
        } else {
          this.pos[i3 + 1] = 0.03;
          this.vel[i3 + 1] = 0;
        }
      }
      this.spin[i] += this.spinV[i] * dt;
      // fade size toward a fraction as life ends for a snappier look
      this.size[i] = this.size0[i] * (0.35 + 0.65 * this.life[i]);
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSpin.needsUpdate = true;
    this._dirty = false;
  }

  _swapDown(i, j) {
    if (i === j) return;
    const i3 = i * 3;
    const j3 = j * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[j3 + k];
      this.vel[i3 + k] = this.vel[j3 + k];
      this.color[i3 + k] = this.color[j3 + k];
    }
    this.size[i] = this.size[j];
    this.size0[i] = this.size0[j];
    this.life[i] = this.life[j];
    this.lifeMax[i] = this.lifeMax[j];
    this.spin[i] = this.spin[j];
    this.spinV[i] = this.spinV[j];
    this.drag[i] = this.drag[j];
    this.grav[i] = this.grav[j];
    this.bounce[i] = this.bounce[j];
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }
}

/**
 * All particle emitters used by the game, grouped by visual role.
 */
export class FX {
  constructor(scene, quality = 'high') {
    const budget = QUALITY.particles[quality] ?? QUALITY.particles.high;
    const split = (f) => Math.max(256, Math.floor(budget * f));
    this.quality = quality;
    this.spark = new ParticleSystem(scene, { max: split(0.3), shape: 1, name: 'fx-spark' });
    this.glow = new ParticleSystem(scene, { max: split(0.16), shape: 0, name: 'fx-glow' });
    this.smoke = new ParticleSystem(scene, {
      max: split(0.2),
      shape: 0,
      blending: THREE.NormalBlending,
      name: 'fx-smoke',
    });
    this.shard = new ParticleSystem(scene, {
      max: split(0.2),
      shape: 2,
      blending: THREE.NormalBlending,
      name: 'fx-shard',
    });
    this.ring = new ParticleSystem(scene, { max: split(0.06), shape: 2, name: 'fx-ring' });
    this.trail = new ParticleSystem(scene, { max: split(0.08), shape: 1, name: 'fx-trail' });
    this.all = [this.spark, this.glow, this.smoke, this.shard, this.ring, this.trail];
  }

  setPixelRatio(r) {
    for (const p of this.all) p.setPixelRatio(r);
  }

  update(dt, time) {
    for (const p of this.all) p.update(dt, time);
  }

  clear() {
    for (const p of this.all) p.clear();
  }

  // ---- authored effects -------------------------------------------------

  hitSparks(x, y, z, dirX, dirZ, color, power = 1) {
    const n = Math.round(8 + 10 * power);
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dirZ, dirX) + (Math.random() - 0.5) * 2.0;
      const sp = (3 + Math.random() * 9) * (0.7 + power * 0.5);
      this.spark.emit({
        x, y, z,
        vx: Math.cos(a) * sp,
        vy: 1.6 + Math.random() * 5,
        vz: Math.sin(a) * sp,
        color,
        size: (0.16 + Math.random() * 0.2) * (1 + power * 0.5),
        life: 0.16 + Math.random() * 0.26,
        drag: 3.4,
        gravity: 9,
        spin: a,
        spinV: (Math.random() - 0.5) * 8,
      });
    }
    this.glow.emit({
      x, y, z,
      color: [color[0] * 1.4, color[1] * 1.4, color[2] * 1.4],
      size: 0.6 * power,
      life: 0.11,
      drag: 0,
    });
  }

  deathBurst(x, y, z, color, scale = 1, rng = Math.random) {
    const shards = Math.round(16 * scale);
    for (let i = 0; i < shards; i++) {
      const a = rng() * Math.PI * 2;
      const sp = (4 + rng() * 8) * scale;
      this.shard.emit({
        x, y: y + rng() * 0.6, z,
        vx: Math.cos(a) * sp,
        vy: 3 + rng() * 6,
        vz: Math.sin(a) * sp,
        color,
        size: (0.2 + rng() * 0.34) * scale,
        life: 0.5 + rng() * 0.6,
        drag: 1.8,
        gravity: 13,
        bounce: true,
        spin: a,
        spinV: (rng() - 0.5) * 14,
      });
    }
    for (let i = 0; i < Math.round(10 * scale); i++) {
      const a = rng() * Math.PI * 2;
      const sp = (2 + rng() * 6) * scale;
      this.spark.emit({
        x, y, z,
        vx: Math.cos(a) * sp,
        vy: 2 + rng() * 7,
        vz: Math.sin(a) * sp,
        color,
        size: (0.14 + rng() * 0.24) * scale,
        life: 0.3 + rng() * 0.4,
        drag: 2.2,
        gravity: 11,
        spin: a,
        spinV: (rng() - 0.5) * 10,
      });
    }
    this.ring.emit({
      x, y: 0.06, z,
      color: [color[0] * 1.5, color[1] * 1.5, color[2] * 1.5],
      size: 1.2 * scale,
      life: 0.3,
      drag: 0,
    });
    this.glow.emit({
      x, y: y + 0.3, z,
      color: [1, 1, 1],
      size: 2.4 * scale,
      life: 0.16,
      drag: 0,
    });
  }

  muzzleFlash(x, y, z, dirX, dirZ, color, scale = 1) {
    for (let i = 0; i < 5; i++) {
      const spread = (Math.random() - 0.5) * 0.7;
      const dx = dirX * Math.cos(spread) - dirZ * Math.sin(spread);
      const dz = dirX * Math.sin(spread) + dirZ * Math.cos(spread);
      const sp = 6 + Math.random() * 12;
      this.spark.emit({
        x, y, z,
        vx: dx * sp,
        vy: (Math.random() - 0.2) * 3,
        vz: dz * sp,
        color,
        size: (0.14 + Math.random() * 0.2) * scale,
        life: 0.08 + Math.random() * 0.1,
        drag: 5,
        spin: Math.atan2(dz, dx),
        spinV: 0,
      });
    }
    this.glow.emit({
      x: x + dirX * 0.3, y, z: z + dirZ * 0.3,
      color: [color[0] * 1.7, color[1] * 1.7, color[2] * 1.7],
      size: 0.85 * scale,
      life: 0.07,
      drag: 0,
    });
  }

  explosion(x, y, z, radius, color, rng = Math.random) {
    const scale = radius / 2.2;
    this.ring.emit({
      x, y: 0.07, z,
      color: [color[0] * 1.6, color[1] * 1.6, color[2] * 1.6],
      size: radius * 1.5,
      life: 0.36,
      drag: 0,
    });
    for (let i = 0; i < Math.round(26 * scale); i++) {
      const a = rng() * Math.PI * 2;
      const el = rng() * 0.7;
      const sp = (5 + rng() * 16) * scale;
      this.spark.emit({
        x, y: y + rng() * 0.5, z,
        vx: Math.cos(a) * sp * Math.cos(el),
        vy: (2 + rng() * 9) * scale,
        vz: Math.sin(a) * sp * Math.cos(el),
        color,
        size: (0.18 + rng() * 0.3) * scale,
        life: 0.3 + rng() * 0.45,
        drag: 2.6,
        gravity: 12,
        spin: a,
        spinV: (rng() - 0.5) * 12,
      });
    }
    for (let i = 0; i < Math.round(12 * scale); i++) {
      const a = rng() * Math.PI * 2;
      const sp = (1.5 + rng() * 5) * scale;
      this.smoke.emit({
        x, y: 0.3 + rng() * 0.6, z,
        vx: Math.cos(a) * sp,
        vy: 1 + rng() * 2.2,
        vz: Math.sin(a) * sp,
        color: [color[0] * 0.35, color[1] * 0.3, color[2] * 0.32],
        size: (0.6 + rng() * 1.1) * scale,
        life: 0.5 + rng() * 0.7,
        drag: 1.6,
        gravity: -0.6,
        spin: rng() * 6,
        spinV: (rng() - 0.5) * 2,
      });
    }
    this.glow.emit({
      x, y: y + 0.4, z,
      color: [color[0] * 2, color[1] * 2, color[2] * 2],
      size: 2.6 * scale,
      life: 0.18,
      drag: 0,
    });
  }

  shockRing(x, z, radius, color, life = 0.4, y = 0.07) {
    this.ring.emit({ x, y, z, color, size: radius * 2, life, drag: 0 });
  }

  trailPuff(x, y, z, color, size = 0.28, life = 0.22) {
    this.trail.emit({
      x, y, z,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.2) * 0.5,
      vz: (Math.random() - 0.5) * 0.6,
      color,
      size,
      life,
      drag: 3,
    });
  }

  dust(x, z, r, color = [0.5, 0.5, 0.6], n = 6, speed = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit({
        x: x + Math.cos(a) * r, y: 0.1, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * speed * (0.4 + Math.random()),
        vy: 0.6 + Math.random() * 1.4,
        vz: Math.sin(a) * speed * (0.4 + Math.random()),
        color,
        size: 0.35 + Math.random() * 0.5,
        life: 0.32 + Math.random() * 0.4,
        drag: 3,
        gravity: -0.3,
        spin: Math.random() * 6,
        spinV: (Math.random() - 0.5) * 3,
      });
    }
  }

  levelUp(x, y, z, color = [0.6, 0.9, 1]) {
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const sp = 8 + Math.random() * 6;
      this.glow.emit({
        x, y: y + 0.3, z,
        vx: Math.cos(a) * sp,
        vy: 4 + Math.random() * 8,
        vz: Math.sin(a) * sp,
        color,
        size: 0.3 + Math.random() * 0.4,
        life: 0.6 + Math.random() * 0.5,
        drag: 2.2,
        gravity: 4,
      });
    }
    this.ring.emit({ x, y: 0.08, z, color: [color[0] * 1.8, color[1] * 1.8, color[2] * 1.8], size: 5, life: 0.55, drag: 0 });
    this.shockRing(x, z, 4, [1, 1, 1], 0.6);
  }

  /**
   * Frost motes. `count` is a budget knob: high-rate weapons must pass a small
   * number, because these land in the additive `glow` system and overlapping
   * sprites saturate to a flat white blob that hides the player.
   */
  frost(x, y, z, color, count = 6) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.glow.emit({
        x, y: y + Math.random() * 0.8, z,
        vx: Math.cos(a) * (1 + Math.random() * 2),
        vy: -0.6 - Math.random() * 1.2,
        vz: Math.sin(a) * (1 + Math.random() * 2),
        color,
        size: 0.18 + Math.random() * 0.2,
        life: 0.34 + Math.random() * 0.26,
        drag: 2,
        spin: Math.random() * 6,
        spinV: (Math.random() - 0.5) * 4,
      });
    }
  }
}
