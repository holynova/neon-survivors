/**
 * Fully procedural audio (no asset files). Oscillators + noise buffers + envelopes.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.volume = 0.7;
    this._noise = null;
    this._lastPlay = new Map();
    this._voices = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);

    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return this.ctx;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  get t() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setMutedSafe() {}

  _gate(key, minGap = 0.02) {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    const last = this._lastPlay.get(key) ?? -1;
    if (now - last < minGap) return false;
    this._lastPlay.set(key, now);
    return true;
  }

  _env(node, t0, { a = 0.005, d = 0.1, peak = 1, sustain = 0, r = 0.05 } = {}) {
    const g = node.gain;
    const p = Number.isFinite(peak) && peak > 0 ? peak : 0.0002;
    const dur = Number.isFinite(d) && d > 0 ? d : 0.01;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(p, t0 + a);
    if (sustain > 0) {
      g.exponentialRampToValueAtTime(Math.max(0.0002, p * sustain), t0 + a + dur);
      g.exponentialRampToValueAtTime(0.0001, t0 + a + dur + r);
    } else {
      g.exponentialRampToValueAtTime(0.0001, t0 + a + dur);
    }
  }

  /** Guards every public synth entry point against non-finite arguments. */
  _safeFreq(f, fallback = 440) {
    return Number.isFinite(f) && f > 0 ? f : fallback;
  }

  tone({ freq = 440, to = null, type = 'sine', dur = 0.1, gain = 0.3, delay = 0, sweep = 'exp' }) {
    if (!this.ctx || this.muted) return;
    if (!Number.isFinite(gain) || gain <= 0) return;
    const t0 = this.t + Math.max(0, Number.isFinite(delay) ? delay : 0);
    const D = Number.isFinite(dur) && dur > 0 ? dur : 0.05;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(this._safeFreq(freq), t0);
    if (to != null && Number.isFinite(to)) {
      const end = Math.max(1, to);
      if (sweep === 'exp') osc.frequency.exponentialRampToValueAtTime(end, t0 + D);
      else osc.frequency.linearRampToValueAtTime(end, t0 + D);
    }
    this._env(g, t0, { a: 0.006, d: D, peak: gain });
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + D + 0.06);
  }

  noise({ dur = 0.12, gain = 0.3, delay = 0, filter = 'lowpass', freq = 1800, q = 1, to = null, sweep = 'exp' }) {
    if (!this.ctx || this.muted || !this._noise) return;
    if (!Number.isFinite(gain) || gain <= 0) return;
    const t0 = this.t + Math.max(0, Number.isFinite(delay) ? delay : 0);
    const D = Number.isFinite(dur) && dur > 0 ? dur : 0.05;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.25;
    const bq = this.ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(this._safeFreq(freq, 1000), t0);
    bq.Q.value = Number.isFinite(q) ? q : 1;
    if (to != null && Number.isFinite(to)) {
      const end = Math.max(30, to);
      if (sweep === 'exp') bq.frequency.exponentialRampToValueAtTime(end, t0 + D);
      else bq.frequency.linearRampToValueAtTime(end, t0 + D);
    }
    const g = this.ctx.createGain();
    this._env(g, t0, { a: 0.004, d: D, peak: gain });
    src.connect(bq);
    bq.connect(g);
    g.connect(this.sfxGain);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + D + 0.05);
  }

  // ---- game events -------------------------------------------------------
  shot(kind = 'smg') {
    if (!this._gate('shot', 0.02)) return;
    switch (kind) {
      case 'shotgun':
        this.noise({ dur: 0.2, gain: 0.34, filter: 'lowpass', freq: 2600, to: 320, q: 0.9 });
        this.tone({ freq: 180, to: 60, type: 'triangle', dur: 0.14, gain: 0.22 });
        break;
      case 'smg':
        this.noise({ dur: 0.07, gain: 0.17, filter: 'highpass', freq: 900, q: 0.7 });
        this.tone({ freq: 420, to: 190, type: 'square', dur: 0.05, gain: 0.1 });
        break;
      case 'tesla':
        this.noise({ dur: 0.16, gain: 0.16, filter: 'bandpass', freq: 2600, to: 5200, q: 6 });
        break;
      case 'grenade':
        this.tone({ freq: 150, to: 60, type: 'sine', dur: 0.16, gain: 0.24 });
        this.noise({ dur: 0.1, gain: 0.12, filter: 'lowpass', freq: 900, to: 200 });
        break;
      case 'frost':
        this.noise({ dur: 0.22, gain: 0.15, filter: 'bandpass', freq: 5200, to: 2400, q: 3 });
        break;
      case 'railgun':
        this.tone({ freq: 2200, to: 180, type: 'sawtooth', dur: 0.24, gain: 0.2 });
        this.noise({ dur: 0.3, gain: 0.18, filter: 'bandpass', freq: 3000, to: 400, q: 2 });
        break;
      case 'swarm':
        this.tone({ freq: 700, to: 1500, type: 'triangle', dur: 0.07, gain: 0.09 });
        break;
      default:
        this.tone({ freq: 500, to: 200, type: 'triangle', dur: 0.06, gain: 0.1 });
    }
  }

  hit(strength = 1) {
    if (!this._gate('hit', 0.018)) return;
    this.tone({ freq: 260 + Math.random() * 220, to: 90, type: 'square', dur: 0.05, gain: 0.07 * strength });
  }

  kill() {
    if (!this._gate('kill', 0.02)) return;
    this.noise({ dur: 0.22, gain: 0.2, filter: 'lowpass', freq: 1800, to: 160, q: 0.8 });
    this.tone({ freq: 120, to: 45, type: 'sine', dur: 0.2, gain: 0.16 });
  }

  explosion(scale = 1) {
    if (!this._gate('explosion', 0.03)) return;
    this.tone({ freq: 130 * scale, to: 28, type: 'sine', dur: 0.42, gain: 0.34 });
    this.noise({ dur: 0.45, gain: 0.3, filter: 'lowpass', freq: 1500, to: 90, q: 0.7 });
    this.noise({ dur: 0.1, gain: 0.16, filter: 'highpass', freq: 3000, q: 1 });
  }

  zap() {
    if (!this._gate('zap', 0.03)) return;
    this.noise({ dur: 0.14, gain: 0.13, filter: 'bandpass', freq: 3600, to: 6800, q: 9 });
  }

  pickup() {
    if (!this._gate('pickup', 0.03)) return;
    this.tone({ freq: 880, to: 1320, type: 'sine', dur: 0.07, gain: 0.06 });
  }

  coin() {
    if (!this._gate('coin', 0.03)) return;
    this.tone({ freq: 1500, to: 2100, type: 'triangle', dur: 0.06, gain: 0.05 });
  }

  hurt() {
    this.tone({ freq: 220, to: 70, type: 'square', dur: 0.24, gain: 0.24 });
    this.noise({ dur: 0.2, gain: 0.16, filter: 'lowpass', freq: 900, to: 160 });
  }

  levelUp() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.4, gain: 0.16, delay: i * 0.065 }));
    this.noise({ dur: 0.5, gain: 0.09, filter: 'highpass', freq: 3000, sweep: 'exp', to: 9000 });
  }

  cardHover() {
    if (!this._gate('hover', 0.05)) return;
    this.tone({ freq: 1200, to: 1400, type: 'sine', dur: 0.04, gain: 0.04 });
  }

  ui() {
    if (!this._gate('ui', 0.03)) return;
    this.tone({ freq: 640, to: 820, type: 'square', dur: 0.05, gain: 0.05 });
  }

  dash() {
    this.noise({ dur: 0.2, gain: 0.14, filter: 'bandpass', freq: 900, to: 3200, q: 2 });
  }

  boss() {
    this.tone({ freq: 90, to: 34, type: 'sawtooth', dur: 1.6, gain: 0.3 });
    this.tone({ freq: 62, to: 28, type: 'sine', dur: 1.9, gain: 0.26, delay: 0.1 });
    this.noise({ dur: 1.4, gain: 0.14, filter: 'lowpass', freq: 300, to: 2600, sweep: 'lin' });
  }

  gameOver() {
    [392, 349.23, 293.66, 196].forEach((f, i) =>
      this.tone({ freq: f, type: 'triangle', dur: 0.9, gain: 0.16, delay: i * 0.22 }),
    );
  }

  victory() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      this.tone({ freq: f, type: 'triangle', dur: 1.1, gain: 0.14, delay: i * 0.13 }),
    );
  }
}

export const audio = new Audio();
