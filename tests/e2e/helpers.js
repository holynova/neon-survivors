import { expect } from '@playwright/test';

/**
 * Shared helpers for the e2e suite.
 *
 * Two rules the whole suite depends on:
 *  1. Any unexpected pageerror/console.error fails the test. A large share of
 *     the bugs found in this project were "some method is undefined at runtime",
 *     which otherwise surfaces only as a silently broken feature.
 *  2. Game state is reached through the debug hooks rather than by waiting for
 *     real gameplay, so tests are fast and deterministic.
 */

export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Three.js warns about a few deprecated things we do not control.
    if (/deprecated|has been removed/i.test(t)) return;
    errors.push('[console] ' + t.slice(0, 200));
  });
  return errors;
}

export async function boot(page, url = '/') {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__NS__?.game, null, { timeout: 20000 });
  // expose `g` for terse evaluates
  await page.evaluate(() => {
    window.g = window.__NS__.game;
  });
}

export async function startRun(page, char = 'vanguard', diff = 'normal') {
  await page.evaluate(
    ([c, d]) => window.__NS__.start(c, d),
    [char, diff],
  );
  await page.waitForFunction(() => window.__NS__.game.state === 'playing', null, {
    timeout: 5000,
  });
}

/** Skip the prep phase and get straight into a fight at `wave`. */
export async function skipToWave(page, wave) {
  await page.evaluate((w) => window.__NS__.game.debugSkipToCombat(w), wave);
  await page.waitForFunction(
    (w) => window.__NS__.game.wave >= w,
    wave,
    { timeout: 5000 },
  );
}

/** Poll a page-side expression until it is truthy. */
export async function until(page, fn, arg, timeout = 8000) {
  await page.waitForFunction(fn, arg, { timeout, polling: 100 });
}

export const state = (page) => page.evaluate(() => window.__NS__.game.state);

export const player = (page) =>
  page.evaluate(() => {
    const p = window.__NS__.game.player;
    if (!p) return null;
    return {
      x: p.x,
      z: p.z,
      hp: p.hp,
      maxHp: p.maxHp,
      level: p.level,
      kills: p.kills,
      gold: p.gold,
      damage: p.damageDealt,
      alive: p.alive,
      weapons: p.weapons.map((w) => ({ id: w.def.id, level: w.level })),
    };
  });

export async function expectNoErrors(errors, where) {
  expect(errors, `unexpected runtime errors during ${where}: ${errors.join(' | ')}`).toEqual(
    [],
  );
}
