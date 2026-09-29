import { RARITY, WAVES } from '../game/config.js';
import { STATE } from '../game/game.js';
import { CHARACTERS } from '../game/characters.js';
import { DIFFICULTIES } from '../game/config.js';

const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/**
 * All DOM UI: HUD + overlays (menu / character select / level-up / shop /
 * pause / results). Pure DOM, no framework.
 */
export class UI {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.selectedChar = 'vanguard';
    this.selectedDiff = 'normal';
    this._build();
    game.onStateChange = (s, g) => this.onState(s, g);
    game.onGameOver = (sum) => this.showResults(sum, false);
    game.onVictory = (sum) => this.showResults(sum, true);
    game.onLevelUp = (cards, g) => this.showCards(cards, g);
  }

  _build() {
    this.root.innerHTML = `
      <div class="hud" data-hud>
        <div class="hud-top">
          <div class="panel stat-block">
            <div class="bar hp"><i style="width:100%"></i><span class="bar-label">100 / 100</span></div>
            <div class="row" style="margin-top:8px">
              <span class="tag lv">Lv 1</span>
              <span class="tag" data-xptext>XP 0/10</span>
            </div>
            <div class="bar xp" style="margin-top:6px"><i style="width:0%"></i></div>
          </div>
          <div class="panel char-chip">
            <div class="char-dot" style="color:#ffb13b"></div>
            <div>
              <div class="char-name">猎人</div>
              <div class="char-sub">Vanguard</div>
            </div>
          </div>
          <div class="panel ability-slot">
            <div class="cd-ring" data-cdring style="--p:100%"><span data-cdtext>E</span></div>
            <div>
              <div class="char-name" data-abname>过载冲锋</div>
              <div class="char-sub" data-abdesc>3 秒内移速 +80%、攻速 +60%</div>
            </div>
          </div>
          <div class="panel wave-block">
            <div class="wave-num" data-wavenum>WAVE 1</div>
            <div class="wave-timer" data-wavetime>0:00</div>
            <div class="phase-chip" data-phase>准备</div>
          </div>
        </div>

        <div></div>

        <div style="display:flex;align-items:flex-end;gap:12px">
          <div class="panel stat-block" style="min-width:170px">
            <div class="row"><span>击杀</span><b data-kills style="margin-left:auto">0</b></div>
            <div class="row"><span>金币</span><b data-gold style="margin-left:auto;color:var(--amber)">0</b></div>
            <div class="row"><span>伤害</span><b data-dmg style="margin-left:auto">0</b></div>
            <div class="row"><span>场上敌人</span><b data-alive style="margin-left:auto">0</b></div>
          </div>
        </div>

        <div class="panel weapon-bar" data-weapons></div>

        <div class="panel boss-hud" data-boss>
          <div class="boss-name" data-bossname>BOSS</div>
          <div class="bar"><i style="width:100%"></i></div>
        </div>

        <div class="banner" data-banner>
          <div class="big" data-bannerbig>WAVE 1</div>
          <div class="sub" data-bannersub>生存开始</div>
        </div>
      </div>

      <div class="overlay" data-ov="menu">
        <div class="overlay-inner">
          <h1 class="title">NEON SURVIVORS</h1>
          <div class="subtitle">霓虹幸存者 · 3D 类幸存者 Roguelite</div>
          <p style="max-width:640px;color:#a9bcd8;line-height:1.8;font-size:13.5px">
            你被困在霓虹竞技场中。武器自动开火，你只需要走位、抉择与成长。<br/>
            撑过 <b>${WAVES.total}</b> 波并击败虚空吞噬者。
          </p>
          <div class="btn-row" style="margin-top:22px">
            <button class="btn primary" data-act="play">开始游戏</button>
            <button class="btn ghost" data-act="help">操作说明</button>
          </div>
          <div class="help-grid">
            <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动</div>
            <div><kbd>Shift</kbd> 冲刺（短暂无敌）</div>
            <div><kbd>E</kbd> 释放角色技能</div>
            <div><kbd>Space</kbd> 暂停</div>
            <div><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 快速选择升级卡</div>
            <div><kbd>R</kbd> 升级卡刷新</div>
          </div>
          <div class="sect-title">画质</div>
          <div class="diff-row" data-quality>
            <div class="diff-chip" data-q="low">低</div>
            <div class="diff-chip" data-q="med">中</div>
            <div class="diff-chip sel" data-q="high">高</div>
          </div>
        </div>
      </div>

      <div class="overlay" data-ov="character">
        <div class="overlay-inner">
          <h1 class="title" style="font-size:clamp(28px,4.4vw,48px)">选择角色</h1>
          <div class="subtitle">每个角色改写一套玩法规则</div>
          <div class="char-grid" data-chars></div>
          <div class="sect-title">难度</div>
          <div class="diff-row" data-diffs></div>
          <div class="btn-row" style="margin-top:24px">
            <button class="btn primary" data-act="start">进入竞技场</button>
            <button class="btn ghost" data-act="back">返回</button>
          </div>
        </div>
      </div>

      <div class="overlay" data-ov="levelup">
        <div class="overlay-inner">
          <h1 class="title" style="font-size:clamp(26px,4vw,42px)">升级</h1>
          <div class="subtitle">选择一张强化卡</div>
          <div class="cards" data-cards></div>
          <div class="btn-row">
            <button class="btn ghost" data-act="reroll">刷新（<span data-rerolls>0</span>）</button>
          </div>
        </div>
      </div>

      <div class="overlay" data-ov="shop">
        <div class="overlay-inner">
          <h1 class="title" style="font-size:clamp(26px,4vw,42px)">补给商店</h1>
          <div class="subtitle" data-shopsub>下一波即将开始</div>
          <div class="shop-grid" data-shop></div>
          <div class="btn-row">
            <button class="btn primary" data-act="closeshop">离开商店（<span data-shopwave></span>）</button>
            <span class="price" data-shopgold></span>
          </div>
        </div>
      </div>

      <div class="overlay" data-ov="paused">
        <div class="overlay-inner" style="text-align:center">
          <h1 class="title" style="font-size:clamp(30px,5vw,54px)">已暂停</h1>
          <div class="subtitle">按 Space 继续</div>
          <div class="btn-row" style="justify-content:center">
            <button class="btn primary" data-act="resume">继续</button>
            <button class="btn ghost" data-act="quit">放弃本局</button>
          </div>
        </div>
      </div>

      <div class="overlay" data-ov="results">
        <div class="overlay-inner">
          <h1 class="title" data-resulttitle>本局结束</h1>
          <div class="subtitle" data-resultsub></div>
          <div class="result-grid" data-results></div>
          <div class="sect-title">最终 Build</div>
          <div class="build-list" data-build></div>
          <div class="btn-row">
            <button class="btn primary" data-act="again">再来一局</button>
            <button class="btn ghost" data-act="menu">返回主菜单</button>
          </div>
        </div>
      </div>
    `;

    const q = (sel) => this.root.querySelector(sel);
    this.el = {
      hud: q('[data-hud]'),
      hp: q('.bar.hp > i'),
      hpLabel: q('.bar.hp .bar-label'),
      xp: q('.bar.xp > i'),
      lv: q('.lv'),
      xpText: q('[data-xptext]'),
      charDot: q('.char-dot'),
      charName: q('.char-chip .char-name'),
      charSub: q('.char-sub'),
      abName: q('[data-abname]'),
      abDesc: q('[data-abdesc]'),
      cdRing: q('[data-cdring]'),
      cdText: q('[data-cdtext]'),
      waveNum: q('[data-wavenum]'),
      waveTime: q('[data-wavetime]'),
      phase: q('[data-phase]'),
      kills: q('[data-kills]'),
      gold: q('[data-gold]'),
      dmg: q('[data-dmg]'),
      alive: q('[data-alive]'),
      weapons: q('[data-weapons]'),
      boss: q('[data-boss]'),
      bossName: q('[data-bossname]'),
      banner: q('[data-banner]'),
      bannerBig: q('[data-bannerbig]'),
      bannerSub: q('[data-bannersub]'),
      cards: q('[data-cards]'),
      chars: q('[data-chars]'),
      diffs: q('[data-diffs]'),
      shop: q('[data-shop]'),
      shopGold: q('[data-shopgold]'),
      shopWave: q('[data-shopwave]'),
      shopSub: q('[data-shopsub]'),
      results: q('[data-results]'),
      resultTitle: q('[data-resulttitle]'),
      resultSub: q('[data-resultsub]'),
      build: q('[data-build]'),
      rerolls: q('[data-rerolls]'),
      overlays: Object.fromEntries(
        [...this.root.querySelectorAll('[data-ov]')].map((e) => [e.dataset.ov, e]),
      ),
      quality: q('[data-quality]'),
    };

    this._renderChars();
    this._renderDiffs();
    this._bind();
    // Game already boots in MENU, and _setState() no-ops on an unchanged state,
    // so the overlay has to be shown explicitly here or the title screen renders
    // an empty canvas.
    this.onState(this.game.state, this.game);
  }

  _renderChars() {
    this.el.chars.innerHTML = CHARACTERS.map(
      (c) => `
      <div class="char-card${c.id === this.selectedChar ? ' sel' : ''}" data-char="${c.id}" style="--glow:${c.color}">
        <h3>${c.name}</h3>
        <div class="en">${c.nameEn}</div>
        <div class="blurb">${c.blurb}</div>
        <div class="tags">
          <span class="tag">主动：${c.ability.name}</span>
          <span class="tag">难度 ${'★'.repeat(c.difficulty)}</span>
        </div>
      </div>`,
    ).join('');
    this.el.chars.querySelectorAll('[data-char]').forEach((el) => {
      el.addEventListener('click', () => {
        this.selectedChar = el.dataset.char;
        this._renderChars();
        this.game.audio.cardHover();
      });
      el.addEventListener('mouseenter', () => this.game.audio.cardHover());
    });
  }

  _renderDiffs() {
    this.el.diffs.innerHTML = Object.entries(DIFFICULTIES)
      .map(
        ([id, d]) =>
          `<div class="diff-chip${id === this.selectedDiff ? ' sel' : ''}" data-diff="${id}">${d.name}</div>`,
      )
      .join('');
    this.el.diffs.querySelectorAll('[data-diff]').forEach((el) => {
      el.addEventListener('click', () => {
        this.selectedDiff = el.dataset.diff;
        this._renderDiffs();
        this.game.audio.ui();
      });
    });
  }

  _bind() {
    this.root.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (act) this._action(act);
      const q = ev.target.closest('[data-q]')?.dataset.q;
      if (q) {
        this.el.quality.querySelectorAll('[data-q]').forEach((n) => n.classList.toggle('sel', n === ev.target.closest('[data-q]')));
        this.game.setQuality(q);
        this.game.audio.ui();
      }
    });
    window.addEventListener('keydown', (e) => {
      const s = this.game.state;
      if (s === STATE.LEVELUP) {
        if (e.code === 'Digit1') this.game.chooseCard(0);
        else if (e.code === 'Digit2') this.game.chooseCard(1);
        else if (e.code === 'Digit3') this.game.chooseCard(2);
        else if (e.code === 'KeyR') this.game.rerollCards();
      } else if (s === STATE.SHOP && e.code === 'Space') {
        e.preventDefault();
        this.game.closeShop();
      }
    });
  }

  _action(act) {
    const g = this.game;
    g.audio.init();
    switch (act) {
      case 'play':
        g.audio.ui();
        this.show('character');
        break;
      case 'help':
        this.show('menu');
        break;
      case 'back':
        this.show('menu');
        break;
      case 'start':
        g.audio.ui();
        g.startRun(this.selectedChar, this.selectedDiff);
        break;
      case 'resume':
        g.resume();
        break;
      case 'quit':
        g.onGameOver(g.buildRunSummary());
        g._setState(STATE.DEAD);
        break;
      case 'closeshop':
        g.closeShop();
        break;
      case 'reroll':
        g.rerollCards();
        this.el.rerolls.textContent = String(g.player?.rerolls ?? 0);
        break;
      case 'again':
        g.startRun(this.selectedChar, this.selectedDiff);
        break;
      case 'menu':
        this.show('menu');
        g._setState(STATE.MENU);
        break;
      default:
        break;
    }
  }

  show(name) {
    for (const [k, el] of Object.entries(this.el.overlays)) {
      el.classList.toggle('on', k === name);
    }
    this.el.hud.classList.toggle('on', name === null);
  }

  hideAll() {
    for (const el of Object.values(this.el.overlays)) el.classList.remove('on');
    this.el.hud.classList.add('on');
  }

  onState(state, g) {
    this.hideAll();
    switch (state) {
      case STATE.MENU:
        this.show('menu');
        break;
      case STATE.CHARACTER:
        this.show('character');
        break;
      case STATE.PAUSED:
        this.show('paused');
        break;
      case STATE.LEVELUP:
        break;
      case STATE.SHOP:
        this.renderShop();
        break;
      case STATE.DEAD:
      case STATE.VICTORY:
        // hideAll() above cleared every overlay; the results panel is the
        // screen for these two states, so re-show it.
        this.show('results');
        break;
      default:
        break;
    }
    if (state === STATE.PLAYING && g.wave > 0 && g.phase === 'prep') {
      this.banner(g.phase === 'prep' ? `WAVE ${g.wave}` : '', g.char?.name ?? '');
    }
  }

  banner(big, sub) {
    this.el.bannerBig.textContent = big;
    this.el.bannerSub.textContent = sub;
    this.el.banner.classList.remove('show');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
  }

  showCards(cards, g) {
    this.el.cards.innerHTML = cards
      .map((c, i) => {
        const r = RARITY[c.rarity];
        return `
        <div class="card" data-card="${i}" style="--rc:${r.color}">
          <div class="rar">${r.name}</div>
          <div class="icon">${c.icon}</div>
          <h4>${c.title}</h4>
          <p>${c.desc}</p>
          <div class="key">按 ${i + 1} 选择</div>
        </div>`;
      })
      .join('');
    this.el.cards.querySelectorAll('[data-card]').forEach((el) => {
      const i = Number(el.dataset.card);
      el.addEventListener('mouseenter', () => this.game.audio.cardHover());
      el.addEventListener('click', () => g.chooseCard(i));
    });
    this.el.rerolls.textContent = String(g.player?.rerolls ?? 0);
    this.hideAll();
    this.show('levelup');
  }

  renderShop() {
    const g = this.game;
    this.el.shopWave.textContent = `下一波 WAVE ${g.wave + 1}`;
    this.el.shopGold.innerHTML = `◉ ${g.player.gold}`;
    this.el.shop.innerHTML = g.shopItems
      .map((it) => {
        const r = RARITY[it.rarity] ?? RARITY.common;
        const afford = g.player.gold >= it.price;
        const cls = it.sold ? 'sold' : afford ? '' : 'locked';
        return `
        <div class="shop-item ${cls}" data-buy="${it.id}" style="--rc:${r.color}">
          <div class="top"><div class="icon">${it.icon}</div><h5>${it.title}</h5></div>
          <p>${it.desc}</p>
          <div class="price">◉ ${it.price}</div>
          ${it.sold ? '<div class="sold-tag">已售出</div>' : ''}
        </div>`;
      })
      .join('');
    this.el.shop.querySelectorAll('[data-buy]').forEach((el) => {
      el.addEventListener('mouseenter', () => this.game.audio.cardHover());
      el.addEventListener('click', () => {
        const item = g.shopItems.find((i) => i.id === el.dataset.buy);
        if (item && !item.sold && g.player.gold >= item.price) {
          g.buy(item);
          this.renderShop();
        } else {
          this.game.audio.ui();
          this.el.shopGold.style.color = 'var(--danger)';
          setTimeout(() => (this.el.shopGold.style.color = ''), 400);
        }
      });
    });
    this.hideAll();
    this.show('shop');
  }

  showResults(sum, victory) {
    const wrap = this.el.results.parentElement.parentElement;
    wrap.classList.toggle('victory', victory);
    wrap.classList.toggle('death', !victory);
    this.el.resultTitle.textContent = victory ? '胜利' : '本局结束';
    this.el.resultSub.textContent = victory
      ? '虚空吞噬者已被击碎 · 竞技场归于寂静'
      : `${sum.character.name} 倒在了 WAVE ${sum.wave}`;
    this.el.results.innerHTML = `
      <div class="result-cell"><div class="v">${sum.wave}</div><div class="k">波次</div></div>
      <div class="result-cell"><div class="v">${sum.kills}</div><div class="k">击杀</div></div>
      <div class="result-cell"><div class="v">${sum.level}</div><div class="k">等级</div></div>
      <div class="result-cell"><div class="v">${sum.gold}</div><div class="k">金币</div></div>
      <div class="result-cell"><div class="v">${fmtTime(sum.time)}</div><div class="k">存活</div></div>
      <div class="result-cell"><div class="v">${Math.round(sum.dps)}</div><div class="k">秒均伤害</div></div>
    `;
    this.el.build.innerHTML = sum.weapons
      .map((w) => `<div class="build-chip" style="color:${w.color}">${w.name} Lv${w.level}</div>`)
      .join('');
    this.hideAll();
    this.show('results');
  }

  // ------------------------------------------------------------------ hud
  update(g) {
    const p = g.player;
    if (!p) return;
    this.el.hp.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    this.el.hpLabel.textContent = `${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`;
    this.el.xp.style.width = `${Math.min(100, (p.xp / p.xpNeed) * 100)}%`;
    this.el.lv.textContent = `Lv ${p.level}`;
    this.el.xpText.textContent = `XP ${Math.floor(p.xp)}/${p.xpNeed}`;
    this.el.kills.textContent = String(p.kills);
    this.el.gold.textContent = String(p.gold);
    this.el.dmg.textContent = fmtNum(p.damageDealt);
    this.el.alive.textContent = String(g.enemies.countAlive());

    // weapons
    const key = p.weapons.map((w) => `${w.def.id}:${w.level}`).join('|');
    if (key !== this._wpnKey) {
      this._wpnKey = key;
      this.el.weapons.innerHTML = Array.from({ length: 6 }, (_, i) => {
        const w = p.weapons[i];
        if (!w) return `<div class="wslot empty"></div>`;
        return `<div class="wslot" style="color:${w.def.color}" title="${w.def.name} Lv${w.level}">
          <div class="glyph">⚔</div><div class="lv">${w.level}</div><div class="cd" data-cd></div></div>`;
      }).join('');
    }
    this.el.weapons.querySelectorAll('.wslot').forEach((slot, i) => {
      const w = p.weapons[i];
      const bar = slot.querySelector('.cd');
      if (!w || !bar) return;
      const s = w.stats;
      const max = Math.max(s.cd ?? s.cooldown ?? 1, 0.001);
      const cur = w.charge > 0 ? 0 : Math.max(0, w.cd);
      bar.style.width = `${Math.max(0, Math.min(100, (1 - cur / max) * 100))}%`;
    });

    // ability
    const abMax = p.abilityCooldown;
    const pct = p.abilityActive > 0 ? 100 : Math.max(0, Math.min(100, (1 - p.abilityCd / abMax) * 100));
    this.el.cdRing.style.setProperty('--p', `${pct}%`);
    this.el.cdText.textContent = p.abilityActive > 0 ? '●' : p.abilityCd > 0 ? Math.ceil(p.abilityCd) : 'E';

    // wave
    this.el.waveNum.textContent = `WAVE ${g.wave}`;
    const remain = g.phase === 'combat' ? Math.max(0, g.waveTimer) : Math.max(0, g.phaseTimer);
    this.el.waveTime.textContent = fmtTime(remain);
    const boss = g.phase === 'combat' && g.plan?.isBoss;
    this.el.phase.textContent =
      g.phase === 'prep' ? '准备阶段' : g.phase === 'rest' ? '休整' : boss ? 'BOSS 波次' : '战斗中';
    this.el.phase.classList.toggle('boss', !!boss);

    // boss bar
    const b = g.bossEntity;
    if (b && b.alive) {
      this.el.boss.classList.add('on');
      this.el.bossName.textContent = b.def.name;
      this.el.boss.querySelector('.bar > i').style.width = `${Math.max(0, (b.hp / b.maxHp) * 100)}%`;
    } else {
      this.el.boss.classList.remove('on');
    }
  }
}

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
