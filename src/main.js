import { Game, STATE } from './game/game.js';
import { UI } from './ui/ui.js';

const canvas = document.getElementById('stage');
const uiRoot = document.getElementById('ui-root');

const params = new URLSearchParams(location.search);
const quality = params.get('q') ?? 'high';

const game = new Game(canvas, {
  quality,
  seed: Number(params.get('seed')) || undefined,
});

const ui = new UI(uiRoot, game);

// Expose a stable debug/testing handle.
window.__NS__ = {
  game,
  ui,
  STATE,
  start: (char, diff) => game.startRun(char, diff),
};

game.audio.init();
game.resize();
game.loop.start();
game._setState(STATE.MENU);

// Slow orbit + gentle bob behind the title screen so the empty arena reads as
// a scene rather than a static backdrop. Suspended as soon as a run starts.
const menuT0 = performance.now();
(function menuIdle() {
  requestAnimationFrame(menuIdle);
  if (game.state !== STATE.MENU && game.state !== STATE.CHARACTER) return;
  const t = (performance.now() - menuT0) / 1000;
  const orbit = game.state === STATE.MENU ? 26 : 15;
  const a = t * 0.12;
  game.camTarget.set(Math.cos(a) * orbit, 0, Math.sin(a * 0.85) * orbit);
  game.juice.basePos.y = 22 + Math.sin(t * 0.19) * 3.5;
})();

// UI refresh loop (cheap DOM writes).
(function uiLoop() {
  requestAnimationFrame(uiLoop);
  if (game.player && game.state !== STATE.MENU) ui.update(game);
})();

// Resume audio on first interaction (browser autoplay policy).
const kick = () => {
  game.audio.init();
  window.removeEventListener('pointerdown', kick);
  window.removeEventListener('keydown', kick);
};
window.addEventListener('pointerdown', kick);
window.addEventListener('keydown', kick);

// Test hooks used by the e2e suite.
game.__test = {
  forceState: (s) => game._setState(s),
  state: () => game.state,
  wave: () => game.wave,
  phase: () => game.phase,
  player: () => {
    const p = game.player;
    if (!p) return null;
    return {
      x: p.x,
      z: p.z,
      hp: p.hp,
      maxHp: p.maxHp,
      level: p.level,
      xp: p.xp,
      xpNeed: p.xpNeed,
      gold: p.gold,
      kills: p.kills,
      alive: p.alive,
      weapons: p.weapons.map((w) => ({ id: w.def.id, level: w.level })),
      speed: Math.hypot(p.vx, p.vz),
    };
  },
  enemies: () => game.enemies.countAlive(),
  projectiles: () => game.projectiles.count,
  pickups: () => game.pickups.count,
  particles: () => game.fx.all.reduce((n, s) => n + s.count, 0),
  fps: () => game.__fps ?? 0,
  move: (dx, dy) => game.input.axis.call(game.input) || null,
  holdKey: (code, down) => {
    if (down) game.input.keys.add(code);
    else game.input.keys.delete(code);
  },
  setHurt: (v) => game.postfx.setHurt(v),
};
