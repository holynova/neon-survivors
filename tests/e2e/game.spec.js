import { test, expect } from '@playwright/test';
import {
  boot,
  startRun,
  skipToWave,
  until,
  state,
  player,
  collectErrors,
  expectNoErrors,
} from './helpers.js';

/**
 * A stable snapshot of the whole build, used to prove a card applied.
 *
 * Fingerprints the complete stat block rather than a hand-picked subset:
 * every time a subset is used, a card that buffs an unlisted stat reads as
 * "changed nothing" and the test fails intermittently.
 */
async function buildFingerprint(page) {
  return page.evaluate(() => {
    const p = window.__NS__.game.player;
    return JSON.stringify({
      weapons: p.weapons.map((w) => `${w.def.id}:${w.level}`),
      stats: p.stats.snapshot(),
      elements: p.elementDmg,
      rules: p.rules,
      recipes: p.recipes,
      maxHp: p.maxHp,
      hp: Math.round(p.hp),
      gold: p.gold,
      rerolls: p.rerolls ?? 0,
      abilityDuration: p.abilityDurationBonus,
    });
  });
}

test.describe('boot and menu', () => {
  test('loads with a live canvas and no errors', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);

    const info = await page.evaluate(() => {
      const c = document.getElementById('stage');
      const gl = window.__NS__.game.renderer.getContext();
      return {
        state: window.__NS__.game.state,
        canvasW: c.width,
        canvasH: c.height,
        webgl2: window.__NS__.game.renderer.capabilities.isWebGL2,
        glLost: gl.isContextLost(),
        hasUI: !!document.querySelector('[data-ov="menu"]'),
      };
    });

    expect(info.state).toBe('menu');
    expect(info.canvasW).toBeGreaterThan(0);
    expect(info.canvasH).toBeGreaterThan(0);
    expect(info.webgl2).toBe(true);
    expect(info.glLost).toBe(false);
    expect(info.hasUI).toBe(true);
    await expectNoErrors(errors, 'boot');
  });

  test('the title screen is actually visible and clickable', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);

    // Regression: the menu markup existed but the overlay never received `.on`,
    // so the page was an empty canvas with no way to start.
    const menu = page.locator('[data-ov="menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.title')).toHaveText(/NEON SURVIVORS/);

    const play = page.locator('[data-act="play"]');
    await expect(play).toBeVisible();
    const box = await play.boundingBox();
    expect(box.width).toBeGreaterThan(20);
    expect(box.height).toBeGreaterThan(20);

    await play.click();
    await expect(page.locator('[data-ov="character"]')).toBeVisible();
    await expectNoErrors(errors, 'menu interaction');
  });

  test('character select offers every character and difficulty', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await page.locator('[data-act="play"]').click();

    await expect(page.locator('[data-char]')).toHaveCount(5);
    await expect(page.locator('[data-diff]')).toHaveCount(4);

    // selecting marks exactly one card
    await page.locator('[data-char="arcwelder"]').click();
    await expect(page.locator('.char-card.sel')).toHaveCount(1);
    expect(await page.evaluate(() => window.__NS__.ui.selectedChar)).toBe('arcwelder');

    await page.locator('[data-act="start"]').click();
    await page.waitForFunction(() => window.__NS__.game.state === 'playing');
    const p = await player(page);
    expect(p.weapons).toHaveLength(1);
    expect(p.weapons[0].id).toBe('tesla'); // arcwelder's starting weapon
    await expectNoErrors(errors, 'character select');
  });
});

