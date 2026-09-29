/**
 * Capture the README hero screenshot.
 *
 * Deliberately plays *into* a busy mid-run state (live wave, mixed enemies,
 * weapons firing, particles in flight) rather than capturing at t=0 — a shot
 * of an empty arena is useless as documentation.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:4173';
const out = path.resolve(process.argv[3] ?? 'docs/screenshot.png');
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=default',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__NS__?.game, null, { timeout: 20000 });

await page.evaluate(() => window.__NS__.start('arcwelder', 'normal'));
await page.waitForTimeout(400);

await page.evaluate(() => {
  const g = window.__NS__.game;
  g.debugSkipToCombat(7);
  g.player.weapons.length = 0;
  // Tesla + railgun + swarm read as crisp geometry and lightning; orbital
  // leaves a large additive glow disc that swallows the hero.
  g.player.addWeapon('tesla');
  g.player.weapons[0].level = 3;
  g.player.addWeapon('railgun');
  g.player.addWeapon('smg');
  g.player.iframe = 1e9;
  g.player.x = 0;
  g.player.z = 0;
  const ids = ['grunt', 'runner', 'tank', 'shooter', 'dasher', 'swarmling', 'orbiter', 'elite'];
  ids.forEach((id, i) => {
    // ring the player at a readable radius so the hero is not buried in bodies
    const a = (i / ids.length) * Math.PI * 2 + 0.4;
    const d = 7 + (i % 3) * 2.2;
    const e = g.enemies.spawn(id, Math.cos(a) * d, Math.sin(a) * d, 7, g.difficulty);
    if (e) {
      e.spawnT = 0;
      e.hp = e.maxHp * (0.3 + i * 0.09);
    }
  });
});

// let the fight develop, then find a frame where the player is readable
// rather than sitting inside a burst of additive particles
await page.waitForTimeout(2200);
await page.evaluate(() => {
  const g = window.__NS__.game;
  if (g.state === 'levelup') g.chooseCard(0);
});

const best = await page.evaluate(async () => {
  const g = window.__NS__.game;
  let bestScore = -1;
  let bestT = 0;
  const t0 = performance.now();
  // sample ~2.5s and keep the frame with action but a clear hero
  while (performance.now() - t0 < 2500) {
    await new Promise((r) => requestAnimationFrame(r));
    // dismiss level-ups as they appear, otherwise the overlay covers the shot
    if (g.state === 'levelup') g.chooseCard(0);
    if (g.state !== 'playing') continue;
    const parts = g.fx.all.reduce((n, s) => n + s.count, 0);
    const near = g.fx.glow.count + g.fx.ring.count;
    // want *some* particles (motion) but not a white-out over the player
    const score = parts > 40 && parts < 420 ? 1000 - near * 6 + parts * 0.4 : -1;
    if (score > bestScore) {
      bestScore = score;
      bestT = performance.now() - t0;
    }
  }
  return { bestScore: Math.round(bestScore), bestT: Math.round(bestT) };
});
console.log('framing:', JSON.stringify(best));

const scene = await page.evaluate(async () => {
  const g = window.__NS__.game;
  // settle on a clean playing frame right before the shutter
  if (g.state === 'levelup') g.chooseCard(0);
  // demand a genuinely clean frame: additive glow near the player is what
  // blows the hero out to a white blob
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    if (g.state === 'levelup') g.chooseCard(0);
    if (g.state === 'playing' && g.fx.glow.count + g.fx.ring.count === 0) break;
  }
  return {
    state: g.state,
    enemies: g.enemies.countAlive(),
    particles: g.fx.all.reduce((n, s) => n + s.count, 0),
    fps: g.__fps,
  };
});
console.log('scene:', JSON.stringify(scene));
if (scene.state !== 'playing' || scene.enemies < 3) {
  console.error('refusing to capture: scene is not representative');
  await browser.close();
  process.exit(1);
}

await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
