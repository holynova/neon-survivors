import * as THREE from 'three';
import { ARENA } from '../game/config.js';
import { Rng } from '../core/rng.js';

/**
 * The arena: neon grid floor, glowing boundary walls, floating pillars,
 * distant skyline. Static geometry, built once.
 */
export function buildArena(scene, rng = new Rng(7)) {
  const group = new THREE.Group();
  group.name = 'arena';
  const half = ARENA.half;

  // --- floor: scrolling neon grid shader ---
  // Sized to the arena plus a margin so its edge never enters frame.
  const floorGeo = new THREE.PlaneGeometry(half * 2 + 40, half * 2 + 40, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color('#141d4a') },
      uColorB: { value: new THREE.Color('#1d2a63') },
      uGrid: { value: new THREE.Color('#2de0ff') },
      uGridMajor: { value: new THREE.Color('#ff3ea5') },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uHalf: { value: half },
    },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vXZ = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColorA, uColorB, uGrid, uGridMajor;
      uniform vec2 uCenter;
      uniform float uHalf;
      varying vec2 vXZ;

      // Anti-aliased grid line. The fwidth term explodes at grazing angles, so
      // fade the line out once a cell is only a few pixels wide on screen.
      float gridLine(vec2 p, float scale, float w) {
        vec2 q = p / scale;
        vec2 fw = fwidth(q);
        vec2 g = abs(fract(q - 0.5) - 0.5) / max(fw, vec2(1e-5));
        float l = min(g.x, g.y);
        float line = 1.0 - smoothstep(0.0, w, l);
        // density guard: once a cell is thinner than a couple of pixels the
        // lines merge into a solid sheet, so fade them out entirely
        float density = smoothstep(0.6, 0.12, max(fw.x, fw.y));
        return line * density;
      }

      void main() {
        vec2 p = vXZ + uCenter;
        float d = length(vXZ) / (uHalf * 1.25);

        // base radial gradient that follows the player
        vec3 col = mix(uColorA, uColorB, clamp(d, 0.0, 1.0));

        // minor + major grid, both attenuated with distance so the floor never
        // turns into a solid sheet of light at the horizon
        float distFade = 1.0 - smoothstep(uHalf * 0.35, uHalf * 0.95, length(vXZ));
        float minor = gridLine(p, 2.0, 1.2);
        float major = gridLine(p, 10.0, 1.5);
        float pulse = 0.72 + 0.28 * sin(uTime * 1.1 - d * 5.0);
        col += uGrid * minor * 0.22 * pulse * distFade;
        col += uGridMajor * major * 0.40 * pulse * mix(0.4, 1.0, distFade);

        // slow sweeping scan band
        float sweep = sin((p.x + p.y) * 0.055 - uTime * 0.55) * 0.5 + 0.5;
        col += uGrid * pow(sweep, 6.0) * 0.05 * distFade;

        // Arena boundary glow. wallDist is how far inside the wall we are:
        // 0 = exactly on the wall, growing towards the middle of the arena.
        // Kept low — the bloom pass amplifies whatever sits above its threshold.
        float wallDist = uHalf - 0.6 - max(abs(vXZ.x), abs(vXZ.y));
        float band = 1.0 - smoothstep(0.0, 1.1, wallDist);
        float halo = 1.0 - smoothstep(0.0, 4.5, wallDist);
        col += vec3(0.10, 0.42, 0.55) * band * 0.55;
        col += vec3(0.42, 0.12, 0.30) * halo * 0.13;

        // vertical haze so the floor dissolves into the background at distance
        float alpha = 0.35 + 0.65 * distFade;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = 0;
  floor.renderOrder = -10;
  group.add(floor);

  // Solid dark slab under the shader floor. Without it the sky/bloom shows
  // through the transparent grid and the arena reads as a light box.
  const baseGeo = new THREE.PlaneGeometry(half * 2 + 44, half * 2 + 44);
  baseGeo.rotateX(-Math.PI / 2);
  const base = new THREE.Mesh(
    baseGeo,
    new THREE.MeshBasicMaterial({ color: '#0a1030', fog: false }),
  );
  base.position.y = -0.06;
  base.renderOrder = -20;
  group.add(base);

  // --- boundary walls ---
  // Walls are height-faded so they read as a light barrier rather than a
  // solid slab that hides everything beyond the arena.
  const wallMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color('#0e6a86') } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float v = pow(1.0 - vUv.y, 2.4);
        float a = v * 0.075;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  for (let i = 0; i < 4; i++) {
    const w = half * 2;
    const geo = new THREE.PlaneGeometry(w, 9, 1, 1);
    const m = new THREE.Mesh(geo, wallMat);
    const ang = (i * Math.PI) / 2;
    m.position.set(Math.sin(ang) * half, 4.5, Math.cos(ang) * half);
    m.rotation.y = ang;
    group.add(m);
  }

  // Wall top rails. Kept deliberately dim: a full-bright basic material here
  // feeds the bloom pass and turns the arena edge into a glaring white bar.
  const railGeo = new THREE.BoxGeometry(half * 2, 0.16, 0.16);
  const railMat = new THREE.MeshStandardMaterial({
    color: '#0d2b3a',
    emissive: new THREE.Color('#12485c'),
    emissiveIntensity: 0.5,
    roughness: 0.5,
    metalness: 0.2,
  });
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(railGeo, railMat);
    const ang = (i * Math.PI) / 2;
    r.position.set(Math.sin(ang) * half, 9, Math.cos(ang) * half);
    r.rotation.y = ang;
    group.add(r);
  }
  const postGeo = new THREE.BoxGeometry(0.3, 9.2, 0.3);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const post = new THREE.Mesh(postGeo, railMat);
    post.position.set(Math.cos(a) * half, 4.5, Math.sin(a) * half);
    group.add(post);
  }

  // --- decorative towers beyond the arena ---
  // Dark, mostly silhouette. Their job is parallax and depth, not to be lit.
  const pillarMat = new THREE.MeshStandardMaterial({
    color: '#0d1230',
    emissive: new THREE.Color('#140f33'),
    emissiveIntensity: 0.35,
    roughness: 0.75,
    metalness: 0.3,
  });
  const capMat = new THREE.MeshStandardMaterial({
    color: '#2a1030',
    emissive: new THREE.Color('#4a1440'),
    emissiveIntensity: 0.45,
    roughness: 0.6,
    metalness: 0.2,
  });
  const pillarGeo = new THREE.BoxGeometry(3, 1, 3);
  for (let i = 0; i < 30; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = half * rng.range(1.16, 1.75);
    const h = rng.range(5, 26);
    const m = new THREE.Mesh(pillarGeo, pillarMat);
    m.scale.set(rng.range(0.7, 2.2), h, rng.range(0.7, 2.2));
    m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    m.rotation.y = rng.range(0, Math.PI);
    group.add(m);
    // Only a few get an accent cap; unlit they read as hard specular hits.
    if (rng.bool(0.22)) {
      const cap = new THREE.Mesh(pillarGeo, capMat);
      cap.scale.set(0.36, 0.36, 0.36);
      cap.position.set(m.position.x, h - 0.6, m.position.z);
      group.add(cap);
    }
  }

  // --- distant skyline bands, kept high and far so they never read as
  //     geometry floating over the play field ---
  const ringMat = new THREE.MeshBasicMaterial({
    color: '#1b2450',
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
  const skyRings = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const r = half * rng.range(2.2, 4.5);
    const geo = new THREE.RingGeometry(r, r + rng.range(0.4, 1.6), 64, 1);
    const m = new THREE.Mesh(geo, ringMat);
    m.rotation.x = rng.range(-0.12, 0.12);
    m.rotation.z = rng.range(-0.1, 0.1);
    // sit them well above the camera's look-at so they stay in the backdrop
    m.position.set(rng.range(-70, 70), rng.range(46, 92), rng.range(-70, 70));
    skyRings.add(m);
  }
  group.add(skyRings);

  // --- floor decals: conduit lines and crack web, laid out once over the
  //     arena so the empty space between fights has structure to read.
  //     Kept very low contrast: anything brighter competes with XP gems and
  //     enemy silhouettes, which is the information the player actually needs.
  const deco = new THREE.Group();
  const conduitMat = new THREE.MeshBasicMaterial({
    color: '#1d3f6b',
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const nodeMat = new THREE.MeshBasicMaterial({
    color: '#245a92',
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const conduitGeo = new THREE.PlaneGeometry(1, 0.1);
  conduitGeo.rotateX(-Math.PI / 2);
  const nodeGeo = new THREE.CircleGeometry(0.2, 10);
  nodeGeo.rotateX(-Math.PI / 2);

  for (let i = 0; i < 16; i++) {
    // A conduit runs along one axis and gets a couple of junctions, forming
    // loose lanes rather than a uniform lattice.
    const horizontal = i % 2 === 0;
    const along = rng.range(-half * 0.85, half * 0.85);
    const len = rng.range(half * 0.5, half * 1.5);
    const line = new THREE.Mesh(conduitGeo, conduitMat);
    line.scale.set(len, 1, 1);
    line.position.set(horizontal ? 0 : along, 0.02, horizontal ? along : 0);
    if (!horizontal) line.rotation.y = Math.PI / 2;
    deco.add(line);
    for (let j = 0; j < 2; j++) {
      const node = new THREE.Mesh(nodeGeo, nodeMat);
      const off = rng.range(-len * 0.4, len * 0.4);
      node.position.set(
        horizontal ? off : along,
        0.03,
        horizontal ? along : off,
      );
      deco.add(node);
    }
  }

  // hairline cracks radiating from a few impact points
  const crackMat = new THREE.MeshBasicMaterial({
    color: '#0a1430',
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const crackGeo = new THREE.PlaneGeometry(1, 0.06);
  crackGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 7; i++) {
    const cx0 = rng.range(-half * 0.8, half * 0.8);
    const cz0 = rng.range(-half * 0.8, half * 0.8);
    const arms = rng.int(4, 7);
    for (let j = 0; j < arms; j++) {
      const a = (j / arms) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const l = rng.range(1.5, 5.5);
      const arm = new THREE.Mesh(crackGeo, crackMat);
      arm.scale.set(l, 1, 1);
      arm.position.set(cx0 + Math.cos(a) * l * 0.5, 0.015, cz0 + Math.sin(a) * l * 0.5);
      arm.rotation.y = -a;
      deco.add(arm);
    }
  }
  group.add(deco);

  scene.add(group);

  return {
    group,
    floor,
    base,
    floorMat,
    skyRings,
    deco,
    update(dt, time, cx, cz) {
      floorMat.uniforms.uTime.value = time;
      floorMat.uniforms.uCenter.value.set(cx, cz);
      floor.position.x = cx;
      floor.position.z = cz;
      base.position.x = cx;
      base.position.z = cz;
      // Decals are laid out in world space, not relative to the camera, so the
      // arena keeps a stable sense of place as the player moves.
      skyRings.rotation.y = time * 0.02;
      // slow pulse keeps the conduits from reading as static scenery
      conduitMat.opacity = 0.24 + 0.1 * Math.sin(time * 0.7);
      nodeMat.opacity = 0.26 + 0.12 * Math.sin(time * 1.1);
    },
    dispose() {
      scene.remove(group);
    },
  };
}