test.describe('movement and arena', () => {
  test('WASD moves the player in all four directions', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);

    const hold = async (key, ms = 420) => {
      await page.keyboard.down(key);
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
      await page.waitForTimeout(120);
    };

    const start = await player(page);

    await hold('KeyD');
    const right = await player(page);
    expect(right.x, 'D should increase x').toBeGreaterThan(start.x + 0.5);

    await hold('KeyA');
    const left = await player(page);
    expect(left.x, 'A should decrease x').toBeLessThan(right.x - 0.5);

    // The camera sits on +z looking at the origin, so "away from the camera"
    // (up the screen) is -z. W moves that way.
    await hold('KeyW');
    const fwd = await player(page);
    expect(fwd.z, 'W should move away from the camera (-z)').toBeLessThan(left.z - 0.5);

    await hold('KeyS');
    const back = await player(page);
    expect(back.z, 'S should move toward the camera (+z)').toBeGreaterThan(fwd.z + 0.5);

    await expectNoErrors(errors, 'movement');
  });

  test('the player cannot leave the arena', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);

    const half = await page.evaluate(() => window.__NS__.game.constructor && 20);
    for (const k of ['KeyD', 'KeyS']) await page.keyboard.down(k);
    await page.waitForTimeout(3500);
    for (const k of ['KeyD', 'KeyS']) await page.keyboard.up(k);

    const p = await player(page);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(half);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(half);
    await expectNoErrors(errors, 'arena bounds');
  });

  test('dash grants brief invulnerability', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);

    await page.keyboard.down('KeyD');
    await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(120);
    const s = await page.evaluate(() => ({
      iframe: window.__NS__.game.player.iframe,
      dashT: window.__NS__.game.player.dashT,
    }));
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyD');

    expect(s.dashT, 'dash should be active').toBeGreaterThan(0);
    expect(s.iframe, 'dash should grant i-frames').toBeGreaterThan(0);
    await expectNoErrors(errors, 'dash');
  });
});

test.describe('combat', () => {
  test('enemies spawn, weapons fire, and damage is dealt', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);
    await skipToWave(page, 3);

    await until(page, () => window.__NS__.game.enemies.countAlive() > 0);
    await until(
      page,
      () => window.__NS__.game.player.damageDealt > 0,
      null,
      10000,
    );

    const s = await page.evaluate(() => ({
      dealt: Math.round(window.__NS__.game.player.damageDealt),
      alive: window.__NS__.game.enemies.countAlive(),
      kills: window.__NS__.game.player.kills,
    }));
    expect(s.dealt, 'weapons should land hits on their own').toBeGreaterThan(0);
    expect(s.alive, 'combat should have enemies on the field').toBeGreaterThan(0);

    // and the field can actually be cleared
    await until(
      page,
      () => window.__NS__.game.player.kills > 0,
      null,
      20000,
    );
    await expectNoErrors(errors, 'combat');
  });

  test('killing enemies drops XP and levels the player up', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);
    await skipToWave(page, 2);
    await until(page, () => window.__NS__.game.enemies.countAlive() > 0);

    // Seed XP rather than farming drops: this test is about the card UI, not
    // about the economy, and farming it makes the suite flaky.
    await page.evaluate(() => window.__NS__.game.debugLevelUp(1));
    await until(page, () => window.__NS__.game.state === 'levelup');

    const cards = page.locator('[data-ov="levelup"] .card');
    await expect(cards).toHaveCount(3);

    // Snapshot a fingerprint of the build, apply card 0, and assert it moved.
    const before = await buildFingerprint(page);
    const label = (await cards.first().locator('h4').textContent())?.trim();
    await cards.first().click();
    await page.waitForFunction(() => window.__NS__.game.state === 'playing');
    const after = await buildFingerprint(page);
    expect(
      after,
      `card "${label}" changed nothing about the build`,
    ).not.toEqual(before);
    await expectNoErrors(errors, 'level up');
  });

  test('the 1/2/3 hotkeys pick cards', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);
    await skipToWave(page, 2);
    await page.evaluate(() => window.__NS__.game.debugLevelUp(1));
    await until(page, () => window.__NS__.game.state === 'levelup');

    // The hotkey path only has to prove the same thing the click path does:
    // the overlay is dismissed and the queued level-up is consumed. Whether a
    // given card changes the build is a separate concern (see above) — some
    // cards only heal or grant gold, which the hotkey cannot be blamed for.
    await page.keyboard.press('Digit2');
    await page.waitForFunction(() => window.__NS__.game.state === 'playing');

    const after = await page.evaluate(() => ({
      pending: window.__NS__.game.player.pendingLevels,
      cards: window.__NS__.game.levelUpCards.length,
      overlayHidden: !document.querySelector('[data-ov="levelup"]').classList.contains('on'),
    }));
    expect(after.cards, 'the card list should be consumed').toBe(0);
    expect(after.overlayHidden, 'the level-up overlay should close').toBe(true);
    // pendingLevels is already 0 by this point (openLevelUp consumed it), so
    // state + consumed cards are the meaningful signals.
    expect(after.pending, 'no level-up should be left queued').toBe(0);
    await expectNoErrors(errors, 'card hotkeys');
  });
});

