import { WEAPONS, WEAPON_BY_ID, weaponStats, canLevelUp } from './weaponDefs.js';

export { WEAPONS, WEAPON_BY_ID, weaponStats, canLevelUp };

const rand = (a, b) => a + Math.random() * (b - a);

export function colorOf(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/**
 * Runtime weapon instance bound to a player.
 * Handles cooldown gating, muzzle position, and delegates the actual shot
 * pattern to the projectile system.
 */
export class WeaponInstance {
  constructor(defId, player) {
    this.def = WEAPON_BY_ID[defId];
    this.player = player;
    this.level = 1;
    this.cd = 0;
    this.charge = 0;
    this.heat = 0;         // smg ramp
    this.orbitAngle = Math.random() * Math.PI * 2;
    this.orbitTick = 0;
    this.orbitalTick = 0;
    this.recoil = 0;
    this.shotsFired = 0;
  }

  get stats() {
    const s = weaponStats(this.def, this.level);
    const st = this.player.stats;
    // StatBlock exposes values through get(key), not as plain fields
    const damage = st.get('damage');
    const attackSpeed = st.get('attackSpeed');
    const cooldown = st.get('cooldown');
    const area = st.get('area');
    const projectileSpeed = st.get('projectileSpeed');

    if (s.damage != null) s.damage *= damage;
    if (s.cd) s.cd /= attackSpeed * cooldown;
    if (s.cooldown) s.cooldown /= attackSpeed * cooldown;
    if (s.spin) s.spin *= attackSpeed;
    if (s.radius) s.radius *= area;
    if (s.range) s.range *= area;
    if (s.cone) s.cone *= 1 + (area - 1) * 0.6;
    if (s.speed) s.speed *= projectileSpeed;
    return s;
  }

  upgrade() {
    if (canLevelUp(this.def, this.level)) {
      this.level++;
      return true;
    }
    return false;
  }

  canEvolve(recipes) {
    const e = this.def.evolve;
    if (!e?.recipes) return false;
    for (const [k, n] of Object.entries(e.recipes)) {
      if ((recipes[k] ?? 0) < n) return false;
    }
    return true;
  }

  evolve(recipes) {
    if (!this.canEvolve(recipes)) return null;
    const e = this.def.evolve;
    for (const [k, n] of Object.entries(e.recipes)) recipes[k] -= n;
    const next = new WeaponInstance(e.id, this.player);
    next.level = this.level;
    this.player.removeWeapon(this.def.id);
    this.player.addWeapon(next);
    return next;
  }
}

/**
 * Fires every equipped weapon for this frame. `world` provides spawn helpers.
 */
export function updateWeapons(world, dt) {
  const p = world.player;
  if (!p.alive) return;
  for (const w of p.weapons) {
    w.cd -= dt;
    if (w.def.id === 'orbital') {
      w.orbitAngle += w.stats.spin * dt;
      w.orbitalTick -= dt;
      if (w.orbitalTick <= 0) {
        w.orbitalTick =
          w.stats.cd / (world.player.stats.get('attackSpeed') * world.player.stats.get('cooldown'));
        world.orbitalStrike(w);
      }
      continue;
    }
    if (w.def.id === 'railgun') {
      // charge-up before firing
      if (w.charge > 0) {
        w.charge -= dt;
        if (w.charge <= 0) {
          world.railgunFire(w);
          w.charge = w.stats.charge;
        }
      } else if (w.cd <= 0) {
        w.charge = w.stats.charge;
        w.cd = w.stats.cd;
        world.railgunChargeStart(w);
      }
      continue;
    }
    if (w.cd <= 0) {
      fireWeapon(world, w);
      const s = w.stats;
      w.cd = s.cd;
      w.shotsFired++;
      if (w.def.id === 'smg') w.heat = Math.min(1, w.heat + 0.09);
    }
    w.heat = Math.max(0, w.heat - dt * 0.35);
    w.recoil = Math.max(0, w.recoil - dt * 8);
  }
}

function fireWeapon(world, w) {
  const p = world.player;
  const s = w.stats;
  const aim = world.aimVector();
  const muzzle = world.muzzlePosition(w);
  switch (w.def.id) {
    case 'scatter': {
      const n = s.pellets;
      for (let i = 0; i < n; i++) {
        const a = (i / n - 0.5) * 2 * s.spread + rand(-0.05, 0.05);
        world.spawnBullet({
          owner: 'player',
          x: muzzle.x,
          y: muzzle.y,
          z: muzzle.z,
          angle: Math.atan2(aim.z, aim.x) + a,
          speed: s.speed * rand(0.9, 1.1),
          damage: s.damage,
          life: s.range / s.speed,
          radius: s.size,
          knock: s.knock,
          color: colorOf(w.def.color),
          weapon: w,
          canCrit: true,
        });
      }
      world.fx.muzzleFlash(muzzle.x, muzzle.y, muzzle.z, aim.x, aim.z, colorOf(w.def.color), 1.5);
      world.juice.addTrauma(0.14);
      world.audio.shot('shotgun');
      world.floaters.spawn(muzzle.x, muzzle.y + 0.4, muzzle.z, '', 'puff');
      break;
    }
    case 'smg': {
      const bonus = 1 + w.heat * 0.35;
      const count = s.multi ?? 1;
      for (let i = 0; i < count; i++) {
        world.spawnBullet({
          owner: 'player',
          x: muzzle.x,
          y: muzzle.y,
          z: muzzle.z,
          angle: Math.atan2(aim.z, aim.x) + rand(-s.jitter, s.jitter),
          speed: s.speed,
          damage: s.damage * bonus,
          life: s.range / s.speed,
          radius: s.size,
          knock: s.knock,
          color: colorOf(w.def.color),
          pierce: s.pierce ?? 0,
          weapon: w,
          tracer: true,
          canCrit: true,
        });
      }
      world.fx.muzzleFlash(muzzle.x, muzzle.y, muzzle.z, aim.x, aim.z, colorOf(w.def.color), 0.8);
      world.audio.shot('smg');
      world.shellCasing(muzzle.x, muzzle.y, muzzle.z);
      break;
    }
    case 'tesla': {
      const bolt = world.spawnBolt({
        x: muzzle.x,
        y: muzzle.y + 0.1,
        z: muzzle.z,
        angle: Math.atan2(aim.z, aim.x),
        speed: s.speed,
        damage: s.damage,
        life: s.range / s.speed,
        bounces: s.bounces,
        decay: s.decay,
        stun: s.stun,
        radius: s.size,
        color: colorOf(w.def.color),
        weapon: w,
      });
      world.fx.muzzleFlash(muzzle.x, muzzle.y, muzzle.z, aim.x, aim.z, colorOf(w.def.color), 1.1);
      world.juice.addTrauma(0.06);
      world.audio.shot('tesla');
      break;
    }
    case 'grenade': {
      const count = s.count ?? 1;
      for (let i = 0; i < count; i++) {
        world.spawnGrenade({
          x: muzzle.x,
          y: muzzle.y + 0.2,
          z: muzzle.z,
          angle: Math.atan2(aim.z, aim.x) + (count > 1 ? (i - 0.5) * 0.18 : 0),
          speed: s.speed,
          damage: s.damage,
          fuse: s.fuse,
          radius: s.radius,
          arc: s.arc,
          knock: s.knock,
          color: colorOf(w.def.color),
          weapon: w,
        });
      }
      world.fx.muzzleFlash(muzzle.x, muzzle.y, muzzle.z, aim.x, aim.z, colorOf(w.def.color), 1.4);
      world.juice.addTrauma(0.18);
      world.audio.shot('grenade');
      break;
    }
    case 'frost': {
      world.frostCone(w, s);
      break;
    }
    case 'swarm': {
      const n = s.count;
      for (let i = 0; i < n; i++) {
        world.spawnMissile({
          x: muzzle.x,
          y: muzzle.y + 0.15,
          z: muzzle.z,
          damage: s.damage,
          speed: s.speed,
          accel: s.accel,
          turn: s.turn,
          life: s.life,
          radius: s.radius,
          knock: s.knock,
          color: colorOf(w.def.color),
          weapon: w,
          maxAir: s.maxAir,
          offset: i * 0.6,
        });
      }
      world.fx.muzzleFlash(muzzle.x, muzzle.y, muzzle.z, aim.x, aim.z, colorOf(w.def.color), 0.9);
      world.audio.shot('swarm');
      break;
    }
    default:
      break;
  }
}
