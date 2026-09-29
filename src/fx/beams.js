import * as THREE from 'three';

/**
 * Additive ribbon primitives used for lightning arcs, laser lances and
 * charge beams. Each instance owns a dynamic BufferGeometry rebuilt per frame.
 */

const MAX_SEGS = 8;

class Ribbon {
  constructor(scene, { segments = MAX_SEGS, color = [1, 1, 1], width = 0.2, fade = 1 }) {
    this.segments = segments;
    this.verts = new Float32Array((segments + 1) * 2 * 3);
    this.alphas = new Float32Array((segments + 1) * 2);
    const idx = [];
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.verts, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(color[0], color[1], color[2]) },
        uFade: { value: 1 },
        uFadePow: { value: fade },
      },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vA;
        void main() {
          vA = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uFade;
        uniform float uFadePow;
        varying float vA;
        void main() {
          float a = vA * pow(uFade, uFadePow);
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * (1.0 + a), a);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.geo = geo;
    this.width = width;
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  setColor(c) {
    this.mat.uniforms.uColor.value.setRGB(c[0], c[1], c[2]);
  }

  /**
   * points: array of THREE.Vector3 (2..segments+1). `sides` picks up-vector.
   */
  build(points, width, fade = 1) {
    const n = Math.min(points.length, this.segments + 1);
    const w = width * 0.5;
    const perp = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(n - 1, i + 1)];
      dir.subVectors(next, prev);
      if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
      dir.normalize();
      // billboard-ish: cross with camera up then camera right approximated by view
      perp.crossVectors(dir, this._up);
      if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
      perp.normalize();
      // expand to face the camera around the segment axis
      const wide = this._a.copy(perp).cross(dir).normalize().multiplyScalar(w);
      const o = i * 6;
      this.verts[o] = p.x + wide.x;
      this.verts[o + 1] = p.y + wide.y;
      this.verts[o + 2] = p.z + wide.z;
      this.verts[o + 3] = p.x - wide.x;
      this.verts[o + 4] = p.y - wide.y;
      this.verts[o + 5] = p.z - wide.z;
      const t = i / Math.max(1, n - 1);
      const a = 1 - t * 0.15;
      this.alphas[i * 2] = a;
      this.alphas[i * 2 + 1] = a;
    }
    // collapse unused
    for (let i = n; i <= this.segments; i++) {
      const o = i * 6;
      const src = (n - 1) * 6;
      for (let k = 0; k < 6; k++) this.verts[o + k] = this.verts[src + k];
      this.alphas[i * 2] = 0;
      this.alphas[i * 2 + 1] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.mat.uniforms.uFade.value = fade;
    this.mesh.visible = fade > 0.01;
  }

  hide() {
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * Pooled lightning / laser beams.
 */
export class BeamPool {
  constructor(scene, max = 16, color = [0.7, 0.6, 1]) {
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({
        ribbon: new Ribbon(scene, { segments: MAX_SEGS, color }),
        active: false,
        t: 0,
        dur: 0.18,
        points: Array.from({ length: MAX_SEGS + 1 }, () => new THREE.Vector3()),
        kind: 'bolt',
        width: 0.22,
        jitter: 0.5,
        seed: Math.random() * 100,
      });
    }
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
  }

  /** Jagged lightning between two points. */
  bolt(ax, ay, az, bx, by, bz, { color, width = 0.2, dur = 0.16, jitter = 0.55 } = {}) {
    const it = this.items.find((i) => !i.active);
    if (!it) return null;
    it.active = true;
    it.t = 0;
    it.dur = dur;
    it.kind = 'bolt';
    it.width = width;
    it.jitter = jitter;
    it.seed = Math.random() * 100;
    it.ax = ax; it.ay = ay; it.az = az;
    it.bx = bx; it.by = by; it.bz = bz;
    if (color) it.ribbon.setColor(color);
    return it;
  }

  /** Straight lance (railgun). */
  lance(ax, ay, az, bx, by, bz, { color, width = 0.5, dur = 0.22 } = {}) {
    const it = this.items.find((i) => !i.active);
    if (!it) return null;
    it.active = true;
    it.t = 0;
    it.dur = dur;
    it.kind = 'lance';
    it.width = width;
    it.jitter = 0;
    it.ax = ax; it.ay = ay; it.az = az;
    it.bx = bx; it.by = by; it.bz = bz;
    if (color) it.ribbon.setColor(color);
    return it;
  }

  update(dt, time) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) {
        it.active = false;
        it.ribbon.hide();
        continue;
      }
      const fade = Math.pow(1 - k, 1.6);
      if (it.kind === 'lance') {
        it.points[0].set(it.ax, it.ay, it.az);
        it.points[1].set(it.bx, it.by, it.bz);
        it.ribbon.build(it.points, it.width * (1 - k * 0.5), fade);
      } else {
        const dx = it.bx - it.ax;
        const dy = it.by - it.ay;
        const dz = it.bz - it.az;
        const len = Math.hypot(dx, dy, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        for (let i = 0; i <= MAX_SEGS; i++) {
          const t = i / MAX_SEGS;
          const j = i === 0 || i === MAX_SEGS ? 0 : 1;
          const s =
            Math.sin(time * 47 + it.seed + i * 2.7) * it.jitter +
            Math.sin(time * 31 + it.seed * 1.7 + i * 5.1) * it.jitter * 0.6;
          it.points[i].set(
            it.ax + dx * t + nx * s * j,
            it.ay + dy * t + s * j * 0.5,
            it.az + dz * t + nz * s * j,
          );
        }
        it.ribbon.build(it.points, it.width * (0.55 + fade * 0.7), fade);
      }
    }
  }

  clear() {
    for (const it of this.items) {
      it.active = false;
      it.ribbon.hide();
    }
  }
}
