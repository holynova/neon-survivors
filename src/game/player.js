import * as THREE from 'three';
import { PLAYER, ARENA, XP } from './config.js';
import { StatBlock } from './stats.js';
import { clamp, damp, wrapDelta } from '../core/math.js';
import { makeEnemyMaterial } from '../fx/enemyMaterial.js';

const HEAD_Y = 1.5;

/**
 * Per-character player models.
 *
 * All five share a common skeleton (root → torso → head → arm → muzzle) so the
 * update/render code can stay generic, but each gets a distinct silhouette:
 * you should be able to name the character from a 40px silhouette alone.
 */
const BUILDERS = {
  // Vanguard: balanced, shoulder pads, wide visor, a stubby shotgun
  hunter: (mats) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.5, 6, 14), mats.body);
    body.position.y = 0.86;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), mats.body);
    head.position.y = 1.44;
    g.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.08), mats.neon);
    visor.position.set(0, 1.46, 0.28);
    g.add(visor);
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.4), mats.neon);
      pad.position.set(s * 0.5, 1.16, 0);
      g.add(pad);
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.86), mats.body);
    arm.position.set(0.44, 1.0, 0.4);
    g.add(arm);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.22), mats.neon);
    muzzle.position.set(0.44, 1.0, 0.9);
    g.add(muzzle);
    g.userData.muzzle = new THREE.Vector3(0.44, 1.0, 0.92);
    return g;
  },

  // Engineer: hunched, backpack, twin arm-mounted guns
  engineer: (mats) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.4, 6, 14), mats.body);
    body.position.y = 0.78;
    g.add(body);
    // backpack: the identifying mass
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.62, 0.34), mats.body);
    pack.position.set(0, 0.98, -0.36);
    g.add(pack);
    for (let i = 0; i < 3; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), mats.neon);
      vent.position.set(0, 0.8 + i * 0.18, -0.55);
      g.add(vent);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.42), mats.body);
    head.position.y = 1.32;
    g.add(head);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.06), mats.neon);
    eye.position.set(0, 1.34, 0.22);
    g.add(eye);
    // antenna
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), mats.neon);
    ant.position.set(0.14, 1.7, -0.1);
    ant.rotation.z = -0.3;
    g.add(ant);
    for (const s of [-1, 1]) {
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.62), mats.body);
      gun.position.set(s * 0.4, 0.98, 0.34);
      g.add(gun);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.14), mats.neon);
      tip.position.set(s * 0.4, 0.98, 0.68);
      g.add(tip);
    }
    g.userData.muzzle = new THREE.Vector3(0.4, 0.98, 0.72);
    return g;
  },

  // Demolitionist: heavy, squat, drum launcher on the shoulder
  demo: (mats) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.72, 0.7), mats.body);
    body.position.y = 0.78;
    g.add(body);
    // chest plate
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.16), mats.body);
    plate.position.set(0, 0.86, 0.38);
    g.add(plate);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10), mats.neon);
    hatch.position.set(0, 0.86, 0.48);
    hatch.rotation.x = Math.PI / 2;
    g.add(hatch);
    // shoulder drum launcher: a big horizontal drum
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.8, 12), mats.body);
    drum.position.set(0.34, 1.24, 0.3);
    drum.rotation.x = Math.PI / 2;
    g.add(drum);
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.035, 6, 14), mats.neon);
      band.position.set(0.34, 1.24, 0.05 + i * 0.25);
      g.add(band);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), mats.body);
    head.position.y = 1.32;
    head.scale.set(1, 0.85, 1);
    g.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.08), mats.neon);
    visor.position.set(0, 1.32, 0.24);
    g.add(visor);
    g.userData.muzzle = new THREE.Vector3(0.34, 1.24, 0.75);
    return g;
  },

  // Arcwelder: tall, thin, floating coil rings instead of shoulders
  welder: (mats) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.38, 0.9, 12), mats.body);
    body.position.y = 0.9;
    g.add(body);
    // two levitating rings
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46 - i * 0.12, 0.05, 8, 22), mats.neon);
      ring.position.y = 1.02 + i * 0.3;
      ring.rotation.x = Math.PI / 2;
      ring.userData.spin = i ? -1.4 : 1.1;
      g.add(ring);
    }
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), mats.body);
    head.position.y = 1.56;
    g.add(head);
    const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), mats.neon);
    eye.position.set(0, 1.56, 0.2);
    g.add(eye);
    // tesla prongs
    for (const s of [-1, 1]) {
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.66, 6), mats.neon);
      prong.position.set(s * 0.28, 1.06, 0.5);
      prong.rotation.x = Math.PI / 2;
      g.add(prong);
    }
    const arc = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), mats.neon);
    arc.position.set(0, 1.06, 0.78);
    g.add(arc);
    g.userData.muzzle = new THREE.Vector3(0, 1.06, 0.8);
    return g;
  },

  // Cryomancer: cloaked cone, crystal crown, orbiting shards
  cryo: (mats) => {
    const g = new THREE.Group();
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.56, 1.24, 10), mats.body);
    cloak.position.y = 0.66;
    g.add(cloak);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 6, 18), mats.neon);
    trim.position.y = 0.34;
    trim.rotation.x = Math.PI / 2;
    g.add(trim);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), mats.body);
    head.position.y = 1.34;
    g.add(head);
    // crystal crown: the identifying silhouette
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.46, 4), mats.neon);
      shard.position.set(Math.cos(a) * 0.26, 1.66, Math.sin(a) * 0.26);
      shard.rotation.z = Math.cos(a) * 0.34;
      shard.rotation.x = -Math.sin(a) * 0.34;
      g.add(shard);
    }
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.09, 0.08), mats.neon);
    visor.position.set(0, 1.34, 0.24);
    g.add(visor);
    // staff
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 6), mats.body);
    staff.position.set(0.46, 0.9, 0.16);
    staff.rotation.z = 0.12;
    g.add(staff);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), mats.neon);
    orb.position.set(0.55, 1.68, 0.16);
    g.add(orb);
    g.userData.muzzle = new THREE.Vector3(0.55, 1.68, 0.16);
    return g;
  },
};

