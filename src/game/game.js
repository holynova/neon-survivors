import * as THREE from 'three';
import { Loop } from '../core/loop.js';
import { Input } from '../core/input.js';
import { Rng } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { ARENA, PLAYER, WAVES, CAMERA, DIFFICULTIES, DIFFICULTY, QUALITY, ECONOMY } from './config.js';
import { buildArena } from './arena.js';
import { Player, XP_NEED } from './player.js';
import { EnemyManager } from './enemies.js';
import { ProjectileSystem } from './projectiles.js';
import { PickupSystem } from './pickups.js';
import { WeaponInstance, updateWeapons, colorOf } from './weapons.js';
import { wavePlan, rollDrops } from './spawner.js';
import { buildShop } from './shop.js';
import { rollCards } from './upgrades.js';
import { CHARACTER_BY_ID } from './characters.js';
import { BOSSES } from './enemyDefs.js';
import { FX } from '../fx/particles.js';
import { ShockwavePool, DecalPool } from '../fx/decal.js';
import { BeamPool } from '../fx/beams.js';
import { PostFX } from '../fx/postfx.js';
import { Juice } from '../fx/juice.js';
import { Floaters } from '../fx/floaters.js';
import { clamp, damp, dist } from '../core/math.js';
import { computeDamage } from './stats.js';

