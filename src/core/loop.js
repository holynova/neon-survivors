/**
 * Fixed-step main loop with global time scaling (hitstop / slow-motion).
 */
export class Loop {
  constructor(update, { step = 1 / 60, maxSubSteps = 5 } = {}) {
    this.update = update;
    this.step = step;
    this.maxSubSteps = maxSubSteps;
    this.accumulator = 0;
    this.running = false;
    this.last = 0;
    this.timeScale = 1;
    this.targetTimeScale = 1;
    this.timeScaleLerp = 12;
    this.hitstopUntil = 0;
    this.elapsed = 0;
    this.rawElapsed = 0;
    this.frame = 0;
    this._raf = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /** Freeze scaled time for `duration` real seconds (impact feel). */
  hitstop(duration = 0.05) {
    this.hitstopUntil = Math.max(this.hitstopUntil, this.rawElapsed + duration);
  }

  slowMo(scale = 0.3, duration = 0.12, easeBack = true) {
    this.slowMoUntil = this.rawElapsed + duration;
    this.slowMoScale = scale;
    this.slowMoEaseBack = easeBack;
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    let realDt = (now - this.last) / 1000;
    this.last = now;
    if (!Number.isFinite(realDt) || realDt < 0) realDt = 0;
    realDt = Math.min(realDt, 0.25);
    this.rawElapsed += realDt;

    let scale = 1;
    if (this.rawElapsed < this.hitstopUntil) {
      scale = 0.04;
    } else if (this.rawElapsed < (this.slowMoUntil || 0)) {
      scale = this.slowMoScale;
    } else {
      this.targetTimeScale = 1;
    }
    if (this.scaleOverride != null) scale = this.scaleOverride;
    this.timeScale = scale;

    const dt = realDt * scale;
    this.elapsed += dt;

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSubSteps) {
      this.update(this.step);
      this.accumulator -= this.step;
      steps++;
      this.frame++;
    }
    if (steps >= this.maxSubSteps) this.accumulator = 0;

    this.renderDt = dt;
    this.renderRealDt = realDt;
    this.onRender?.(dt, realDt);
  }
}
