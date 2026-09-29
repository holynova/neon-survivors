import * as THREE from 'three';

/**
 * Rim-lit material for enemies.
 *
 * A top-down neon arena gives enemies almost no key light, so flat shaded
 * geometry dissolves into the grid floor. A fresnel rim gives every enemy a
 * bright silhouette edge that reads instantly against any background, and it
 * carries the type colour so silhouette and colour reinforce each other.
 *
 * Enemies are few enough (<200) that uniform-per-enemy is cheaper than the
 * complexity of real instancing.
 */
export function makeEnemyMaterial({ color, elite = false, boss = false, small = false }) {
  const base = new THREE.Color(color);
  return new THREE.ShaderMaterial({
    uniforms: {
      // Small bodies get a brighter base: at this camera distance a dim small
      // sprite reads as a dark smudge rather than a coloured enemy.
      uBase: { value: base.clone().multiplyScalar(boss ? 0.22 : small ? 0.5 : elite ? 0.34 : 0.32) },
      uRim: { value: base.clone() },
      uEmissive: { value: base.clone() },
      uFlash: { value: 0 },
      uFreeze: { value: 0 },
      // How hard a hit blows the body to white. A boss is under constant fire,
      // so a full-strength flash would keep the whole screen washed out.
      uFlashStrength: { value: boss ? 0.35 : elite ? 0.6 : 0.85 },
      uRimPower: { value: boss ? 2.6 : elite ? 2.0 : 2.5 },
      // A boss fills a large part of the screen; a strong rim over that much
      // area saturates to a white blob, so pull it back and lean on silhouette.
      uRimStrength: { value: boss ? 0.85 : elite ? 1.3 : 1.1 },
      uEmissiveStrength: { value: boss ? 0.3 : elite ? 0.55 : 0.38 },
      uLightDir: { value: new THREE.Vector3(0.5, 0.85, 0.3).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = cameraPosition - world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase;
      uniform vec3 uRim;
      uniform vec3 uEmissive;
      uniform float uFlash;
      uniform float uFlashStrength;
      uniform float uFreeze;
      uniform float uRimPower;
      uniform float uRimStrength;
      uniform float uEmissiveStrength;
      uniform vec3 uLightDir;

      varying vec3 vNormalW;
      varying vec3 vViewDir;

      void main() {
        vec3 n = normalize(vNormalW);
        vec3 v = normalize(vViewDir);

        float key = max(dot(n, normalize(uLightDir)), 0.0);
        float fill = max(dot(n, vec3(-0.4, 0.25, -0.7)), 0.0) * 0.35;

        // fresnel: 0 facing the camera, 1 at grazing angles
        float fres = pow(1.0 - max(dot(n, v), 0.0), uRimPower);

        vec3 col = uBase * (0.45 + key * 0.8 + fill);
        col += uRim * fres * uRimStrength;
        col += uEmissive * uEmissiveStrength;

        // hit flash blows the body white for a frame or two
        col = mix(col, vec3(1.7, 1.6, 1.5), clamp(uFlash, 0.0, 1.0) * uFlashStrength);

        // frozen enemies go pale blue and lose their rim
        vec3 frozen = mix(vec3(0.5, 0.74, 1.0), vec3(0.8, 0.95, 1.2), key);
        col = mix(col, frozen, clamp(uFreeze, 0.0, 1.0) * 0.82);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/**
 * Billboarded health bars for damaged/elite enemies.
 *
 * Uses a single InstancedMesh; the fill fraction rides in via `instanceColor.r`
 * and the shader clips the quad horizontally. 2 draw calls total (track + fill
 * share one mesh thanks to the shader branch).
 */
export class HealthBarPool {
  constructor(scene, max = 200) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0, 0); // pivot on the left edge so scaling fills left-to-right
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vTint;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING_COLOR
            vTint = instanceColor;
          #else
            vTint = vec3(1.0);
          #endif
          // billboard: build the basis from the view matrix instead of world
          mat4 mv = modelViewMatrix * instanceMatrix;
          vec3 pos = (modelViewMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
          // keep the quad camera-aligned by forcing view-space XY offsets
          pos.xy += vec2(0.0);
          gl_Position = projectionMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vTint;
        void main() {
          float fill = vTint.r;
          float a;
          if (vUv.y > 0.58) {
            a = 0.85;                                  // fill portion
          } else {
            a = 0.3;                                   // empty track
          }
          if (vUv.x > fill && vUv.y > 0.58) a = 0.0;    // past the fill
          if (vUv.x < 0.03) a *= 0.35;                  // soften the left cap
          if (a < 0.01) discard;
          vec3 col = vUv.y > 0.58 ? vTint.gbr : vec3(0.05, 0.06, 0.12);
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.max = max;
    this._n = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._camQ = new THREE.Quaternion();
  }

  begin(camera) {
    this._n = 0;
    camera.getWorldPosition(this._camPos);
    camera.getWorldQuaternion(this._camQ);
  }

  push(x, y, z, width, height, fill01, color) {
    if (this._n >= this.max) return;
    this._p.set(x, y, z);
    this._q.copy(this._camQ);
    this._s.set(width, height, 1);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(this._n, this._m);
    // r = fill fraction, gba = bar colour
    this.mesh.instanceColor.setXYZ(
      this._n,
      Math.max(0, Math.min(1, fill01)),
      color[0],
      color[1],
      color[2],
    );
    this._n++;
  }

  end() {
    this.mesh.count = this._n;
    if (this._n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this._n = 0;
    this.mesh.count = 0;
  }
}