export const STATE = {
  MENU: 'menu',
  CHARACTER: 'character',
  PLAYING: 'playing',
  LEVELUP: 'levelup',
  SHOP: 'shop',
  PAUSED: 'paused',
  DEAD: 'dead',
  VICTORY: 'victory',
};

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.quality = opts.quality ?? 'high';
    this.onStateChange = opts.onStateChange ?? (() => {});
    this.onGameOver = opts.onGameOver ?? (() => {});
    this.onVictory = opts.onVictory ?? (() => {});
    this.onLevelUp = opts.onLevelUp ?? (() => {});
    this.rng = new Rng(opts.seed ?? ((Date.now() & 0xffffffff) || 12345));
    this.effectsOn = true;
    this.time = 0;
    this.runTime = 0;

    this._initRenderer();
    this._initScene();
    this._initSystems();

    this.state = STATE.MENU;
    this.audio = audio;
    this.WeaponInstance = WeaponInstance;
    this.loop = new Loop((dt) => this.update(dt));
    this.loop.onRender = (dt, realDt) => this.render(dt, realDt);
    this.input = new Input(canvas);

    this.wave = 0;
    this.phase = 'idle';
    this.phaseTimer = 0;
    this.gameOver = false;
    this.victory = false;
    this.stats = { kills: 0, damage: 0, gold: 0, bestWave: 1, time: 0, level: 1 };
    this.levelUpCards = [];
    this.shopItems = [];
  }

  // ---------------------------------------------------------------- setup
  _initRenderer() {
    const pr = Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio[this.quality] ?? 1.5);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = QUALITY.shadows[this.quality] !== false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05060f');
    this.scene.fog = new THREE.FogExp2('#070a1c', 0.0155);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.5,
      400,
    );
    this.camera.position.set(0, CAMERA.height, CAMERA.distance);
    this.camera.lookAt(0, 1.2, 0);
    this.camTarget = new THREE.Vector3(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight('#6ea8ff', '#1a0f33', 0.85));

    this.sun = new THREE.DirectionalLight('#bcd8ff', 0.75);
    this.sun.position.set(14, 26, 10);
    this.sun.castShadow = QUALITY.shadows[this.quality] !== false;
    if (this.sun.castShadow) {
      this.sun.shadow.mapSize.set(1024, 1024);
      const s = 32;
      this.sun.shadow.camera.left = -s;
      this.sun.shadow.camera.right = s;
      this.sun.shadow.camera.top = s;
      this.sun.shadow.camera.bottom = -s;
      this.sun.shadow.camera.far = 90;
      this.sun.shadow.bias = -0.0015;
      this.sun.shadow.camera.updateProjectionMatrix();
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.rim = new THREE.PointLight('#ff3ea5', 30, 48, 2);
    this.rim.position.set(-12, 8, -12);
    this.scene.add(this.rim);

    this.rim2 = new THREE.PointLight('#2de0ff', 24, 48, 2);
    this.rim2.position.set(14, 7, 14);
    this.scene.add(this.rim2);

    this.arena = buildArena(this.scene, new Rng(7));
  }

  _initSystems() {
    this.fx = new FX(this.scene, this.quality);
    this.fx.setPixelRatio(this.renderer.getPixelRatio());
    this.shock = new ShockwavePool(this.scene, 64);
    this.decal = new DecalPool(this.scene, 96);
    this.beams = new BeamPool(this.scene, 22, [0.7, 0.6, 1]);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, { quality: this.quality });
    this.juice = new Juice(this.camera, this.canvas);
    this.juice.setBasePosition(0, CAMERA.height, CAMERA.distance);

    this.floaterLayer = document.createElement('div');
    this.floaterLayer.className = 'floater-layer';
    document.body.appendChild(this.floaterLayer);
    this.floaters = new Floaters(this.floaterLayer, this.camera);

    this.enemies = new EnemyManager(this);
    this.projectiles = new ProjectileSystem(this);
    this.pickups = new PickupSystem(this, 900);

    this.difficulty = DIFFICULTY;
    this.player = null;
    this.pendingLevels = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.spawnInterval = 1;
    this.waveTimer = 0;
    this.killsThisWave = 0;
    this.bossEntity = null;

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.postfx.setSize(w, h);
  }

  setQuality(q) {
    if (!QUALITY.particles[q]) return;
    this.quality = q;
    this.postfx.setQuality(q);
    this.renderer.shadowMap.enabled = QUALITY.shadows[q] !== false;
    this.sun.castShadow = QUALITY.shadows[q] !== false;
    const pr = Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio[q]);
    this.renderer.setPixelRatio(pr);
    this.fx.setPixelRatio(pr);
    this.resize();
  }

  /** Rolling FPS estimate (smoothed over ~0.5s windows). */
  _trackFps(realDt) {
    this._fpsAcc = (this._fpsAcc ?? 0) + realDt;
    this._fpsFrames = (this._fpsFrames ?? 0) + 1;
    if (this._fpsAcc >= 0.5) {
      this.__fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
  }

  // ------------------------------------------------------------- lifecycle
  startRun(characterId = 'vanguard', difficultyId = 'normal', seed) {
    this.difficulty = DIFFICULTIES[difficultyId] ?? DIFFICULTY;
    if (seed != null) this.rng.reset(seed);
    if (this.player) this.player.dispose();
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    this.shock.clear();
    this.decal.clear();
    this.beams.clear();
    this.floaters.clear();

    this.char = CHARACTER_BY_ID[characterId] ?? CHARACTER_BY_ID.vanguard;
    this.player = new Player(this.char, this);
    this.player.addWeapon(this.char.weapon);

    this.wave = 0;
    this.time = 0;
    this.runTime = 0;
    this.pendingLevels = 0;
    this.gameOver = false;
    this.victory = false;
    this.bossEntity = null;
    this.killsThisWave = 0;
    this.abilityUsed = 0;
    this.levelUpCards = [];
    this.shopItems = [];
    this.stats = { kills: 0, damage: 0, gold: 0, bestWave: 1, time: 0, level: 1 };

    this.camTarget.set(0, 0, 0);
    this.postfx.setHurt(0);
    this._beginNextWave();
    this._setState(STATE.PLAYING);
    if (!this.loop.running) this.loop.start();
  }

  /** Dev/test helper: jump straight into a fight. */
  debugSkipToCombat(wave = 1) {
    this.wave = Math.max(0, wave - 1);
    this._beginNextWave();
    this.phaseTimer = 0.1;
    this._setState(STATE.PLAYING);
  }

  debugGiveWeapon(id) {
    return this.player?.addWeapon(id);
  }

  debugLevelUp(n = 1) {
    const p = this.player;
    if (!p) return;
    for (let i = 0; i < n; i++) {
      p.level++;
      p.xpNeed = XP_NEED(p.level);
      p.pendingLevels = (p.pendingLevels ?? 0) + 1;
    }
  }

  debugKillAll() {
    for (const e of this.enemies.list) {
      if (e.alive) e.damage(e.hp * 2, 'debug', { noCrit: true, silent: true });
    }
  }

  _beginNextWave() {
    this.wave++;
    this.phase = 'prep';
    this.phaseTimer = this.wave === 1 ? 2.4 : WAVES.prepTime;
    this.killsThisWave = 0;
    this.spawnTimer = 0;
    this.plan = null;
    this.waveTimer = 0;
    this.audio.ui();
  }

  _startCombat() {
    this.plan = wavePlan(this.wave, this.difficulty, this.rng);
    this.spawnQueue = this.plan.roster.slice();
    this.totalToSpawn = this.spawnQueue.length;
    this.spawnedCount = 0;
    this.phase = 'combat';
    this.waveTimer = this.plan.duration;
    this.waveElapsed = 0;
    this.spawnInterval = Math.max(0.1, 0.85 - this.wave * 0.03);
    this.spawnTimer = 0.15;
    if (this.plan.isBoss && this.plan.boss) {
      this.pendingBoss = this.plan.boss;
      this._spawnBoss();
    }
  }

  _spawnBoss() {
    if (!this.pendingBoss) return;
    const def = BOSSES[this.pendingBoss];
    const side = Math.random() < 0.5 ? -1 : 1;
    const e = this.enemies.spawnBoss(
      this.pendingBoss,
      this.player.x + side * ARENA.spawnMin,
      this.player.z + ARENA.spawnMin * 0.6,
      this.wave,
      this.difficulty,
    );
    if (e) {
      this.bossEntity = e;
      this.audio.boss();
      this.juice.addTrauma(0.5);
      this.juice.screenFlash(def.color, 0.4, 0.6);
    }
    this.pendingBoss = null;
  }

  // ---------------------------------------------------------------- state
  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.onStateChange(s, this);
  }

  pause() {
    if (this.state === STATE.PLAYING) this._setState(STATE.PAUSED);
  }

  resume() {
    if (this.state === STATE.PAUSED) this._setState(STATE.PLAYING);
  }

  // ---------------------------------------------------------------- input
  _handleHotkeys() {
    const inp = this.input;
    if (this.state === STATE.PLAYING) {
      if (inp.paused) {
        this._setState(STATE.PAUSED);
        return;
      }
      if (inp.ability && this.player?.useAbility()) this.abilityUsed++;
    } else if (this.state === STATE.PAUSED) {
      if (inp.paused) this._setState(STATE.PLAYING);
    }
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.time += dt;
    this._handleHotkeys();

    const playing = this.state === STATE.PLAYING;
    if (playing && this.player) {
      this.runTime += dt;
      this._updatePhase(dt);
      const move = this.input.axis();
      this.player.update(dt, { x: move.x, y: move.y, dash: this.input.dashing }, this);
      updateWeapons(this, dt);
      this.enemies.update(dt, this.player, this);
      this.projectiles.update(dt, this);
      this.pickups.update(dt, this.player, this);
      this._updateLevel();
      this.stats.gold = this.player.gold;
      this.stats.damage = Math.round(this.player.damageDealt);
      this.stats.time = this.runTime;
      this.stats.level = this.player.level;
      this.stats.bestWave = Math.max(this.stats.bestWave, this.wave);
    }

    this.fx.update(dt, this.time);
    this.shock.update(dt);
    this.decal.update(dt);
    this.beams.update(dt, this.time);
    this.floaters.update(dt);

    if (this.player) {
      this.camTarget.set(
        damp(this.camTarget.x, this.player.x, CAMERA.lambda, dt),
        0,
        damp(this.camTarget.z, this.player.z, CAMERA.lambda, dt),
      );
      this.sun.position.set(this.camTarget.x + 14, 26, this.camTarget.z + 10);
      this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z);
      this.sun.target.updateMatrixWorld();
      this.rim.position.set(this.camTarget.x - 13, 8, this.camTarget.z - 13);
      this.rim2.position.set(this.camTarget.x + 13, 7, this.camTarget.z + 13);
    }

    this.postfx.setHurt(Math.max(0, this.postfx.finish.uniforms.uHurt.value - dt * 2.4));
    this.input.endFrame();
  }

  _updatePhase(dt) {
    if (this.phase === 'prep') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this._startCombat();
      return;
    }
    if (this.phase === 'combat') {
      this.waveTimer -= dt;
      this.waveElapsed += dt;
      if (this.spawnQueue.length > 0) {
        // Spawn in small bursts rather than a uniform drip: it reads better and
        // keeps pressure high without flooding the screen in one frame.
        this.spawnTimer -= dt;
        while (this.spawnTimer <= 0 && this.spawnQueue.length > 0) {
          this.spawnTimer += this.spawnInterval;
          const burst = this.rng.int(1, 3);
          for (let i = 0; i < burst && this.spawnQueue.length > 0; i++) {
            this._spawnEnemy(this.spawnQueue.shift());
            this.spawnedCount++;
          }
        }
      }
      // Wave ends when the queue is spent and the field is clear, but never
      // before minDuration has passed — otherwise a fast clear leaves the
      // player stranded in an empty arena.
      const cleared = this.spawnQueue.length === 0 && this.enemies.countAlive() === 0;
      const outOfTime = this.waveTimer <= 0;
      if ((cleared && this.waveElapsed >= WAVES.minDuration) || outOfTime) {
        // Anything still queued at the buzzer gets released now.
        if (outOfTime) this._flushSpawnQueue();
        if (this.spawnQueue.length === 0 && this.enemies.countAlive() === 0) this._endWave();
      }
      return;
    }
    if (this.phase === 'rest') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0 && this.state === STATE.PLAYING) this._beginNextWave();
    }
  }

  /** At the wave buzzer, release everything still queued so nothing is silently lost. */
  _flushSpawnQueue() {
    let n = 0;
    while (this.spawnQueue.length > 0 && n < 40) {
      this._spawnEnemy(this.spawnQueue.shift());
      n++;
    }
  }

  _endWave() {
    if (this.wave >= WAVES.total) {
      this.victory = true;
      this.stats.bestWave = WAVES.total;
      this.onVictory(this.buildRunSummary());
      this._setState(STATE.VICTORY);
      this.audio.victory();
      return;
    }
    this.phase = 'rest';
    this.phaseTimer = WAVES.restTime;
    this.openShop();
  }

  openShop() {
    this.shopItems = buildShop(this.player, this.wave, this.rng, 4);
    this._setState(STATE.SHOP);
    this.audio.ui();
  }

  closeShop() {
    if (this.state !== STATE.SHOP) return;
    this.shopItems = [];
    this._setState(STATE.PLAYING);
    this.phaseTimer = Math.min(this.phaseTimer, 0.4);
  }

  buy(item) {
    if (this.state !== STATE.SHOP || item.sold) return false;
    if (this.player.gold < item.price) return false;
    this.player.gold -= item.price;
    item.apply(this.player, this);
    item.sold = true;
    this.audio.ui();
    this.floaters.spawn(this.player.x, 2.6, this.player.z, `-${item.price}`, 'coin');
    return true;
  }

  _spawnEnemy(id) {
    const p = this.player;
    // Spawn on a ring just outside the camera's view so enemies walk in from
    // the edge of the screen rather than materialising at the arena border.
    const a = Math.random() * Math.PI * 2;
    const r = this.rng.range(ARENA.spawnMin, ARENA.spawnMax);
    const lim = ARENA.half - 2.5;
    const x = clamp(p.x + Math.cos(a) * r, -lim, lim);
    const z = clamp(p.z + Math.sin(a) * r, -lim, lim);
    const e = this.enemies.spawn(id, x, z, this.wave, this.difficulty);
    if (e) {
      this.shockRing(x, z, 2.4, e.color, 0.36);
      this.fx.dust(x, z, 1.2, e.color, 7, 3);
      if (this.effectsOn && Math.random() < 0.4) {
        this.fx.glow.emit({ x, y: 1, z, color: e.color, size: 1.4, life: 0.25, drag: 0 });
      }
    }
    return e;
  }

  // ------------------------------------------------------------ levelling
  _updateLevel() {
    const p = this.player;
    while (p.xp >= p.xpNeed && p.level < 60) {
      p.xp -= p.xpNeed;
      p.level++;
      p.xpNeed = XP_NEED(p.level);
      p.pendingLevels = (p.pendingLevels ?? 0) + 1;
    }
    if (p.pendingLevels > 0 && this.state === STATE.PLAYING) {
      this.openLevelUp();
    }
  }

  openLevelUp() {
    this.player.pendingLevels--;
    this.levelUpCards = rollCards(this.player, 3, this.rng, { wave: this.wave });
    if (!this.levelUpCards.length) {
      // no cards available (shouldn't happen) — fall through
      if (this.player.pendingLevels > 0) this.openLevelUp();
      return;
    }
    this.audio.levelUp();
    this.juice.screenFlash('#7fe9ff', 0.28, 0.35);
    this.fx.levelUp(this.player.x, 0.5, this.player.z, [0.5, 0.9, 1]);
    this.shock.spawn({ x: this.player.x, z: this.player.z, r0: 1, r1: 9, dur: 0.7, color: [0.5, 0.9, 1] });
    this._setState(STATE.LEVELUP);
    this.onLevelUp(this.levelUpCards, this);
  }

  chooseCard(index) {
    if (this.state !== STATE.LEVELUP) return;
    const card = this.levelUpCards[index];
    if (card) {
      card.apply(this.player, this);
      this.audio.ui();
      this.levelUpCards = [];
      if (this.player.pendingLevels > 0) {
        this._setState(STATE.PLAYING);
        this.openLevelUp();
      } else {
        this._setState(STATE.PLAYING);
      }
    }
  }

  rerollCards() {
    if (this.state !== STATE.LEVELUP) return false;
    if ((this.player.rerolls ?? 0) <= 0) return false;
    this.player.rerolls--;
    this.levelUpCards = rollCards(this.player, 3, this.rng, { wave: this.wave });
    this.audio.cardHover();
    this.onLevelUp(this.levelUpCards, this);
    return true;
  }

  addGold(v) {
    const amt = Math.round(v * this.player.stats.get('goldGain'));
    this.player.gold += amt;
    return amt;
  }

  // --------------------------------------------------------------- death
  onEnemyKilled(e, cause) {
    const p = this.player;
    if (!p) return;
    const drops = rollDrops(e.def, { xp: 1, gold: 1 }, this.rng, this.difficulty);
    const color = e.color;

    this.fx.deathBurst(e.x, e.baseY, e.z, color, e.boss ? 3.6 : e.elite ? 1.9 : 1, () => this.rng.next());
    this.shock.spawn({
      x: e.x,
      z: e.z,
      r0: e.radius * 0.6,
      r1: e.radius * (e.boss ? 15 : 5.5),
      dur: e.boss ? 0.95 : 0.42,
      color,
      width: 0.42,
    });
    this.audio.kill();

    if (e.boss) {
      this.juice.slowMo(this.loop, 0.22, 0.6);
      this.juice.screenFlash('#ffffff', 0.8, 0.75);
      this.juice.addTrauma(0.95);
      this.juice.fovPunch(10, 0.55);
      const bx = e.x;
      const bz = e.z;
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          const a = this.rng.range(0, Math.PI * 2);
          const d = 2 + this.rng.range(0, 6);
          this.fx.explosion(bx + Math.cos(a) * d, 1, bz + Math.sin(a) * d, 4.4, color, () => this.rng.next());
          this.audio.explosion(1.2);
        }, i * 130);
      }
      this.bossEntity = null;
    } else if (e.elite) {
      this.juice.slowMo(this.loop, 0.4, 0.16);
      this.juice.addTrauma(0.35);
      this.juice.screenFlash(color[0] ? `#${new THREE.Color(color[0], color[1], color[2]).getHexString()}` : '#fff', 0.25, 0.3);
    }

    if (e.def.splitInto) {
      const n = e.def.splitCount ?? 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const c = this.enemies.spawn(e.def.splitInto, e.x + Math.cos(a) * 1.6, e.z + Math.sin(a) * 1.6, this.wave, this.difficulty);
        if (c) {
          c.knockX = Math.cos(a) * 11;
          c.knockZ = Math.sin(a) * 11;
        }
      }
    }

    this.pickups.burstXp(e.x, e.z, Math.round(e.xpValue));
    const coinChance = e.boss ? 1 : ECONOMY.goldPerKillChance + (e.elite ? 0.6 : 0);
    if (this.rng.bool(coinChance)) {
      const coins = Math.round(drops.coins * p.stats.get('goldGain'));
      const n = clamp(Math.ceil(coins / 25), 1, 6);
      for (let i = 0; i < n; i++) this.pickups.spawn('coin', e.x, e.z, Math.max(1, Math.round(coins / n)));
    }
    if (drops.heal) this.pickups.spawn('heal', e.x, e.z, 25);
    if (e.boss) {
      for (let i = 0; i < 8; i++) this.pickups.spawn('heal', e.x, e.z, 20);
      this.pickups.spawn('magnet', e.x, e.z, 1);
      this.pickups.spawn('bomb', e.x, e.z, 1);
    } else if (this.rng.bool(0.006)) {
      this.pickups.spawn('magnet', e.x, e.z, 1);
    }

    // NOTE: damage is credited at the point of impact, not here. Adding
    // `e.maxHp` on death double-counted every kill and inflated the total.
    p.onKill(e, this);
    this.stats.kills++;
    this.killsThisWave++;
  }

  onPlayerDeath() {
    this.player.onDeathVisual(this);
    this.gameOver = true;
    this.audio.gameOver();
    this.juice.slowMo(this.loop, 0.2, 1.4);
    this.juice.addTrauma(0.8);
    window.setTimeout(() => {
      if (this.gameOver) {
        this.onGameOver(this.buildRunSummary());
        this._setState(STATE.DEAD);
      }
    }, 1000);
  }

  buildRunSummary() {
    const p = this.player;
    return {
      character: this.char,
      wave: this.wave,
      kills: p?.kills ?? 0,
      damage: Math.round(p?.damageDealt ?? 0),
      gold: p?.gold ?? 0,
      level: p?.level ?? 1,
      time: this.runTime,
      victory: this.victory,
      weapons: (p?.weapons ?? []).map((w) => ({ name: w.def.name, level: w.level, color: w.def.color })),
      stats: p?.stats.snapshot() ?? {},
      elements: { ...(p?.elementDmg ?? {}) },
      dps: p ? (p.damageDealt / Math.max(1, this.runTime)) : 0,
    };
  }

  onBossSpawn(e) {
    this.onBossSpawnUI?.(e);
  }

  /** Convenience wrapper so rules code can drop a pickup without reaching into the pool. */
  spawnPickup(type, x, z, value = 1) {
    return this.pickups.spawn(type, x, z, value);
  }

  // -------------------------------------------------------------- ability
  onAbilityUsed(a) {
    const p = this.player;
    this.juice.addTrauma(0.2);
    this.audio.levelUp();
    this.fx.shockRing(p.x, p.z, 5, [1, 1, 1], 0.5);
    if (a.globalShock) {
      p.globalShock = a.duration;
      for (const e of this.enemies.list) {
        if (!e.alive) continue;
        e.shockT = a.duration;
        e.stunT = Math.max(e.stunT, 0.5);
        this.beams.bolt(e.x, e.baseY, e.z, e.x + (Math.random() - 0.5) * 5, e.baseY, e.z + (Math.random() - 0.5) * 5, {
          color: [0.72, 0.55, 1], width: 0.32, dur: 0.35, jitter: 1.0,
        });
      }
      this.shock.spawn({ x: p.x, z: p.z, r0: 1, r1: 26, dur: 0.85, color: [0.72, 0.5, 1] });
      this.juice.screenFlash('#b08bff', 0.35, 0.45);
      this.audio.zap();
    }
    if (a.beacon) p.dropBeacon(a.duration, 4.5);
    if (a.freezeRadius) {
      const r = a.freezeRadius * p.stats.get('area');
      for (const e of this.enemies.list) {
        if (!e.alive) continue;
        if (dist(e.x, e.z, p.x, p.z) < r) {
          e.freezeT = a.duration;
          e.stunT = Math.max(e.stunT, a.duration * 0.6);
        }
      }
      this.decal.spawn({ x: p.x, z: p.z, r, dur: 3, color: [0.18, 0.5, 0.95] });
      this.shock.spawn({ x: p.x, z: p.z, r0: 1, r1: r, dur: 0.65, color: [0.5, 0.9, 1] });
      this.juice.screenFlash('#8fe8ff', 0.32, 0.45);
      for (const e of this.enemies.list) {
        if (e.alive && dist(e.x, e.z, p.x, p.z) < r) this.fx.frost(e.x, e.baseY, e.z, [0.6, 0.9, 1]);
      }
    }
    if (a.barrage) {
      for (let i = 0; i < a.barrage; i++) {
        window.setTimeout(() => {
          if (!this.player?.alive) return;
          const aim = this.aimVector();
          const m = this.muzzlePosition({});
          this.projectiles.spawn({
            kind: 'grenade',
            x: m.x,
            y: m.y + 0.3,
            z: m.z,
            vx: aim.x * 24,
            vy: 9,
            vz: aim.z * 24,
            speed: 24,
            damage: 42 * p.stats.get('damage'),
            fuse: 0.5,
            radius: 3.8 * (p.rules.blastRadius ?? 1),
            knock: 9,
            color: [1, 0.45, 0.2],
            life: 3.2,
            element: 'fire',
          });
          this.fx.muzzleFlash(m.x, m.y, m.z, aim.x, aim.z, [1, 0.45, 0.2], 1.7);
          this.audio.shot('grenade');
          this.juice.addTrauma(0.12);
        }, i * 110);
      }
    }
  }

  // -------------------------------------------------------------- aiming
  aimVector() {
    const p = this.player;
    if (!p) return { x: 1, z: 0, target: null };
    const e = this.nearestEnemy(p.x, p.z, 30);
    if (e) {
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      return { x: dx / l, z: dz / l, target: e };
    }
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > 0.5) return { x: p.vx / sp, z: p.vz / sp, target: null };
    return { x: Math.cos(p.facing), z: Math.sin(p.facing), target: null };
  }

  muzzlePosition() {
    const p = this.player;
    const local = p.muzzleLocal;
    const cos = Math.cos(p.facing);
    const sin = Math.sin(p.facing);
    const lx = local.x * 0.95;
    const lz = local.z * 0.95;
    return {
      x: p.x + lx * cos + lz * sin,
      y: local.y,
      z: p.z - lx * sin + lz * cos,
    };
  }

  shellCasing(x, y, z) {
    this.fx.shard.emit({
      x, y, z,
      vx: (Math.random() - 0.5) * 4.5,
      vy: 3 + Math.random() * 2.4,
      vz: (Math.random() - 0.5) * 4.5,
      color: [1, 0.78, 0.32],
      size: 0.14,
      life: 0.75,
      drag: 1,
      gravity: 15,
      bounce: true,
      spin: Math.random() * 6,
      spinV: (Math.random() - 0.5) * 22,
    });
  }

  spawnBullet(cfg) {
    const a = cfg.angle;
    const p = this.projectiles.spawn({
      kind: 'bullet',
      y: cfg.y ?? 1.0,
      vx: Math.cos(a) * cfg.speed,
      vz: Math.sin(a) * cfg.speed,
      element: cfg.weapon?.def?.element ?? 'kinetic',
      ...cfg,
    });
    p.angle = a;
    return p;
  }

  spawnBolt(cfg) {
    const a = cfg.angle;
    const p = this.projectiles.spawn({
      kind: 'bolt',
      element: 'arc',
      vx: Math.cos(a) * cfg.speed,
      vz: Math.sin(a) * cfg.speed,
      ...cfg,
    });
    p.angle = a;
    return p;
  }

  spawnGrenade(cfg) {
    const a = cfg.angle;
    const p = this.projectiles.spawn({
      kind: 'grenade',
      element: 'fire',
      vx: Math.cos(a) * cfg.speed,
      vz: Math.sin(a) * cfg.speed,
      vy: cfg.arc ?? 7,
      ...cfg,
    });
    this.fx.muzzleFlash(cfg.x, cfg.y, cfg.z, Math.cos(a), Math.sin(a), cfg.color, 1.25);
    return p;
  }

  spawnMissile(cfg) {
    const air = this.projectiles.items.reduce((n, q) => n + (q.kind === 'missile' ? 1 : 0), 0);
    if (air >= (cfg.maxAir ?? 6)) return null;
    const aim = this.aimVector();
    const a = aim.target
      ? Math.atan2(aim.target.z - cfg.z, aim.target.x - cfg.x)
      : this.player.facing + (Math.random() - 0.5) * 0.8;
    const sp = cfg.speed ?? 15;
    const off = (cfg.offset ?? 0) * 0.35;
    return this.projectiles.spawn({
      kind: 'missile',
      element: 'fire',
      vx: Math.cos(a + off) * sp * 0.5,
      vz: Math.sin(a + off) * sp * 0.5,
      height: 0.4,
      target: aim.target,
      ...cfg,
    });
  }

  // ----------------------------------------------------------- railgun
  railgunChargeStart(w) {
    const m = this.muzzlePosition();
    const aim = this.aimVector();
    this.beams.lance(m.x, m.y, m.z, m.x + aim.x * 2.6, m.y, m.z + aim.z * 2.6, {
      color: [1, 0.42, 0.45],
      width: 0.14,
      dur: w.stats.charge,
    });
    this.fx.glow.emit({
      x: m.x, y: m.y, z: m.z,
      color: [1, 0.55, 0.5],
      size: 0.3 + (1 - w.charge / w.stats.charge) * 0.8,
      life: 0.1,
      drag: 0,
    });
    if (this.effectsOn) {
      this.fx.trailPuff(
        m.x + aim.x * 0.4, m.y, m.z + aim.z * 0.4,
        [1, 0.4, 0.4], 0.3, 0.3,
      );
    }
  }

  railgunFire(w) {
    const p = this.player;
    const s = w.stats;
    const m = this.muzzlePosition();
    const aim = this.aimVector();
    const stats = p.stats;
    const res = computeDamage(s.damage, {
      critChance: stats.get('critChance'),
      critDamage: stats.get('critDamage'),
      rng: Math.random,
      variance: 0.06,
    });
    const ang = Math.atan2(aim.z, aim.x);
    this.projectiles.spawn({
      kind: 'railgun',
      x: m.x,
      y: m.y,
      z: m.z,
      angle: ang,
      vx: Math.cos(ang) * s.speed,
      vz: Math.sin(ang) * s.speed,
      speed: s.speed,
      damage: res.damage,
      life: s.range / s.speed,
      radius: s.size,
      knock: s.knock,
      color: [1, 0.35, 0.42],
      pierce: 99,
      element: 'arc',
      tracer: true,
      canCrit: false,
      noCrit: true,
      explode: {
        radius: s.radius,
        damage: s.damage * 0.45,
        knock: s.knock * 0.6,
        color: [1, 0.42, 0.35],
        element: 'arc',
      },
      blastOnly: true,
    });
    this.beams.lance(m.x, m.y, m.z, m.x + Math.cos(ang) * 26, m.y, m.z + Math.sin(ang) * 26, {
      color: [1, 0.55, 0.5],
      width: 0.85,
      dur: 0.2,
    });
    this.fx.muzzleFlash(m.x, m.y, m.z, Math.cos(ang), Math.sin(ang), [1, 0.4, 0.4], 2.4);
    this.shock.spawn({ x: m.x, z: m.z, r0: 0.5, r1: 4, dur: 0.3, color: [1, 0.5, 0.4] });
    this.juice.addTrauma(0.4);
    this.juice.hitstop(this.loop, 0.06);
    this.juice.fovPunch(5, 0.22);
    this.audio.shot('railgun');
  }

  // ----------------------------------------------------------- orbital
  orbitalStrike(w) {
    const p = this.player;
    const s = w.stats;
    const stats = p.stats;
    const orbs = [];
    for (let i = 0; i < s.count; i++) {
      const a = w.orbitAngle + (i / s.count) * Math.PI * 2;
      const ox = p.x + Math.cos(a) * s.radius;
      const oz = p.z + Math.sin(a) * s.radius;
      orbs.push({ a, ox, oz });

      this.fx.trailPuff(ox, 1.1, oz, [0.5, 1, 0.7], 0.42, 0.3);
      if (this.effectsOn && Math.random() < 0.5) {
        this.fx.spark.emit({
          x: ox, y: 1.1, z: oz,
          vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3,
          color: [0.5, 1, 0.72], size: 0.22, life: 0.24, drag: 4,
        });
      }

      // hit everything within reach of the orb
      for (const e of this.enemies.list) {
        if (!e.alive) continue;
        const reach = e.radius + 0.85;
        if (dist(e.x, e.z, ox, oz) > reach) continue;
        const res = computeDamage(s.damage, {
          critChance: stats.get('critChance'),
          critDamage: stats.get('critDamage'),
          rng: Math.random,
          variance: 0.1,
        });
        p.damageDealt += e.damage(res.damage, 'orbital', { color: [0.5, 1, 0.72] });
        const l = Math.hypot(e.x - ox, e.z - oz) || 1;
        e.knockX += ((e.x - ox) / l) * s.knock;
        e.knockZ += ((e.z - oz) / l) * s.knock;
        this.fx.hitSparks(e.x, e.baseY, e.z, (e.x - ox) / l, (e.z - oz) / l, [0.5, 1, 0.72], 1.1);
        this.floaters.spawn(e.x, e.baseY + 1.3, e.z, `${Math.round(res.damage)}`, res.crit ? 'crit' : 'dmg');
      }
    }
    this._orbitMeshes(orbs);
  }

  _orbitMeshes(orbs) {
    const p = this.player;
    if (!this.orbitGroup) {
      this.orbitGroup = new THREE.Group();
      this.scene.add(this.orbitGroup);
      this.orbitMeshes = [];
    }
    while (this.orbitMeshes.length < orbs.length) {
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42, 0),
        new THREE.MeshBasicMaterial({ color: '#7dffb0', toneMapped: false }),
      );
      this.orbitGroup.add(m);
      this.orbitMeshes.push(m);
    }
    for (let i = 0; i < this.orbitMeshes.length; i++) {
      const m = this.orbitMeshes[i];
      const o = orbs[i];
      m.visible = !!o;
      if (o) {
        m.position.set(o.ox, 1.15, o.oz);
        m.rotation.y += 0.2;
        m.rotation.x += 0.12;
      }
    }
  }

  // -------------------------------------------------------------- frost
  frostCone(w, s) {
    const p = this.player;
    const aim = this.aimVector();
    const m = this.muzzlePosition();
    const stats = p.stats;
    const baseAngle = Math.atan2(aim.z, aim.x);
    const dmg = s.damage * p.stats.get('damage');
    const hits = new Map();

    // Frost Lance is a 12 shots/s weapon, so the per-shot effect budget is
    // declared in weaponDefs and read here. Ground patches scatter along the
    // cone rather than stacking on one spot ahead of the muzzle, which used to
    // read as a single solid disc.
    const fxb = s.fx;
    for (let i = 0; i < fxb.puffs; i++) {
      const a = baseAngle + (Math.random() - 0.5) * s.cone * 2;
      const d = s.range * (0.25 + Math.random() * 0.75);
      const x = m.x + Math.cos(a) * d;
      const z = m.z + Math.sin(a) * d;
      this.fx.frost(x, 0.5 + Math.random() * 0.9, z, [0.3, 0.62, 0.8], fxb.motes);
      if (Math.random() < fxb.trail) {
        this.fx.trailPuff(x, 0.8, z, [0.4, 0.68, 0.85], 0.34, 0.26);
      }
      if (this.effectsOn && Math.random() < fxb.decal) {
        this.decal.spawn({ x, z, r: 1.1 + Math.random() * 0.7, dur: 1.3, color: [0.12, 0.34, 0.62] });
      }
    }

    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const dx = e.x - m.x;
      const dz = e.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d > s.range + e.radius) continue;
      const dot = d < 0.01 ? 1 : (dx / d) * Math.cos(baseAngle) + (dz / d) * Math.sin(baseAngle);
      if (dot < Math.cos(s.cone) - 0.12) continue;
      const res = computeDamage(dmg, {
        critChance: stats.get('critChance'),
        critDamage: stats.get('critDamage'),
        rng: Math.random,
        variance: 0.16,
      });
      const dealt = e.damage(res.damage, 'frost', { color: [0.5, 0.9, 1] });
      p.damageDealt += dealt;
      e.slowT = Math.max(e.slowT, s.slowDur);
      const slow = Math.min(0.85, s.slow + (p.rules.extraSlow ?? 0));
      e.slowMul = Math.min(e.slowMul, 1 - slow);
      const ls = stats.get('lifesteal');
      if (ls > 0) p.heal(res.damage * ls);
      if (this.effectsOn && Math.random() < 0.3) {
        this.fx.hitSparks(e.x, e.baseY, e.z, dx / d, dz / d, [0.5, 0.9, 1], 0.5);
      }
      if (Math.random() < 0.06) {
        this.floaters.spawn(e.x, e.baseY + 1.3, e.z, `${Math.round(res.damage)}`, 'dmg');
      }
    }
  }

  // ------------------------------------------------------ enemy attacks
  enemyShoot(e, nx, nz, speed, damage) {
    const spread = (Math.random() - 0.5) * 0.16;
    const a = Math.atan2(nz, nx) + spread;
    this.projectiles.spawn({
      kind: 'enemy',
      owner: 'enemy',
      x: e.x,
      y: e.baseY,
      z: e.z,
      angle: a,
      vx: Math.cos(a) * speed,
      vz: Math.sin(a) * speed,
      speed,
      damage,
      life: 3.4,
      radius: 0.42,
      knock: 3,
      color: e.color,
      element: 'arc',
    });
    this.fx.muzzleFlash(e.x, e.baseY, e.z, Math.cos(a), Math.sin(a), e.color, 0.7);
    this.audio.shot('swarm');
  }

  bossRing(e, count, speed, damage) {
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = base + (i / count) * Math.PI * 2;
      this.projectiles.spawn({
        kind: 'enemy',
        owner: 'enemy',
        x: e.x,
        y: e.baseY,
        z: e.z,
        angle: a,
        vx: Math.cos(a) * speed,
        vz: Math.sin(a) * speed,
        speed,
        damage,
        life: 4,
        radius: 0.55,
        knock: 5,
        color: e.color,
        element: 'arc',
      });
    }
    this.shock.spawn({ x: e.x, z: e.z, r0: 1, r1: 5, dur: 0.45, color: e.color });
    this.fx.muzzleFlash(e.x, e.baseY, e.z, 1, 0, e.color, 2);
    this.audio.shot('tesla');
  }

  bossSpiral(e, count, speed) {
    e.spiralA = (e.spiralA ?? 0) + 0.42;
    for (let i = 0; i < count; i++) {
      const a = e.spiralA + (i / count) * Math.PI * 2;
      this.projectiles.spawn({
        kind: 'enemy',
        owner: 'enemy',
        x: e.x,
        y: e.baseY,
        z: e.z,
        angle: a,
        vx: Math.cos(a) * speed,
        vz: Math.sin(a) * speed,
        speed,
        damage: e.contactDamage * 0.5,
        life: 5,
        radius: 0.5,
        knock: 4,
        color: e.color,
        element: 'arc',
      });
    }
    this.audio.shot('tesla');
  }

  bossIce(e) {
    const r = e.def.iceRadius ?? 13;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const x = this.player.x + Math.cos(a) * r;
      const z = this.player.z + Math.sin(a) * r;
      this.decal.spawn({ x, z, r: 2.6, dur: 1.1, color: [0.2, 0.6, 1] });
    }
    this.shock.spawn({ x: this.player.x, z: this.player.z, r0: 1, r1: r, dur: 0.6, color: [0.6, 0.9, 1] });
    window.setTimeout(() => {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const x = this.player.x + Math.cos(a) * r;
        const z = this.player.z + Math.sin(a) * r;
        this.fx.explosion(x, 0.5, z, 2.6, [0.5, 0.9, 1]);
        for (const en of this.enemies.list) {
          if (en.alive && dist(en.x, en.z, x, z) < 2.6) en.freezeT = 2.5;
        }
        if (this.player?.alive && dist(this.player.x, this.player.z, x, z) < 3.4) {
          this.player.damage(e.contactDamage * 0.5, e);
        }
      }
      this.audio.explosion(1.3);
      this.juice.addTrauma(0.3);
    }, 620);
  }

  bossSummon(e, id, count) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const m = this.enemies.spawn(id, e.x + Math.cos(a) * 3.5, e.z + Math.sin(a) * 3.5, this.wave, this.difficulty);
      if (m) {
        this.fx.shockRing(m.x, m.z, 2, e.color, 0.4);
      }
    }
    this.audio.zap();
  }

  bossPull(e) {
    const p = this.player;
    const R = e.def.pullRadius ?? 20;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < R && d > 0.1) {
      const k = (1 - d / R) * 26;
      p.vx += (dx / d) * k;
      p.vz += (dz / d) * k;
    }
    this.decal.spawn({ x: e.x, z: e.z, r: R, dur: 1.1, color: [0.35, 0.12, 0.7] });
    this.shock.spawn({ x: e.x, z: e.z, r0: R, r1: 2, dur: 0.5, color: [0.6, 0.3, 1] });
  }

  /** Convenience wrapper: expanding ground shockwave ring. */
  shockRing(x, z, radius, color, dur = 0.4) {
    return this.shock.spawn({ x, z, r0: 0.5, r1: radius, dur, color, width: 0.34 });
  }

  // ------------------------------------------------------------ queries
  nearestEnemy(x, z, maxDist, filter) {
    let best = null;
    let bd = maxDist * maxDist;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      if (filter && !filter(e)) continue;
      const dx = e.x - x;
      const dz = e.z - z;
      const dd = dx * dx + dz * dz;
      if (dd < bd) {
        bd = dd;
        best = e;
      }
    }
    return best;
  }

  /**
   * Pull the camera back when the arena gets crowded so the player can still
   * read threats, and snap in during boss fights.
   */
  _updateCameraZoom(dt) {
    // The title screen drives the camera itself for its slow orbit; don't fight
    // it from here.
    if (this.state === STATE.MENU || this.state === STATE.CHARACTER) return;
    const crowd = Math.min(1, this.enemies.countAlive() / 55);
    const bossPull = this.bossEntity?.alive ? 0.3 : 0;
    const want = 1 + Math.max(crowd, bossPull) * CAMERA.crowdZoom;
    const clamped = Math.min(CAMERA.crowdZoomMax, want);
    this.camZoom = damp(this.camZoom ?? 1, clamped, 2.2, dt);
    const base = this.juice.baseOffset;
    const t = clamp((this.camZoom - 1) / (CAMERA.crowdZoomMax - 1), 0, 1);
    base.z = CAMERA.distance * (1 + t * 0.22);
    this.juice.basePos.y = CAMERA.height * (1 + t * 0.16);
  }

  // ------------------------------------------------------------- render
  render(dt, realDt) {
    this._trackFps(realDt);
    this._updateCameraZoom(realDt);
    this.juice.update(realDt, realDt, this.camTarget.x, this.camTarget.z);
    this.arena.update(realDt, this.time, this.camTarget.x, this.camTarget.z);
    this.floaters.project(window.innerWidth, window.innerHeight);
    this.postfx.render(dt, this.time);
  }

  destroy() {
    this.loop.stop();
    this.input.dispose();
    this.player?.dispose();
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.floaterLayer.remove();
    this.juice.dispose();
    this.renderer.dispose();
  }
}
