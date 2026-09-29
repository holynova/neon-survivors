import * as THREE from 'three';

/**
 * Floating damage numbers / pickup labels. DOM-based for crisp text.
 */
export class Floaters {
  constructor(container, camera) {
    this.container = container;
    this.camera = camera;
    this.items = [];
    this.pool = [];
    this._v = new THREE.Vector3();
  }

  _get() {
    const el = this.pool.pop() ?? document.createElement('div');
    this.container.appendChild(el);
    return el;
  }

  spawn(x, y, z, text, cls = 'dmg') {
    const el = this._get();
    el.className = `floater ${cls}`;
    el.textContent = text;
    el.style.opacity = '1';
    this.items.push({
      el,
      x,
      y,
      z,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 2.7 + Math.random() * 1.8,
      vz: (Math.random() - 0.5) * 1.6,
      t: 0,
      dur: cls === 'big' ? 1.05 : 0.72,
    });
    if (this.items.length > 140) {
      const old = this.items.shift();
      old.el.remove();
      this.pool.push(old.el);
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) {
        it.el.remove();
        this.pool.push(it.el);
        this.items.splice(i, 1);
        continue;
      }
      it.vy -= 5.6 * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;
      it.vx *= 0.94;
      it.vz *= 0.94;
      it.el.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      const scale = k < 0.16 ? 0.5 + (k / 0.16) * 0.7 : 1.2 - k * 0.22;
      it.el.style.transform = `translate(-50%,-50%) scale(${scale.toFixed(3)})`;
    }
  }

  project(w, h) {
    for (const it of this.items) {
      this._v.set(it.x, it.y, it.z).project(this.camera);
      const sx = (this._v.x * 0.5 + 0.5) * w;
      const sy = (-this._v.y * 0.5 + 0.5) * h;
      it.el.style.left = `${sx.toFixed(1)}px`;
      it.el.style.top = `${sy.toFixed(1)}px`;
    }
  }

  clear() {
    for (const it of this.items) {
      it.el.remove();
      this.pool.push(it.el);
    }
    this.items.length = 0;
  }
}
