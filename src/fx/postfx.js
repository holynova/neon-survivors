import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Full-screen finishing pass: chromatic aberration, scanlines, grain, vignette.
 */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0016 },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.035 },
    uScan: { value: 0.05 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uHurt: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uScan;
    uniform float uHurt;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // radial chromatic aberration, stronger at edges and when hit
      float ab = uAberration * (1.0 + r2 * 5.0) * (1.0 + uHurt * 6.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;

      // hurt tint
      col = mix(col, vec3(0.75, 0.05, 0.12), uHurt * 0.5 * smoothstep(0.05, 0.6, r2));

      // scanlines
      float scan = sin(uv.y * uResolution.y * 1.6) * uScan;
      col -= scan * 0.5;

      // grain
      float g = hash(uv * uResolution + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain;

      // vignette
      float vig = smoothstep(0.95, 0.16, r2 * 1.35);
      col *= mix(1.0, vig, uVignette);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, { quality = 'high' } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.enabled = quality !== 'low';

    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 1.25, 0.72, 0.58);
    this.composer.addPass(this.bloom);

    this.finish = new ShaderPass(FinishShader);
    this.finish.uniforms.uResolution.value.set(size.x, size.y);
    this.composer.addPass(this.finish);

    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.finish.uniforms.uResolution.value.set(w, h);
  }

  setQuality(q) {
    this.quality = q;
    this.bloom.strength = q === 'high' ? 1.35 : q === 'med' ? 1.0 : 0.6;
    this.finish.uniforms.uGrain.value = q === 'low' ? 0 : 0.035;
    this.finish.uniforms.uScan.value = q === 'low' ? 0 : 0.05;
  }

  setHurt(v) {
    this.finish.uniforms.uHurt.value = v;
  }

  render(dt, time) {
    this.finish.uniforms.uTime.value = time;
    if (this.enabled) {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this.composer.dispose?.();
  }
}
