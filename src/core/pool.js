/**
 * Generic object pool with live/swap-remove iteration.
 */
export class Pool {
  constructor(factory, reset, initial = 0) {
    this.factory = factory;
    this.reset = reset;
    this.items = [];
    this.active = [];
    for (let i = 0; i < initial; i++) this.items.push(factory());
    this.free = this.items.slice();
  }

  spawn() {
    const obj = this.free.pop() ?? this.factory();
    this.active.push(obj);
    return obj;
  }

  /** Removes by index, O(1) swap-back. */
  releaseAt(i) {
    const obj = this.active[i];
    const last = this.active.pop();
    if (i < this.active.length) this.active[i] = last;
    this.reset?.(obj);
    this.free.push(obj);
    return obj;
  }

  release(obj) {
    const i = this.active.indexOf(obj);
    if (i >= 0) this.releaseAt(i);
  }

  clear() {
    while (this.active.length) this.releaseAt(this.active.length - 1);
  }

  get count() {
    return this.active.length;
  }
}
