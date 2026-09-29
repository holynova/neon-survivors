import { WAVES, ECONOMY } from './config.js';
import { poolForWave, weightedPick, bossForWave, WAVES_BOSS_EVERY } from './enemyDefs.js';

/** Wave composition table. Pure (given an rng) → unit testable. */
export function wavePlan(wave, difficulty, rng = Math.random) {
  const isBoss = wave % WAVES_BOSS_EVERY === 0;
  const pool = poolForWave(wave);
  // Tuned so a 1v1 exchange stays winnable early while the screen still fills up.
  const budget = Math.round(
    (10 + wave * 4.2 + Math.pow(wave, 1.8) * 0.7) * difficulty.spawnMul,
  );
  const groups = [];
  let spent = 0;
  let guard = 0;
  while (spent < budget && guard++ < 400) {
    const def = weightedPick(pool, wave, rng);
    // cost heuristic: rarer types cost more of the budget
    const cost = def.hp > 150 ? 5 : def.hp > 60 ? 3 : def.hp > 25 ? 2 : 1;
    if (spent + cost > budget + 2) break;
    spent += cost;
    groups.push(def.id);
  }
  return {
    wave,
    isBoss,
    boss: isBoss ? bossForWave(wave)?.id ?? null : null,
    duration: isBoss ? WAVES.bossDuration : WAVES.duration,
    roster: groups,
    budget,
  };
}

export function isBossWave(wave) {
  return wave % WAVES_BOSS_EVERY === 0;
}

export function rollDrops(def, scale, rng, difficulty) {
  const coins = Math.round(rng.range(def.gold[0], def.gold[1]) * scale.gold * difficulty.goldMul);
  const xp = Math.max(1, Math.round(def.xp * scale.xp));
  const heal = !def.boss && rng.bool(0.018);
  return { coins, xp, heal };
}

export { WAVES, ECONOMY };