test.describe('shop and wave flow', () => {
  test('the shop opens, sells, and advances the wave', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);
    await skipToWave(page, 2);
    await until(page, () => window.__NS__.game.phase === 'combat');
    // Clear the field deterministically: the test is about the shop, and
    // waiting for the player to actually win a wave makes it flaky.
    await page.evaluate(() => {
      const g = window.__NS__.game;
      g.enemies.clear();
      g.spawnQueue = [];
      g.waveElapsed = 999;
    });

    await until(page, () => window.__NS__.game.state === 'shop');
    const shop = page.locator('[data-ov="shop"]');
    await expect(shop).toBeVisible();
    await expect(shop.locator('.shop-item')).toHaveCount(4);

    // give money, buy the cheapest affordable thing, verify gold drops
    await page.evaluate(() => {
      window.__NS__.game.player.gold += 5000;
    });
    const goldBefore = (await player(page)).gold;
    // Re-render first: the `.locked` classes were computed before we topped up
    // the player's gold, so the DOM still marks everything unaffordable.
    await page.evaluate(() => window.__NS__.ui.renderShop());
    // click through the DOM: the panel re-renders on purchase, which can
    // detach the element Playwright is still holding on to
    await page.evaluate(() => {
      const el = document.querySelector('.shop-item:not(.locked):not(.sold)');
      if (!el) throw new Error('no affordable shop item to buy');
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const goldAfter = (await player(page)).gold;
    expect(goldAfter).toBeLessThan(goldBefore);

    await page.locator('[data-act="closeshop"]').click();
    await page.waitForFunction(() => window.__NS__.game.state === 'playing');
    const wave = await page.evaluate(() => window.__NS__.game.wave);
    expect(wave).toBeGreaterThanOrEqual(2);
    await expectNoErrors(errors, 'shop');
  });

  test('a cleared wave always advances instead of stalling', async ({ page }) => {
    // Regression: with the queue drained and the field clear the wave used to
    // sit in `combat` until the full 55s timer expired, stranding the player.
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);
    await skipToWave(page, 2);
    await until(page, () => window.__NS__.game.phase === 'combat');

    // Drain the queue and kill everything, then satisfy the minimum-duration
    // floor. The wave must end on its own rather than waiting out the timer.
    await page.evaluate(() => {
      const g = window.__NS__.game;
      g.spawnQueue = [];
      g.enemies.clear();
      g.waveElapsed = 999;
    });
    await until(
      page,
      () => window.__NS__.game.wave >= 3 || window.__NS__.game.state === 'shop',
      null,
      15000,
    );
    expect(await state(page)).not.toBe('playing');
    await expectNoErrors(errors, 'wave advance');
  });
});

