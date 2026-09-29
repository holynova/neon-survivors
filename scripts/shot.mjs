import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Capture screenshots of the running game for visual review.
 *   node scripts/shot.mjs [url] [outDir]
 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173';
const outDir = process.argv[3] ?? 'shots';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=default',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('saved', `${outDir}/${name}.png`);
};

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__NS__?.game, null, { timeout: 20000 });
await page.waitForTimeout(1200);
await shot('01-menu');

// start a run
await page.evaluate(() => window.__NS__.start('vanguard', 'normal'));
await page.waitForTimeout(500);
await shot('02-prep');

// skip prep, enter combat
await page.evaluate(() => window.__NS__.game.debugSkipToCombat(3));
await page.waitForTimeout(2500);
await shot('03-combat');

// move around a bit while firing
await page.keyboard.down('KeyD');
await page.waitForTimeout(900);
await page.keyboard.up('KeyD');
await page.keyboard.down('KeyW');
await page.waitForTimeout(700);
await page.keyboard.up('KeyW');
await shot('04-moving');

// give weapons + level up to see the card screen
await page.evaluate(() => {
  const g = window.__NS__.game;
  g.debugGiveWeapon('tesla');
  g.debugGiveWeapon('grenade');
  g.debugGiveWeapon('railgun');
  g.player.weapons.forEach((w) => w.upgrade());
  g.debugLevelUp(1);
});
await page.waitForTimeout(700);
await shot('05-levelup');
await page.keyboard.press('Digit1');
await page.waitForTimeout(400);

// heavy effects
await page.evaluate(() => window.__NS__.game.debugKillAll());
await page.waitForTimeout(400);
await shot('06-effects');

// boss wave
await page.evaluate(() => window.__NS__.game.debugSkipToCombat(5));
await page.waitForTimeout(4000);
await shot('07-boss');

// performance sample
const stats = await page.evaluate(async () => {
  const g = window.__NS__.game;
  const t0 = performance.now();
  const f0 = g.loop.frame;
  await new Promise((r) => setTimeout(r, 3000));
  return {
    fps: g.__fps,
    particles: g.fx.all.reduce((n, s) => n + s.count, 0),
    enemies: g.enemies.countAlive(),
    projectiles: g.projectiles.count,
    pickups: g.pickups.count,
    frames: g.loop.frame - f0,
    elapsed: performance.now() - t0,
  };
});
console.log('perf', JSON.stringify(stats, null, 2));
await shot('08-boss-fight');

await browser.close();
console.log('done');
