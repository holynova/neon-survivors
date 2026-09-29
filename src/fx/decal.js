import * as THREE from 'three';

/**
 * Pooled expanding ground rings (shockwaves) rendered additively on the arena floor.
 */
export class ShockwavePool {
  constructor(scene, max = 48) {
    const geo = new THREE.RingGeometry(0.55, 1, 64, 1);
    geo.rotateX(-Math.PI / 2);
    this.colorUniform = new THREE.Color(1, 1, 1);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uOpacity: { value: 1 },
        uColor: { value: this.colorUniform },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0);
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        varying vec2 vUv;
        void main() {
          float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
          float inner = smoothstep(0.55, 1.0, vUv.y);
          float a = edge * mix(0.35, 1.0, inner) * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor * (0.6 + 0.8 * inner), a);
        }
      `,
    });
    this.mat.defines = { USE_INSTANCING_COLOR: '' };

    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
    const colors = new Float32Array(max * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({ active: false, x: 0, z: 0, y: 0.07, r0: 0, r1: 1, t: 0, dur: 0.4, w: 0.2, color: new THREE.Color(), fade: 1 });
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  spawn({ x, z, r0 = 0.4, r1 = 6, dur = 0.42, y = 0.07, width = 0.35, color = [1, 1, 1] }) {
    const it = this.items.find((i) => !i.active);
    if (!it) return null;
    it.active = true;
    it.x = x;
    it.z = z;
    it.y = y;
    it.r0 = r0;
    it.r1 = r1;
    it.dur = dur;
    it.t = 0;
    it.width = width;
    it.color.setRGB(color[0], color[1], color[2]);
    return it;
  }

  update(dt) {
    let n = 0;
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      if (it.t >= it.dur) {
        it.active = false;
        continue;
      }
      const k = it.t / it.dur;
      const e = 1 - Math.pow(1 - k, 2.4);
      const r = it.r0 + (it.r1 - it.r0) * e;
      const a = Math.pow(1 - k, 1.7);
      this._p.set(it.x, it.y, it.z);
      this._q.identity();
      this._s.set(r, 1, r * (1 + it.width * 0.55));
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      // additive blend: fading the colour is the alpha
      this.mesh.instanceColor.setXYZ(n, it.color.r * a, it.color.g * a, it.color.b * a);
      n++;
    }
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    for (const it of this.items) it.active = false;
    this.mesh.count = 0;
  }
}

/**
 * Flat ground decals: frost patches, scorch marks, telegraph zones.
 */
export class DecalPool {
  constructor(scene, max = 64) {
    const geo = new THREE.CircleGeometry(1, 24);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.5,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({ active: false, x: 0, z: 0, r: 1, t: 0, dur: 1, color: new THREE.Color(), y: 0.05 });
    }
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  spawn({ x, z, r = 2, dur = 3, color = [0.4, 0.8, 1], y = 0.05 }) {
    let it = this.items.find((i) => !i.active);
    if (!it) it = this.items.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    it.active = true;
    it.x = x;
    it.z = z;
    it.r = r;
    it.t = 0;
    it.dur = dur;
    it.color.setRGB(color[0], color[1], color[2]);
    it.y = y;
  }

  update(dt) {
    let n = 0;
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      if (it.t >= it.dur) {
        it.active = false;
        continue;
      }
      const k = it.t / it.dur;
      const a = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (1 - k * k);
      const r = it.r * (0.9 + 0.14 * k);
      this._p.set(it.x, it.y, it.z);
      this._q.identity();
      this._s.set(r, 1, r);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this.mesh.instanceColor.setXYZ(n, it.color.r * a, it.color.g * a, it.color.b * a);
      n++;
    }
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    for (const it of this.items) it.active = false;
    this.mesh.count = 0;
  }
}
