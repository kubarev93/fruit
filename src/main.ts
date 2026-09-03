import { Application, Container, Sprite, Texture } from 'pixi.js';
import { mountHud } from '@open-slot-ui/pixi';
import { loadBuiltinArt } from '@open-slot-ui/pixi/art';
import { resolveBetLadder } from '@open-slot-ui/core';
import type { UISpec } from '@open-slot-ui/core';
import { gsap } from 'gsap';
import { loadGameAssets } from './assets';
import { createBoard } from './reels';
import { createWinFx, winTier } from './winfx';
import { initAudio } from './audio';
import { initSfx, playSfx } from './sfx';
import { createFlares } from './flares';
import { evaluate, BONUS_TRIGGER, COIN } from './config';

const START_BALANCE = 12343.67;
const BET_LADDER = [0.2, 0.4, 0.6, 0.8, 1, 2, 3, 5, 10, 20, 50];
const START_BET = 1;

async function main(): Promise<void> {
  const app = new Application();
  await app.init({
    background: '#1a1410',
    resizeTo: window,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.getElementById('game')!.appendChild(app.canvas);

  const assets = await loadGameAssets();

  // ---- scene layers (below the HUD) ----
  const world = new Container();
  app.stage.addChild(world);

  const bg = new Sprite(assets.bgMobile);
  bg.anchor.set(0.5);
  world.addChild(bg);

  // Animated lens-flares / glitter drifting over the sky.
  const flares = createFlares(assets.flares);
  world.addChild(flares.view);

  const logo = new Sprite(assets.logo);
  logo.anchor.set(0.5, 0);
  world.addChild(logo);

  const board = createBoard(
    app.ticker,
    app.renderer,
    assets.symbols,
    assets.frame,
    assets.winFrame,
    assets.bonusFrame,
    assets.jackpots,
    assets.symbolBurst,
    assets.symbolCoins,
  );
  world.addChild(board.view);

  // Big/Mega/Epic win splash (coins + tier text + multiplier count-up).
  const winfx = createWinFx(assets);
  world.addChild(winfx.view);

  // ---- HUD (spin button, balance, bet, autoplay, menu) in one call ----
  const { icons, spinSkin } = await loadBuiltinArt();
  const hud = mountHud(app, buildSpec(), { icons, spinSkin, gsap, expose: true });
  const ui = hud.ui;
  ui.balance.set(START_BALANCE);
  ui.bet.set(START_BET);

  // Background music (main.mp3) + audio-sprite sound effects, both following the
  // HUD's mute + volume sliders.
  initAudio(hud);
  void initSfx(hud);

  const snap = (x: number): number => Math.round(x * 1e8) / 1e8;
  const turboOn = (): boolean => ui.turbo?.isOn ?? false;

  // ---- one round (optionally forced to a specific grid, for the mock panel) ----
  async function playSpin(forced?: string[][]): Promise<void> {
    const bet = ui.bet.get();
    ui.spin.busy();
    board.clearWins();
    ui.balance.set(snap(ui.balance.get() - bet));

    const grid = forced ?? board.randomGrid();
    await board.spin(grid, turboOn());

    const wins = evaluate(grid);
    const win = snap(wins.reduce((sum, w) => sum + w.multiplier * bet, 0));
    if (wins.length > 0) {
      const framesP = board.showWins(wins);
      const tier = winTier(win / bet);
      if (tier) {
        playSfx('bigwin');
        await winfx.play(tier, win / bet);
      }
      await framesP;
      ui.balance.set(snap(ui.balance.get() + win));
    }

    // Hold & Win: enough money symbols on the grid triggers the respin bonus.
    let bonusWin = 0;
    if (board.countCoins(grid) >= BONUS_TRIGGER) {
      const coinCells: Array<{ reel: number; cell: number }> = [];
      grid.forEach((col, reel) =>
        col.forEach((s, cell) => {
          if (s === COIN) coinCells.push({ reel, cell });
        }),
      );
      bonusWin = await board.runBonus(bet, coinCells);
      if (bonusWin > 0) {
        ui.balance.set(snap(ui.balance.get() + bonusWin));
        playSfx('bigwin');
        await winfx.play(winTier(bonusWin / bet) ?? 'big', bonusWin / bet);
      }
    }

    ui.reportRound(snap(win + bonusWin), bet);
  }

  let rounding = false;
  async function doRound(forced?: string[][]): Promise<void> {
    if (rounding) return;
    rounding = true;
    try {
      await playSpin(forced);
      ui.spin.stopState();
      await wait(turboOn() ? 100 : 300);
      ui.spin.idle();
    } finally {
      rounding = false;
    }
  }

  hud.on('spinRequested', () => {
    if (ui.balance.get() < ui.bet.get()) return;
    void doRound();
  });
  hud.on('skipRequested', () => board.skip());
  hud.on('autoplayStarted', async () => {
    while (ui.autoplay.isActive) {
      if (ui.balance.get() < ui.bet.get()) {
        ui.autoplay.stop();
        break;
      }
      await playSpin();
      ui.spin.idle();
      await wait(turboOn() ? 150 : 300);
    }
  });

  // ---- responsive layout ----
  function layout(): void {
    const w = app.screen.width;
    const h = app.screen.height;
    const portrait = w / h < 1;

    // Background: cover-fit, swapping desk/mobile art by orientation.
    const desired = portrait ? assets.bgMobile : assets.bgDesk;
    if (bg.texture !== desired) bg.texture = desired;
    cover(bg, w, h);
    bg.x = w / 2;
    bg.y = h / 2;

    // Logo: top-centered, width a fraction of the screen.
    const logoW = Math.min(w * (portrait ? 0.72 : 0.34), 560);
    logo.width = logoW;
    logo.height = logoW * (assets.logo.height / assets.logo.width);
    logo.x = w / 2;
    logo.y = Math.max(h * 0.012, 8);

    const topReserve = logo.y + logo.height + h * 0.01;
    const bottomReserve = h * (portrait ? 0.2 : 0.16); // HUD controls band
    board.layout(w, h, topReserve, bottomReserve);
    winfx.layout(w, h);
    flares.layout(w, h);
  }

  app.renderer.on('resize', layout);
  layout();

  // Intro: fade the scene in and pop the board.
  function playIntro(): void {
    world.alpha = 0;
    gsap.to(world, { alpha: 1, duration: 0.5, ease: 'power1.out' });
    const s0 = board.view.scale.x;
    board.view.scale.set(s0 * 0.82);
    gsap.to(board.view.scale, { x: s0, y: s0, duration: 0.6, ease: 'back.out(1.7)' });
  }
  playIntro();

  // Dev handle for debugging in the console.
  (window as unknown as Record<string, unknown>).__game = { app, hud, board, winfx };

  // Mock panel (?mocks=1): buttons to trigger every animation on demand.
  if (new URLSearchParams(location.search).has('mocks')) {
    const { mountMocks } = await import('./mocks');
    mountMocks({
      round: (grid) => void doRound(grid),
      splash: (tier, mult) => void winfx.play(tier, mult),
      frames: (wins) => void board.showWins(wins),
      clear: () => board.clearWins(),
      intro: () => playIntro(),
      isBusy: () => rounding,
    });
  }
}

/** The whole HUD as one config object. */
function buildSpec(): UISpec {
  return {
    theme: { preset: 'default' },
    currency: { code: 'USD', symbol: '$', display: 'symbol', position: 'prefix', decimals: 2 },
    betLadder: resolveBetLadder(BET_LADDER, START_BET),
    turbo: { modes: 2 },
    autoplay: { mode: 'options', options: [5, 10, 25, 50, 100, Infinity] },
    spin: { press: 'tap' },
    rtp: 96,
    game: { name: 'Fruit Slot — Hold & Win', version: '0.1.0' },
  };
}

/** Scale a centered sprite to cover a w×h box (like CSS background-size: cover). */
function cover(sprite: Sprite, w: number, h: number): void {
  const tex: Texture = sprite.texture;
  const scale = Math.max(w / tex.width, h / tex.height);
  sprite.width = tex.width * scale;
  sprite.height = tex.height * scale;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

void main();
