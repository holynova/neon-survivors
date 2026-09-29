import { clamp } from './math.js';

/**
 * Semantic input layer. Keyboard/pointer → named actions with analog magnitude.
 * Testable in isolation: `applyKey/applyPointer` are pure w.r.t. an input state.
 */
export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.moveX = 0;
    this.moveY = 0;
    this.pressed = new Set();
    this.pointer = { x: 0, y: 0, nx: 0, ny: 0, down: false, clicked: false };
    this.enabled = true;
    this._listeners = [];

    const onKeyDown = (e) => {
      if (!this.enabled) return;
      const code = e.code;
      if (PREVENT.has(code)) e.preventDefault();
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    };
    const onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    const onBlur = () => {
      this.keys.clear();
    };
    const onPointerMove = (e) => {
      const t = e.currentTarget?.getBoundingClientRect?.();
      const el = target;
      const w = el?.clientWidth || window.innerWidth;
      const h = el?.clientHeight || window.innerHeight;
      const rect = t || el?.getBoundingClientRect?.() || { left: 0, top: 0, width: w, height: h };
      this.pointer.x = e.clientX - (rect.left || 0);
      this.pointer.y = e.clientY - (rect.top || 0);
      this.pointer.nx = (this.pointer.x / w) * 2 - 1;
      this.pointer.ny = -((this.pointer.y / h) * 2 - 1);
    };
    const onPointerDown = (e) => {
      if (e.button === 0) {
        this.pointer.down = true;
        this.pointer.clicked = true;
      }
    };
    const onPointerUp = (e) => {
      if (e.button === 0) this.pointer.down = false;
    };

    // Keyboard must be bound to `window`: key events target the focused element
    // (usually <body>) and bubble *upwards*, so a listener on the canvas never sees them.
    this._bind(window, 'keydown', onKeyDown);
    this._bind(window, 'keyup', onKeyUp);
    this._bind(window, 'blur', onBlur);
    this._bind(target, 'pointermove', onPointerMove);
    this._bind(target, 'pointerdown', onPointerDown);
    this._bind(window, 'pointerup', onPointerUp);
  }

  _bind(el, type, fn) {
    if (!el?.addEventListener) return;
    el.addEventListener(type, fn, { passive: false });
    this._listeners.push([el, type, fn]);
  }

  dispose() {
    for (const [el, type, fn] of this._listeners) el.removeEventListener(type, fn);
    this._listeners.length = 0;
  }

  isDown(code) {
    return this.enabled && this.keys.has(code);
  }

  /** One-shot: true only on the frame the key went down. */
  wasPressed(code) {
    return this.enabled && this.pressed.has(code);
  }

  axis() {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.moveX = x;
    this.moveY = y;
    return { x, y };
  }

  get dashing() {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight');
  }

  get paused() {
    return this.wasPressed('Space') || this.wasPressed('Escape');
  }

  get ability() {
    return this.wasPressed('KeyE');
  }

  get usingItem() {
    return this.wasPressed('KeyQ');
  }

  endFrame() {
    this.pressed.clear();
    this.pointer.clicked = false;
  }
}

const PREVENT = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
]);

export { clamp };
