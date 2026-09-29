import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { CAMERA } from '../game/config.js';

/**
 * "Juice" layer: trauma-based screen shake, hitstop, slow-motion, damage flash, zoom punch.
 */
export class Juice {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.trauma = 0;
    this.shakeAmp = 0.42;
    this.time = 0;
    this.basePos = new THREE.Vector3();
    this.baseOffset = new THREE.Vector3(0, 0, CAMERA.distance);
    this.baseFov = camera.fov;
    this._look = new THREE.Vector3();
    this.camRoll = 0;

    this.flash = null;
    this._flashEl = document.createElement('div');
    this._flashEl.className = 'screen-flash';
    document.body.appendChild(this._flashEl);
    this._hurtEl = document.createElement('div');
    this._hurtEl.className = 'hurt-vignette';
    document.body.appendChild(this._hurtEl);
    this._hudEl = document.createElement('div');
    this._hudEl.className = 'fx-hud';
    this._hudEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;';
    document.body.appendChild(this._hudEl);

    this.chromatic = 0;
  }

  addTrauma(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /** Full-screen additive flash. */
  screenFlash(color = '#ffffff', alpha = 0.5, dur = 0.22) {
    this._flashEl.style.background = color;
    this._flashEl.style.transition = 'none';
    this._flashEl.style.opacity = String(alpha);
    // force reflow so the fade always plays
    void this._flashEl.offsetWidth;
    this._flashEl.style.transition = `opacity ${dur}s ease-out`;
    this._flashEl.style.opacity = '0';
  }

  hurtFlash(intensity = 1) {
    this._hurtEl.style.transition = 'none';
    this._hurtEl.style.opacity = String(clamp(intensity, 0, 1));
    void this._hurtEl.offsetWidth;
    this._hurtEl.style.transition = 'opacity 0.55s ease-out';
    this._hurtEl.style.opacity = '0';
  }

  hitstop(loop, dur = 0.045) {
    loop.hitstop(dur);
  }

  slowMo(loop, scale = 0.3, dur = 0.12) {
    loop.slowMo(scale, dur);
  }

  fovPunch(amount = 4, dur = 0.25) {
    this._fovPunch = amount;
    this._fovDur = dur;
    this._fovT = dur;
    this._baseFov = this.baseFov;
  }

  update(dt, realDt, targetX, targetZ) {
    this.time += realDt;
    this.trauma = Math.max(0, this.trauma - realDt * 1.45);
    const s = this.trauma * this.trauma * this.shakeAmp;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let roll = 0;
    if (s > 0.0001) {
      const t = this.time * 34;
      ox = Math.sin(t * 1.13 + 0.7) * s * 1.8;
      oz = Math.sin(t * 0.91 + 2.1) * s * 1.8;
      oy = Math.sin(t * 1.51 + 1.3) * s * 1.3;
      roll = Math.sin(t * 0.77) * s * 0.04;
    }

    // The camera follows the target every frame, so the look-at must be
    // recomputed too (setting position alone would leave it aimed at the origin).
    const cx = targetX + ox;
    const cz = targetZ + oz;
    this.camera.position.set(cx, this.basePos.y + oy, cz + this.baseOffset.z);
    // Look at the follow target itself, nudged forward so the player sits
    // slightly below centre and more of the arena ahead is visible.
    this._look.set(cx, 1.0, cz + this.baseOffset.z * 0.18);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this._look);
    if (roll !== 0) this.camera.rotateZ(roll);
    this.camRoll = roll;

    if (this._fovT > 0 && this._fovPunch) {
      this._fovT -= realDt;
      const k = clamp(this._fovT / this._fovDur, 0, 1);
      const e = k * k;
      this.camera.fov = this._baseFov + this._fovPunch * e;
      this.camera.updateProjectionMatrix();
      if (this._fovT <= 0) {
        this.camera.fov = this._baseFov;
        this.camera.updateProjectionMatrix();
        this._fovPunch = 0;
      }
    }
    this.chromatic = Math.max(0, this.chromatic - realDt * 3);
  }

  setBasePosition(x, y, z) {
    this.basePos.set(x, y, z);
    this.baseOffset.set(x, y, z);
    this.baseFov = this.camera.fov;
  }

  dispose() {
    this._flashEl.remove();
    this._hurtEl.remove();
    this._hudEl.remove();
  }
}