function buildPlayerMesh(character) {
  // The player uses the same rim-lit material family as the enemies: a top-down
  // neon arena has almost no key light, and a standard material on a dark body
  // reads as a black blob. The stronger rim here keeps the hero readable.
  const body = makeEnemyMaterial({
    color: character.color,
    elite: true,
    small: false,
  });
  body.uniforms.uBase.value = new THREE.Color('#2b3468');
  body.uniforms.uRim.value = new THREE.Color(character.color);
  body.uniforms.uRimStrength.value = 1.45;
  body.uniforms.uEmissiveStrength.value = 0.3;
  body.uniforms.uFlashStrength.value = 0;

  const mats = {
    body,
    neon: new THREE.MeshBasicMaterial({ color: character.color }),
  };
  const builder = BUILDERS[character.shape] ?? BUILDERS.hunter;
  const g = builder(mats);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

function buildDrone() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.26),
    new THREE.MeshBasicMaterial({ color: '#6ff0ff' }),
  );
  g.add(core);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.045, 8, 20),
    new THREE.MeshBasicMaterial({ color: '#2b6cff' }),
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  return g;
}

export class Player {
  constructor(character, world) {
    this.character = character;
    this.world = world;
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.facing = 0;
    this.radius = PLAYER.radius;

    this.stats = new StatBlock();
    this.stats.add({ key: 'moveSpeed', value: character.stats.moveSpeed ?? 0, mode: 'pct' });
    this.stats.add({ key: 'attackSpeed', value: character.stats.attackSpeed ?? 0, mode: 'pct' });
    this.stats.add({ key: 'area', value: character.stats.area ?? 0, mode: 'pct' });
    this.stats.add({ key: 'damage', value: character.stats.damage ?? 0, mode: 'pct' });

    this.maxHp = this.stats.get('maxHp');
    this.hp = this.maxHp;
    this.alive = true;

    this.iframe = 0;
    this.dashCd = 0;
    this.dashT = 0;
    this.dashDirX = 0;
    this.dashDirZ = 0;
    this.afterimages = [];

    this.level = 1;
    this.xp = 0;
    this.xpNeed = XP_NEED(1);
    this.gold = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.runTime = 0;

    this.weapons = [];
    this.recipes = {};
    this.rules = { ...(character.rules ?? {}) };
    this.elementDmg = { fire: 1, frost: 1, arc: 1, kinetic: 1 };
    this.abilityDurationBonus = 0;
    this.abilityCd = 0;
    this.abilityActive = 0;
    this.abilityMods = null;
    this.killsSinceDrone = 0;
    this.drones = [];
    this.beacons = [];
    this.globalShock = 0;
    this.freeze = 0;
    this.trailTimer = 0;

    // --- mesh ---
    this.group = new THREE.Group();
    this.mesh = buildPlayerMesh(character);
    this.spinRings = this.mesh.children.filter((c) => c.userData.spin !== undefined);
    this.group.add(this.mesh);
    this.muzzleLocal = this.mesh.userData.muzzle ?? new THREE.Vector3(0.4, 1.0, 0.9);
    this.glow = new THREE.PointLight(new THREE.Color(character.color), 22, 16, 2);
    this.glow.position.y = 1.3;
    this.group.add(this.glow);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.68, 0.82, 40),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(character.color),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.group.add(this.ring);
    world.scene.add(this.group);
  }

  addWeapon(idOrInstance) {
    const { WeaponInstance } = this.world;
    if (typeof idOrInstance === 'string') {
      if (this.weapons.length >= 6) {
        const w = this.weapons.pop();
        this.weapons.push(w);
        return null;
      }
      const w = new WeaponInstance(idOrInstance, this);
      this.weapons.push(w);
      return w;
    }
    this.weapons.push(idOrInstance);
    return idOrInstance;
  }

  removeWeapon(id) {
    const i = this.weapons.findIndex((w) => w.def.id === id);
    if (i >= 0) this.weapons.splice(i, 1);
  }

  get abilityCooldown() {
    return 9 * this.stats.get('cooldown');
  }

  get abilityReady() {
    return this.abilityCd <= 0 && this.alive && this.abilityActive <= 0;
  }

  get pickupRange() {
    // Grows with level so late-game clears the whole arena without a card.
    const base = Math.min(PLAYER.pickupMax, PLAYER.pickupBase + this.level * PLAYER.pickupPerLevel);
    return base * this.stats.get('pickupRange');
  }

  heal(v) {
    if (!this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + v);
    const gained = this.hp - before;
    if (gained > 0.5) {
      this.world.floaters.spawn(this.x, 2.0, this.z, `+${Math.round(gained)}`, 'heal');
      this.world.fx.levelUp(this.x, 0.5, this.z, [0.4, 1, 0.6]);
    }
    return gained;
  }

  damage(amount, source = 'enemy') {
    if (!this.alive || this.iframe > 0) return 0;
    const dodge = this.stats.get('dodge');
    if (dodge > 0 && Math.random() < dodge) {
      this.world.floaters.spawn(this.x, 2.1, this.z, '闪避', 'dodge');
      return 0;
    }
    const armor = this.stats.get('armor');
    const dmg = Math.max(1, amount - armor);
    this.hp -= dmg;
    this.iframe = PLAYER.iframes;
    this.world.audio.hurt();
    this.world.juice.hurtFlash(clamp(dmg / 26, 0.3, 1));
    this.world.juice.addTrauma(clamp(dmg / 40, 0.2, 0.7));
    this.world.postfx.setHurt(clamp(dmg / 30, 0.2, 1));
    this.world.floaters.spawn(this.x, 2.2, this.z, `-${Math.round(dmg)}`, 'hurt');
    this.world.fx.hitSparks(this.x, 1.0, this.z, 0, 0, [1, 0.25, 0.3], 1.2);

    const thorns = this.stats.get('thorns');
    if (thorns > 0 && source && typeof source.damage === 'function') {
      source.damage(dmg * thorns, 'thorns', { color: [1, 0.8, 0.3], noCrit: true });
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.world.onPlayerDeath();
    }
    return dmg;
  }

  addXp(v) {
    if (!this.alive) return;
    this.xp += v * this.stats.get('xpGain');
    this.world.floaters.spawn(this.x, 2.4, this.z, `+${Math.round(v)} XP`, 'xp');
  }

  onKill(enemy, world) {
    this.kills++;
    this.killsSinceDrone++;
    const rules = this.rules;
    if (rules.dronePerKills && this.killsSinceDrone >= rules.dronePerKills && this.drones.length < (rules.droneMax ?? 4)) {
      this.killsSinceDrone = 0;
      this.spawnDrone();
    }
    if (rules.killCoinChance && Math.random() < rules.killCoinChance) {
      world.spawnPickup('coin', enemy.x, enemy.z, 3);
    }
    if (rules.blastXp && enemy.deadBy === 'blast') {
      this.addXp(enemy.xpValue * rules.blastXp);
    }
  }

  spawnDrone() {
    const mesh = buildDrone();
    this.world.scene.add(mesh);
    const d = {
      mesh,
      x: this.x,
      y: 1.6,
      z: this.z,
      angle: Math.random() * Math.PI * 2,
      target: null,
      cd: 0,
      life: 0,
    };
    this.drones.push(d);
    this.world.fx.shockRing(d.x, d.z, 1.4, [0.4, 0.9, 1], 0.4);
  }

  updateDrones(dt) {
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      d.life += dt;
      d.angle += dt * 1.5;
      // orbit the player, seek nearest enemy
      const ox = this.x + Math.cos(d.angle) * 2.4;
      const oz = this.z + Math.sin(d.angle) * 2.4;
      d.x = damp(d.x, ox, 7, dt);
      d.z = damp(d.z, oz, 7, dt);
      d.y = 1.6 + Math.sin(d.life * 3) * 0.18;
      d.mesh.position.set(d.x, d.y, d.z);
      d.mesh.rotation.y += dt * 3;
      d.cd -= dt;
      if (d.cd <= 0) {
        const e = this.world.nearestEnemy(d.x, d.z, 14);
        if (e) {
          d.target = e;
          d.cd = 0.28;
          const a = Math.atan2(e.z - d.z, e.x - d.x);
          this.world.spawnBullet({
            owner: 'drone',
            x: d.x,
            y: d.y,
            z: d.z,
            angle: a,
            speed: 46,
            damage: 6 * this.stats.get('damage'),
            life: 0.4,
            radius: 0.18,
            knock: 0.5,
            color: [0.45, 0.95, 1],
            tracer: true,
            canCrit: true,
            critStats: true,
          });
          this.world.fx.trailPuff(d.x, d.y, d.z, [0.5, 0.95, 1], 0.2, 0.14);
        }
      }
      if (this.world.fx) this.world.fx.trailPuff(d.x, d.y, d.z, [0.3, 0.7, 1], 0.16, 0.12);
      if (d.life > 14) {
        d.mesh.removeFromParent();
        this.drones.splice(i, 1);
      }
    }
  }

  useAbility() {
    if (!this.abilityReady) return false;
    const a = this.character.ability;
    this.abilityCd = this.abilityCooldown;
    this.abilityActive = a.duration + this.abilityDurationBonus;
    this.abilityMods = a.mods ?? null;
    this.world.onAbilityUsed(a);
    return true;
  }

  update(dt, input, world) {
    this.runTime += dt;
    const ax = input ? input.x : 0;
    const az = input ? -input.y : 0;

    // dash
    this.dashCd = Math.max(0, this.dashCd - dt);
    if (this.iframe > 0) this.iframe -= dt;
    if (this.abilityCd > 0) this.abilityCd -= dt;
    if (this.abilityActive > 0) {
      this.abilityActive -= dt;
      if (this.abilityActive <= 0) this.abilityMods = null;
    }
    if (this.globalShock > 0) this.globalShock -= dt;
    if (this.freeze > 0) this.freeze -= dt;

    let speed = this.stats.get('moveSpeed');
    if (this.abilityMods?.moveSpeed) speed *= 1 + this.abilityMods.moveSpeed;
    if (this.freeze > 0) speed *= 0.55;

    const dashing = input && input.dash && this.dashCd <= 0 && (ax !== 0 || az !== 0) && this.alive;
    if (dashing) {
      const len = Math.hypot(ax, az) || 1;
      this.dashDirX = ax / len;
      this.dashDirZ = az / len;
      this.dashT = PLAYER.dash.dur;
      this.dashCd = PLAYER.dash.cd * this.stats.get('dashCooldown');
      this.iframe = Math.max(this.iframe, PLAYER.dash.dur + 0.1);
      world.audio.dash();
      world.juice.addTrauma(0.08);
      world.fx.dust(this.x, this.z, 0.6, [0.6, 0.8, 1], 12, 5);
      world.shockRing(this.x, this.z, 1.8, [0.6, 0.9, 1], 0.3);
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      const ds = speed * PLAYER.dash.speedMul;
      this.vx = this.dashDirX * ds;
      this.vz = this.dashDirZ * ds;
      this.spawnAfterimage();
    } else if (this.alive) {
      const targetVx = ax * speed;
      const targetVz = az * speed;
      this.vx = damp(this.vx, targetVx, 16, dt);
      this.vz = damp(this.vz, targetVz, 16, dt);
    } else {
      this.vx *= 0.9;
      this.vz *= 0.9;
    }

    this.x = clamp(this.x + this.vx * dt, -ARENA.half + this.radius, ARENA.half - this.radius);
    this.z = clamp(this.z + this.vz * dt, -ARENA.half + this.radius, ARENA.half - this.radius);

    if (ax !== 0 || az !== 0) {
      this.facing = Math.atan2(az, ax);
    }

    // visuals
    this.group.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = -this.facing + Math.PI / 2;
    const bob = Math.hypot(this.vx, this.vz) / Math.max(1, speed);
    this.mesh.position.y = Math.sin(this.runTime * 13) * 0.055 * bob;
    this.mesh.rotation.z = Math.sin(this.runTime * 13) * 0.045 * bob;
    // levitating rings (arcwelder) and crown shards keep their own spin so the
    // silhouette animates even when standing still
    if (this.spinRings?.length) {
      for (const r of this.spinRings) r.rotation.z += dt * r.userData.spin;
    }
    this.ring.rotation.z += dt * 0.7;
    this.ring.material.opacity = 0.35 + 0.2 * Math.sin(this.runTime * 3);
    this.glow.intensity = 18 + (this.abilityActive > 0 ? 26 : 0) + Math.sin(this.runTime * 9) * 3;

    // afterimages decay
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const g = this.afterimages[i];
      g.t += dt;
      if (g.t > 0.3) {
        g.mesh.removeFromParent();
        g.mat.dispose();
        this.afterimages.splice(i, 1);
      } else {
        g.mat.opacity = 0.5 * (1 - g.t / 0.3);
      }
    }

    this.updateDrones(dt);
    this.updateBeacons(dt);

    // frost trail
    if (this.rules.frostTrail && Math.hypot(this.vx, this.vz) > 2) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.09;
        const p = (this.rules.trailPower ?? 1);
        world.decal.spawn({
          x: this.x,
          z: this.z,
          r: 1.5 * p,
          dur: 2.4,
          color: [0.18, 0.45 * p, 0.7],
        });
        world.fx.frost(this.x, 0.4, this.z, [0.4, 0.85, 1]);
      }
    }

    // regen
    const regen = this.stats.get('hpRegen');
    if (regen > 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + regen * dt);
  }

  spawnAfterimage() {
    if (this.afterimages.length > 5) return;
    if (Math.random() > 0.5) return;
    // One material per ghost: they fade on independent timers, and a shared
    // material would make the newest ghost's opacity win for all of them.
    const mat = new THREE.MeshBasicMaterial({
      color: this.character.color,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const m = this.mesh.clone(true);
    m.traverse((o) => {
      if (o.isMesh) o.material = mat;
      o.castShadow = false;
    });
    m.position.copy(this.mesh.position);
    m.rotation.copy(this.mesh.rotation);
    this.world.scene.add(m);
    this.afterimages.push({ mesh: m, mat, t: 0 });
  }

  updateBeacons(dt) {
    for (let i = this.beacons.length - 1; i >= 0; i--) {
      const b = this.beacons[i];
      b.t += dt;
      if (b.t >= b.dur) {
        b.mesh.removeFromParent();
        this.beacons.splice(i, 1);
        continue;
      }
      const k = b.t / b.dur;
      b.mesh.rotation.y += dt * 1.4;
      b.mesh.material.opacity = 0.55 * (1 - k * 0.6);
      b.ring.rotation.y -= dt * 2;
      b.ring.material.opacity = 0.7 * (1 - k);
      this.heal(b.rate * dt * (this.rules.beaconPower ?? 1));
      this.world.fx.trailPuff(b.x + rand(-1, 1), 0.3, b.z + rand(-1, 1), [0.4, 1, 0.6], 0.3, 0.5);
    }
  }

  dropBeacon(duration, rate) {
    const g = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.28, 3, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: '#4dff9d',
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    pillar.position.y = 1.5;
    g.add(pillar);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.7, 32),
      new THREE.MeshBasicMaterial({
        color: '#4dff9d',
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotateX(-Math.PI / 2);
    ring.position.y = 0.08;
    g.add(ring);
    g.position.set(this.x, 0, this.z);
    this.world.scene.add(g);
    this.beacons.push({ mesh: g, ring, x: this.x, z: this.z, t: 0, dur: duration, rate });
    this.world.fx.shockRing(this.x, this.z, 4, [0.3, 1, 0.6], 0.5);
  }

  onDeathVisual(world) {
    world.fx.explosion(this.x, 1, this.z, 5, [1, 0.4, 0.5], Math.random);
    world.juice.screenFlash('#ff3355', 0.6, 0.4);
    world.juice.addTrauma(1);
    this.group.visible = false;
    for (const d of this.drones) d.mesh.removeFromParent();
    this.drones.length = 0;
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this.drones) d.mesh.removeFromParent();
    for (const a of this.afterimages) {
      a.mesh.removeFromParent();
      a.mat.dispose();
    }
    for (const b of this.beacons) b.mesh.removeFromParent();
  }
}

export function XP_NEED(lvl) {
  return XP.need(lvl);
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

export { HEAD_Y };