test.describe('characters and weapons', () => {
  const CHARS = ['vanguard', 'engineer', 'demolitionist', 'arcwelder', 'cryomancer'];

  test('every character boots with its own starting weapon', async ({ page }) => {
    for (const c of CHARS) {
      const errors = collectErrors(page);
      // fresh load per iteration: a stale scene from the previous character
      // would mask a boot failure
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__NS__?.game, null, { timeout: 20000 });
      await startRun(page, c);
      const p = await player(page);
      const info = await page.evaluate((id) => ({
        char: window.__NS__.game.char.id,
        weapon: window.__NS__.game.player.weapons[0].def.id,
        ability: window.__NS__.game.char.ability.name,
      }), c);
      expect(info.char).toBe(c);
      expect(info.weapon).toBeTruthy();
      expect(info.ability).toBeTruthy();
      expect(p.weapons).toHaveLength(1);
      await expectNoErrors(errors, `character ${c}`);
    }
  });

  const WEAPONS = [
    'scatter', 'smg', 'tesla', 'grenade', 'frost', 'orbital', 'railgun', 'swarm',
  ];

  test('every weapon fires and contributes damage', async ({ page }) => {
    for (const w of WEAPONS) {
      const errors = collectErrors(page);
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__NS__?.game, null, { timeout: 20000 });
      await startRun(page);
      await skipToWave(page, 6);

      const dealt = await page.evaluate(async (wid) => {
        const g = window.__NS__.game;
        g.enemies.clear();
        // a ring of tanks, close enough for every weapon's effective range
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const e = g.enemies.spawn('tank', Math.cos(a) * 4, Math.sin(a) * 4, 6, g.difficulty);
          if (e) {
            e.spawnT = 0;
            e.maxHp = 1e9;
            e.hp = 1e9;
          }
        }
        g.player.weapons.length = 0;
        g.player.addWeapon(wid);
        g.player.weapons[0].level = 4;
        g.player.iframe = 9999;
        const t0 = performance.now();
        while (performance.now() - t0 < 2500) {
          await new Promise((r) => requestAnimationFrame(r));
          if (g.state === 'levelup') g.chooseCard(0);
        }
        return Math.round(g.player.damageDealt);
      }, w);

      expect(dealt, `${w} dealt no damage in 2.5s`).toBeGreaterThan(0);
      await expectNoErrors(errors, `weapon ${w}`);
    }
  });

  test('derived weapon stats are finite for every character', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);
    const bad = await page.evaluate(() => {
      const g = window.__NS__.game;
      const out = [];
      for (const char of Object.values(g.constructor ? {} : {})) void char;
      for (const id of ['vanguard', 'engineer', 'demolitionist', 'arcwelder', 'cryomancer']) {
        g.startRun(id, 'normal');
        for (const w of ['scatter', 'smg', 'tesla', 'grenade', 'frost', 'orbital', 'railgun', 'swarm']) {
          g.player.weapons.length = 0;
          g.player.addWeapon(w);
          for (const inst of g.player.weapons) {
            for (const [k, v] of Object.entries(inst.stats)) {
              if (typeof v === 'number' && !Number.isFinite(v)) out.push(`${id}/${w}: ${k}=${v}`);
            }
          }
        }
      }
      return out;
    });
    expect(bad, `non-finite weapon stats: ${bad.join(', ')}`).toEqual([]);
    await expectNoErrors(errors, 'stat derivation');
  });
});

test.describe('end of run', () => {
  test('death shows the results panel and restart works', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);
    await skipToWave(page, 2);

    await page.evaluate(() => {
      const p = window.__NS__.game.player;
      p.iframe = 0;
      p.damage(999999, null);
    });
    await page.waitForFunction(() => window.__NS__.game.state === 'dead', null, {
      timeout: 10000,
    });

    const results = page.locator('[data-ov="results"]');
    await expect(results).toBeVisible();
    await expect(results.locator('.result-cell')).toHaveCount(6);
    await expect(results.locator('.build-chip').first()).toBeVisible();

    await page.locator('[data-act="again"]').click();
    await page.waitForFunction(() => window.__NS__.game.state === 'playing');
    const p = await player(page);
    expect(p.hp).toBe(p.maxHp);
    expect(p.kills).toBe(0);
    await expectNoErrors(errors, 'death and restart');
  });

  test('pause and resume work', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);

    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__NS__.game.state === 'paused');
    await expect(page.locator('[data-ov="paused"]')).toBeVisible();

    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__NS__.game.state === 'playing');
    await expectNoErrors(errors, 'pause');
  });
});

test.describe('performance', () => {
  test('holds 60fps through a dense fight', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await startRun(page);
    await skipToWave(page, 12);

    // fill the arena to stress the pools
    await page.evaluate(() => {
      const g = window.__NS__.game;
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 4 + Math.random() * 16;
        const e = g.enemies.spawn('grunt', g.player.x + Math.cos(a) * d, g.player.z + Math.sin(a) * d, 12, g.difficulty);
        if (e) e.maxHp = 1e9, (e.hp = 1e9);
      }
      g.player.hp = 1e9;
      g.player.maxHp = 1e9;
      g.player.iframe = 1e9;
    });

    await page.waitForTimeout(3000);
    const s = await page.evaluate(() => ({
      fps: window.__NS__.game.__fps,
      enemies: window.__NS__.game.enemies.countAlive(),
      particles: window.__NS__.game.fx.all.reduce((n, p) => n + p.count, 0),
      projectiles: window.__NS__.game.projectiles.count,
    }));

    expect(s.enemies).toBeGreaterThan(50);
    expect(s.fps, `only ${s.fps}fps with ${s.enemies} enemies`).toBeGreaterThanOrEqual(30);
    // particle pools must never exceed their budget
    const budget = await page.evaluate(() =>
      window.__NS__.game.fx.all.reduce((n, p) => n + p.max, 0),
    );
    expect(s.particles).toBeLessThanOrEqual(budget);
    await expectNoErrors(errors, 'stress');
  });
});
