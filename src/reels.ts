import { AnimatedSprite, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Renderer, Ticker } from 'pixi.js';
import { ReelSetBuilder, SpriteSymbol, SymbolSpotlight } from 'pixi-reels';
import type { ReelSet, ColumnTarget, SymbolPosition } from 'pixi-reels';
import { gsap } from 'gsap';
import { CoinSymbol } from './CoinSymbol';
import { COIN_TILE_FILL, COIN_JACKPOT_FILL, COIN_TEXT_BOX_W, COIN_TEXT_BOX_H, fitScale } from './coinFit';
import { createChest, loadChestAssets, CHEST_NATIVE_W } from './chest';
import { createCoinFountain } from './coinFountain';
import { createWinBadge } from './winBadge';
import { CoconutSymbol } from './CoconutSymbol';
import { playSfx, stopSfx } from './sfx';
import {
  BLOCK_H,
  BLOCK_W,
  BONUS_RESPINS,
  CELL,
  COCONUT,
  COIN,
  FRAME_COL_PITCH_FRAC,
  FRAME_ROW_SPAN_FRAC,
  GAP_X,
  GAP_Y,
  PAYLINES,
  PAYOUTS,
  REELS,
  ROWS,
  WEIGHTS,
  WILD,
  countCoins,
  type JackpotId,
  type LineWin,
  type SymbolId,
} from './config';
import type { BonusResult, CoinValue } from './rgs/types';

const TEASE_MIN_PAYOUT = 14;

/**
 * Reel motion profile — pixi-reels' built-in "normal" preset, but with a much
 * shorter settle bounce. The stock 600ms bounce makes a reel emit
 * `spin:reelLanded` (and resolve the spin) ~600ms AFTER its symbols visually
 * snap into place, so the landing sound and the spin-loop stop both fired well
 * after the reel had visibly stopped. A short bounce puts the "landed" beat on
 * the visual stop. Tune `bounceDuration` / `bounceDistance` to taste.
 */
const REEL_PROFILE = {
  name: 'normal',
  spinDelay: 100,
  spinSpeed: 30,
  stopDelay: 140,
  anticipationDelay: 450,
  bounceDistance: 22,
  bounceDuration: 120,
  accelerationEase: 'power2.in',
  decelerationEase: 'power2.out',
  accelerationDuration: 300,
  minimumSpinTime: 500,
};

/** Short fade so the spin loop stops cleanly (no click) right as the reels land. */
const SPIN_FADE_MS = 120;

export interface Board {
  readonly view: Container;
  spin(grid: string[][], turbo: boolean): Promise<void>;
  skip(): void;
  showWins(wins: LineWin[], amount: number): Promise<void>;
  clearWins(): void;
  layout(width: number, height: number, top: number, bottom: number): void;
  runBonus(bonus: BonusResult): Promise<void>;
}

export function createBoard(
  ticker: Ticker,
  renderer: Renderer,
  symbolTextures: Record<SymbolId, Texture>,
  frameTexture: Texture,
  winFrameTextures: Texture[],
  bonusFrameTextures: Texture[],
  jackpotTextures: Record<JackpotId, Texture>,
  symbolBurstTextures: Texture[],
  symbolCoinsTextures: Texture[],
): Board {
  const view = new Container();

  // --- wooden frame behind the reels ---
  const frame = new Sprite(frameTexture);
  frame.anchor.set(0.5);
  view.addChild(frame);

  // --- the reel set ---
  const reelSet: ReelSet = new ReelSetBuilder()
    .reels(REELS)
    .visibleCells(ROWS)
    .symbolSize(CELL, CELL)
    .symbolGap(GAP_X, GAP_Y)
    .renderer(renderer)
    .symbols((r) => {
      for (const [id, tex] of Object.entries(symbolTextures)) {
        if (id === COIN) {
          r.register(id, CoinSymbol, { tile: tex, jackpots: jackpotTextures });
        } else if (id === COCONUT) {
          r.register(id, CoconutSymbol, { texture: tex });
        } else {
          r.register(id, SpriteSymbol, { textures: { [id]: tex } });
        }
      }
    })
    .weights(WEIGHTS)
    .speed('normal', REEL_PROFILE)
    .ticker(ticker)
    .build();

  // Center the reel block on the board origin (frame is centered too).
  const reelLayer = new Container();
  reelLayer.addChild(reelSet as unknown as Container);
  reelLayer.x = -BLOCK_W / 2;
  reelLayer.y = -BLOCK_H / 2;
  view.addChild(reelLayer);

  // --- win overlay (frames + payline) shares the reel coordinate space ---
  const overlay = new Container();
  overlay.x = reelLayer.x;
  overlay.y = reelLayer.y;
  view.addChild(overlay);

  // Built-in spotlight: dims non-winners + pops the winning symbols (their
  // SpriteSymbol.playWin scale pulse). Uses the reel set's public subsystems.
  let spotlight: SymbolSpotlight | null = null;
  try {
    spotlight = new SymbolSpotlight([...reelSet.reels], reelSet.viewport, reelSet.events);
  } catch {
    spotlight = null;
  }

  // Per-reel landing thunk. With the short bounce (REEL_PROFILE) this fires
  // right as the reel snaps into place, so it reads as synced to the stop.
  reelSet.events.on('spin:reelLanded', () => playSfx('reel-one-landing'));

  // Warm the Hold & Win chest Spine in the background so it's ready by the
  // first bonus. Non-fatal: a failed load just means no chest.
  void loadChestAssets().catch(() => {});

  function toTargets(grid: string[][]): ColumnTarget[] {
    return grid.map((visible) => ({ visible }));
  }

  /** Tease the last reel when the first two reels already show a high pair. */
  function teaseLastReel(grid: string[][]): boolean {
    for (const line of PAYLINES) {
      const [r0, c0] = line[0]!;
      const [r1, c1] = line[1]!;
      const a = grid[r0]?.[c0];
      const b = grid[r1]?.[c1];
      if (a == null || b == null) continue;
      const compatible = a === b || a === WILD || b === WILD;
      if (!compatible) continue;
      const anchor = (a === WILD ? b : a) as SymbolId;
      if (anchor === WILD || (PAYOUTS[anchor] ?? 0) >= TEASE_MIN_PAYOUT) return true;
    }
    return false;
  }

  /** Coins already showing on the reels that stop before the last one. */
  function coinsInFront(grid: string[][]): number {
    let n = 0;
    for (let reel = 0; reel < REELS - 1; reel++) {
      for (let cell = 0; cell < ROWS; cell++) {
        if (grid[reel]?.[cell] === COIN) n++;
      }
    }
    return n;
  }

  async function spin(grid: string[][], turbo: boolean): Promise<void> {
    spinning = true;
    clearWins();
    clearWilds();
    clearCoins();
    stopSfx(); // clear any lingering long sound (spin/anticipation/bigwin) from before
    playSfx('spin-start');
    playSfx('wheels-spinning');
    const p = reelSet.spin();
    // Give the reels a beat of free spin before revealing the outcome.
    if (!turbo) await wait(220);
    reelSet.setResult(toTargets(grid));
    // Anticipation: slow the final reel — for a pending big line, or when the
    // settled reels already show 2+ coins and a bonus is within reach.
    const coinTease = coinsInFront(grid) >= 2;
    if (!turbo && (teaseLastReel(grid) || coinTease)) {
      reelSet.setAnticipation([REELS - 1], { slowdown: { from: 0.5, to: 0.12 } });
      playSfx('anticipation');
      if (coinTease) startCoinAnticipation();
    }
    await p;
    stopSfx('wheels-spinning', SPIN_FADE_MS); // reels have landed — end the loop with a short fade
    stopSfx('anticipation');
    stopCoinAnticipation();
    spinning = false;
    highlightWilds(grid);
    highlightCoins(grid);
    if (countCoins(grid) > 0) playSfx('lightningBSymbolLanding');
  }

  function skip(): void {
    try {
      reelSet.skipSpin();
    } catch {
      reelSet.slamStop();
    }
  }

  // --- win presentation ---
  const winFrames: AnimatedSprite[] = [];
  const wildFrames: AnimatedSprite[] = [];
  const bursts: AnimatedSprite[] = [];
  const coinFx: Container[] = [];
  const line = new Graphics();
  overlay.addChild(line);
  const coinFountain = createCoinFountain(renderer);
  overlay.addChild(coinFountain.view);
  const winBadge = createWinBadge();
  const tweens: gsap.core.Tween[] = [];
  let lineCycle: gsap.core.Tween | null = null;

  // --- "juice": top fx layer, screen shake, flashes, sparkles ---
  const fxTop = new Container();
  fxTop.eventMode = 'none';
  view.addChild(fxTop);
  // Win amount rides the very top layer so reel symbols and win frames can't
  // cover it. fxTop is board-centred, so cell coords are offset by -BLOCK/2.
  fxTop.addChild(winBadge.view);

  let baseX = 0;
  let baseY = 0;
  let screenH = 0;
  let spinning = false;
  let bonusActive = false;
  const wildCellKeys = new Set<string>();
  const fxSprites: Container[] = [];
  const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

  function starPts(outer: number, inner: number, n = 4): number[] {
    const p: number[] = [];
    for (let k = 0; k < n * 2; k++) {
      const r = k % 2 === 0 ? outer : inner;
      const a = (Math.PI / n) * k - Math.PI / 2;
      p.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return p;
  }
  const twGfx = new Graphics();
  twGfx.poly(starPts(50, 15)).fill(0xfff3c4);
  twGfx.circle(0, 0, 12).fill(0xffffff);
  const twinkleTex = renderer.generateTexture(twGfx);
  twGfx.destroy();

  function trackFx<T extends Container>(o: T): T {
    fxSprites.push(o);
    return o;
  }
  function clearFx(): void {
    for (const o of fxSprites) {
      gsap.killTweensOf(o);
      gsap.killTweensOf(o.scale);
      if (!o.destroyed) o.destroy();
    }
    fxSprites.length = 0;
  }

  function screenShake(amp: number, dur = 0.5): void {
    const st = { p: 1 };
    gsap.to(st, {
      p: 0,
      duration: dur,
      ease: 'power2.out',
      onUpdate: () => {
        view.x = baseX + (Math.random() * 2 - 1) * amp * st.p;
        view.y = baseY + (Math.random() * 2 - 1) * amp * st.p;
      },
      onComplete: () => {
        view.x = baseX;
        view.y = baseY;
      },
    });
  }

  function playFlash(alpha = 0.85): void {
    const g = new Graphics();
    const pad = CELL;
    g.rect(-BLOCK_W / 2 - pad, -BLOCK_H / 2 - pad, BLOCK_W + pad * 2, BLOCK_H + pad * 2).fill(0xffffff);
    g.blendMode = 'add';
    g.alpha = 0;
    fxTop.addChild(g);
    gsap.to(g, {
      alpha,
      duration: 0.08,
      yoyo: true,
      repeat: 1,
      ease: 'power2.out',
      onComplete: () => g.destroy(),
    });
  }

  function bigWinGlow(): void {
    const w = frame.width;
    const h = frame.height;
    const g = new Graphics();
    g.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.05).stroke({
      width: w * 0.02,
      color: 0xffe08a,
    });
    g.blendMode = 'add';
    g.alpha = 0;
    fxTop.addChild(trackFx(g));
    gsap.to(g, { alpha: 0.9, duration: 0.28, yoyo: true, repeat: 3, ease: 'sine.inOut', onComplete: () => g.destroy() });
  }

  function celebrateBonus(): Promise<void> {
    return new Promise((resolve) => {
      playFlash(0.9);
      screenShake(screenH * 0.022, 0.6);
      const banner = new Text({
        text: 'HOLD & WIN!',
        style: {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: CELL * 0.62,
          fontWeight: '900',
          fill: '#ffd83a',
          stroke: { color: '#5a2d00', width: CELL * 0.05, join: 'round' },
          dropShadow: { color: '#000000', alpha: 0.5, blur: 14, distance: 10, angle: Math.PI / 2 },
        },
      });
      banner.anchor.set(0.5);
      banner.scale.set(2.6);
      banner.alpha = 0;
      fxTop.addChild(banner);
      const tl = gsap.timeline({
        onComplete: () => {
          banner.destroy();
          resolve();
        },
      });
      tl.to(banner, { alpha: 1, duration: 0.12 }, 0);
      tl.to(banner.scale, { x: 1, y: 1, duration: 0.42, ease: 'back.out(2)' }, 0);
      tl.to(banner.scale, { x: 1.06, y: 1.06, duration: 0.3, yoyo: true, repeat: 1, ease: 'sine.inOut' });
      tl.to({}, { duration: 0.5 });
      tl.to(banner, { alpha: 0, duration: 0.3 });
    });
  }

  function playWildEmphasis(reel: number, cell: number): void {
    const c = cellCenter(reel, cell);
    for (let i = 0; i < 3; i++) {
      const ring = new Graphics();
      ring.circle(0, 0, CELL * 0.5).stroke({ width: CELL * 0.055, color: 0x9fe8ff });
      ring.blendMode = 'add';
      ring.position.set(c.x, c.y);
      ring.scale.set(0.35);
      ring.alpha = 0.95;
      overlay.addChild(trackFx(ring));
      const d = i * 0.14;
      gsap.to(ring.scale, { x: 1.7, y: 1.7, duration: 0.6, delay: d, ease: 'power2.out' });
      gsap.to(ring, { alpha: 0, duration: 0.6, delay: d, ease: 'power1.out', onComplete: () => ring.destroy() });
    }
    for (let i = 0; i < 6; i++) {
      const s = new Sprite(twinkleTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = 0xcdf3ff;
      s.position.set(c.x + rnd(-0.4, 0.4) * CELL, c.y + rnd(-0.4, 0.4) * CELL);
      const size = (CELL * rnd(0.14, 0.26)) / twinkleTex.width;
      s.scale.set(0);
      overlay.addChild(trackFx(s));
      const tl = gsap.timeline({ delay: rnd(0, 0.35), onComplete: () => s.destroy() });
      tl.to(s.scale, { x: size, y: size, duration: 0.18, ease: 'back.out(3)' });
      tl.to(s.scale, { x: 0, y: 0, duration: 0.3, ease: 'power1.in' });
    }
  }

  let anticipationFx: Graphics | null = null;
  function startCoinAnticipation(): void {
    const w = frame.width;
    const h = frame.height;
    const g = new Graphics();
    g.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.05).stroke({ width: w * 0.03, color: 0xffcf4a });
    g.blendMode = 'add';
    g.alpha = 0;
    fxTop.addChild(g);
    anticipationFx = g;
    gsap.to(g, { alpha: 0.85, duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  }
  function stopCoinAnticipation(): void {
    if (anticipationFx) {
      gsap.killTweensOf(anticipationFx);
      anticipationFx.destroy();
      anticipationFx = null;
    }
  }

  function spawnTwinkle(): void {
    const c = cellCenter((Math.random() * REELS) | 0, (Math.random() * ROWS) | 0);
    const s = new Sprite(twinkleTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.position.set(c.x + rnd(-0.25, 0.25) * CELL, c.y + rnd(-0.25, 0.25) * CELL);
    const size = (CELL * rnd(0.12, 0.22)) / twinkleTex.width;
    s.scale.set(0);
    s.rotation = rnd(0, Math.PI);
    overlay.addChild(s);
    const tl = gsap.timeline({ onComplete: () => s.destroy() });
    tl.to(s.scale, { x: size, y: size, duration: 0.35, ease: 'sine.out' });
    tl.to(s.scale, { x: 0, y: 0, duration: 0.5, ease: 'sine.in' });
  }

  /** Soft radial glow disc (concentric fills) for the bonus spotlight. */
  function glowDisc(radius: number, color: number, maxAlpha: number): Graphics {
    const g = new Graphics();
    const steps = 26;
    for (let i = steps; i >= 1; i--) {
      const r = (radius * i) / steps;
      g.circle(0, 0, r).fill({ color, alpha: maxAlpha * Math.pow(1 - i / steps, 1.4) });
    }
    return g;
  }

  /** One rising, twinkling ambient mote for the bonus atmosphere. */
  function spawnBonusSparkle(parent: Container): void {
    const s = new Sprite(twinkleTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = 0xffe6a0;
    s.position.set(rnd(-BLOCK_W * 0.62, BLOCK_W * 0.62), rnd(-BLOCK_H * 0.5, BLOCK_H * 0.65));
    const size = (CELL * rnd(0.06, 0.16)) / twinkleTex.width;
    s.scale.set(0);
    s.rotation = rnd(0, Math.PI);
    parent.addChild(s);
    const tl = gsap.timeline({ onComplete: () => s.destroy() });
    tl.to(s.scale, { x: size, y: size, duration: 0.4, ease: 'sine.out' }, 0);
    tl.to(s.scale, { x: 0, y: 0, duration: 0.7, ease: 'sine.in' }, 0.4);
    tl.to(s, { y: s.y - CELL * rnd(0.4, 0.9), duration: 1.1, ease: 'sine.out' }, 0);
  }

  let twinkleAcc = 0;
  let twinkleNext = 1.6;
  ticker.add((tk) => {
    if (spinning || bonusActive || winFrames.length > 0) {
      twinkleAcc = 0;
      return;
    }
    twinkleAcc += tk.deltaMS / 1000;
    if (twinkleAcc >= twinkleNext) {
      twinkleAcc = 0;
      twinkleNext = rnd(1.4, 3.2);
      spawnTwinkle();
    }
  });

  function cellRect(reel: number, cell: number): { x: number; y: number; w: number; h: number } {
    const b = reelSet.getCellBounds(reel, cell);
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }
  function cellCenter(reel: number, cell: number): { x: number; y: number } {
    const r = cellRect(reel, cell);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /** Wrap every landed Wild in the animated golden glow frame. */
  function highlightWilds(grid: string[][]): void {
    clearWilds();
    for (let reel = 0; reel < grid.length; reel++) {
      for (let cell = 0; cell < grid[reel]!.length; cell++) {
        if (grid[reel]![cell] !== WILD) continue;
        wildCellKeys.add(`${reel}:${cell}`);
        const c = cellCenter(reel, cell);
        const anim = new AnimatedSprite(bonusFrameTextures);
        anim.anchor.set(0.5);
        anim.position.set(c.x, c.y);
        anim.width = CELL * 1.14;
        anim.height = CELL * 1.14;
        anim.animationSpeed = 0.4;
        anim.loop = true;
        // Additive blend drops the frame's dark fill, leaving only the glow +
        // sparkles as light over the Wild symbol.
        anim.blendMode = 'add';
        anim.play();
        overlay.addChild(anim); // above symbols; light-only so it won't hide the W
        wildFrames.push(anim);
      }
    }
    if (wildFrames.length > 0) playSfx('wildAttention');
  }

  function clearWilds(): void {
    for (const a of wildFrames) a.destroy();
    wildFrames.length = 0;
    wildCellKeys.clear();
  }

  function highlightCoins(grid: string[][]): void {
    clearCoins();
    for (let reel = 0; reel < grid.length; reel++) {
      for (let cell = 0; cell < grid[reel]!.length; cell++) {
        if (grid[reel]![cell] !== COIN) continue;
        const c = cellCenter(reel, cell);
        const glow = new AnimatedSprite(bonusFrameTextures);
        glow.anchor.set(0.5);
        glow.position.set(c.x, c.y);
        glow.width = CELL * 1.14;
        glow.height = CELL * 1.14;
        glow.animationSpeed = 0.4;
        glow.loop = true;
        glow.blendMode = 'add';
        glow.play();
        overlay.addChild(glow);
        coinFx.push(glow);
      }
    }
  }

  function clearCoins(): void {
    for (const g of coinFx) g.destroy({ children: true });
    coinFx.length = 0;
  }

  /** One-shot star-burst + coin shower on a winning symbol (additive). */
  function playBurst(reel: number, cell: number): void {
    const c = cellCenter(reel, cell);
    const spawn = (textures: Texture[], size: number, speed: number): void => {
      const a = new AnimatedSprite(textures);
      a.anchor.set(0.5);
      a.position.set(c.x, c.y);
      a.width = CELL * size;
      a.height = CELL * size;
      a.animationSpeed = speed;
      a.loop = false;
      a.blendMode = 'add';
      a.onComplete = (): void => {
        const i = bursts.indexOf(a);
        if (i >= 0) bursts.splice(i, 1);
        if (!a.destroyed) a.destroy();
      };
      overlay.addChild(a);
      bursts.push(a);
      a.gotoAndPlay(0);
    };
    spawn(symbolBurstTextures, 1.35, 0.3);
    spawn(symbolCoinsTextures, 1.55, 0.35);
  }

  function clearBursts(): void {
    for (const a of bursts) if (!a.destroyed) a.destroy();
    bursts.length = 0;
  }

  function drawLine(cells: LineWin['cells']): void {
    const pts = cells.map(([reel, cell]) => cellCenter(reel, cell));
    // Extend the line past the outer symbols so it exits toward the frame edges.
    const ext = CELL * 0.5;
    const start = { x: -ext, y: pts[0]!.y };
    const end = { x: BLOCK_W + ext, y: pts[pts.length - 1]!.y };
    const path = [start, ...pts, end];
    line.clear();
    line.moveTo(path[0]!.x, path[0]!.y);
    for (let i = 1; i < path.length; i++) line.lineTo(path[i]!.x, path[i]!.y);
    line.stroke({ color: 0xffe14d, width: 12, cap: 'round', join: 'round', alpha: 0.95 });
  }

  async function showWins(wins: LineWin[], amount: number): Promise<void> {
    clearWins();
    if (wins.length === 0) return;

    // A burning gold frame on every unique winning cell.
    const seen = new Set<string>();
    const positions: SymbolPosition[] = [];
    const winCenters: { x: number; y: number }[] = [];
    for (const win of wins) {
      for (const [reel, cell] of win.cells) {
        const key = `${reel}:${cell}`;
        if (seen.has(key)) continue;
        seen.add(key);
        positions.push({ reelIndex: reel, cellIndex: cell });
        const c = cellCenter(reel, cell);
        winCenters.push({ x: c.x, y: c.y });
        const anim = new AnimatedSprite(winFrameTextures);
        anim.anchor.set(0.5);
        anim.position.set(c.x, c.y);
        anim.width = CELL * 1.08;
        anim.height = CELL * 1.08;
        anim.animationSpeed = 0.5;
        anim.loop = true;
        anim.play();
        overlay.addChild(anim);
        winFrames.push(anim);
        playBurst(reel, cell); // star-burst + coin shower on the winning symbol
        if (wildCellKeys.has(key)) playWildEmphasis(reel, cell); // energy rings on a winning Wild
      }
    }

    coinFountain.burst(winCenters, BLOCK_W);

    const bx = winCenters.reduce((s, c) => s + c.x, 0) / winCenters.length;
    const by = winCenters.reduce((s, c) => s + c.y, 0) / winCenters.length;
    winBadge.show(bx - BLOCK_W / 2, by - BLOCK_H / 2, amount, CELL);

    // Sound: payline sweep + a win chime scaled to the best line.
    const best = Math.max(...wins.map((w) => w.multiplier));
    if (best >= 10) {
      screenShake(screenH * 0.016, 0.5); // punch on a big-tier line win
      bigWinGlow();
    }
    playSfx('betline');
    playSfx(best >= 25 ? 'winLarge' : best >= 10 ? 'winMedium' : best >= 5 ? 'winSmall' : 'winTiny');

    // Pop the winning symbols themselves + dim the rest (built-in spotlight).
    spotlight?.show(positions, { dimAmount: 0.35, playWinAnimation: true, promoteAboveMask: true });

    // Trace the payline(s). With multiple wins, cycle through them.
    const ordered = [...wins].sort((a, b) => b.multiplier - a.multiplier);
    drawLine(ordered[0]!.cells);
    line.alpha = 0;
    tweens.push(gsap.to(line, { alpha: 1, duration: 0.35, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
    if (ordered.length > 1) {
      let idx = 0;
      lineCycle = gsap.to(
        {},
        {
          duration: 0.9,
          repeat: -1,
          onRepeat: () => {
            idx = (idx + 1) % ordered.length;
            drawLine(ordered[idx]!.cells);
          },
        },
      );
    }

    await wait(1600);
  }

  function clearWins(): void {
    for (const t of tweens) t.kill();
    tweens.length = 0;
    lineCycle?.kill();
    lineCycle = null;
    spotlight?.hide();
    for (const a of winFrames) a.destroy();
    winFrames.length = 0;
    clearBursts();
    clearFx();
    coinFountain.clear();
    winBadge.clear();
    line.clear();
    line.alpha = 0;
  }

  // --- Hold & Win bonus ---
  // Pace the bonus off the render ticker (not wall-clock), so pacing and
  // rendering stay in lockstep even in a throttled/background tab.
  function waitFrames(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let acc = 0;
      const cb = (tk: Ticker): void => {
        acc += tk.deltaMS;
        if (acc >= ms) {
          ticker.remove(cb);
          resolve();
        }
      };
      ticker.add(cb);
    });
  }

  const coinTile = symbolTextures[COIN];
  const cKey = (r: number, c: number): string => `${r}:${c}`;

  function bonusCell(reel: number, cell: number, val: CoinValue | null): Container {
    const c = cellCenter(reel, cell);
    const cont = new Container();
    cont.position.set(c.x, c.y);
    const tileSize = CELL * COIN_TILE_FILL;
    const tile = new Sprite(coinTile);
    tile.anchor.set(0.5);
    tile.width = tileSize;
    tile.height = tileSize;
    tile.alpha = val ? 1 : 0.18;
    cont.addChild(tile);
    if (val) {
      if (val.kind === 'jackpot') {
        const jp = new Sprite(jackpotTextures[val.id]);
        jp.anchor.set(0.5);
        jp.width = CELL * COIN_JACKPOT_FILL;
        jp.height = CELL * COIN_JACKPOT_FILL;
        cont.addChild(jp);
      } else {
        const t = new Text({
          text: `${val.amount}`,
          style: {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: CELL * 0.5,
            fontWeight: '900',
            fill: '#ffffff',
            stroke: { color: '#7a3d00', width: CELL * 0.045, join: 'round' },
          },
        });
        t.anchor.set(0.5);
        t.scale.set(fitScale(t.width, t.height, tileSize * COIN_TEXT_BOX_W, tileSize * COIN_TEXT_BOX_H));
        cont.addChild(t);
      }
      const glow = new AnimatedSprite(bonusFrameTextures);
      glow.anchor.set(0.5);
      glow.width = CELL * 1.14;
      glow.height = CELL * 1.14;
      glow.animationSpeed = 0.4;
      glow.loop = true;
      glow.blendMode = 'add';
      glow.play();
      cont.addChild(glow);
    }
    return cont;
  }

  async function runBonus(bonus: BonusResult): Promise<void> {
    bonusActive = true;
    clearWins();
    clearWilds();
    clearCoins();

    playSfx('bonusEnter');
    await celebrateBonus(); // "HOLD & WIN!" banner + flash + shake before the board

    const layer = new Container();
    view.addChild(layer);

    // Warm dark backdrop (covers the whole screen at any board scale).
    const dim = new Graphics();
    dim.rect(-BLOCK_W * 2.5, -BLOCK_H * 2.5, BLOCK_W * 5, BLOCK_H * 5).fill({ color: 0x0b0713, alpha: 0.9 });
    layer.addChild(dim);

    // Golden spotlight glow behind the coin board, gently breathing.
    const glow = glowDisc(BLOCK_W * 1.05, 0xffb43e, 0.44);
    glow.blendMode = 'add';
    layer.addChild(glow);
    gsap.to(glow.scale, { x: 1.08, y: 1.08, duration: 1.8, yoyo: true, repeat: -1, ease: 'sine.inOut' });

    // Ambient rising motes for atmosphere.
    const ambientLayer = new Container();
    layer.addChild(ambientLayer);
    const ambient = gsap.timeline({ repeat: -1 });
    ambient.call(() => spawnBonusSparkle(ambientLayer)).to({}, { duration: 0.26 });

    const boardLayer = new Container();
    boardLayer.x = -BLOCK_W / 2;
    boardLayer.y = -BLOCK_H / 2;
    layer.addChild(boardLayer);

    const conts = new Map<string, Container>();
    const setCell = (reel: number, cell: number, val: CoinValue | null): Container => {
      conts.get(cKey(reel, cell))?.destroy({ children: true });
      const cont = bonusCell(reel, cell, val);
      boardLayer.addChild(cont);
      conts.set(cKey(reel, cell), cont);
      return cont;
    };

    const respinBox = new Container();
    respinBox.position.set(0, -BLOCK_H / 2 - CELL * 0.78);
    const boxBg = new Graphics();
    respinBox.addChild(boxBg);
    const label = new Text({
      text: '',
      style: {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: CELL * 0.32,
        fontWeight: '900',
        fill: '#ffd83a',
        stroke: { color: '#3a1c00', width: CELL * 0.035, join: 'round' },
      },
    });
    label.anchor.set(0.5);
    respinBox.addChild(label);
    layer.addChild(respinBox);
    const setBanner = (text: string): void => {
      label.text = text;
      const w = label.width + CELL * 0.5;
      const h = label.height + CELL * 0.2;
      boxBg
        .clear()
        .roundRect(-w / 2, -h / 2, w, h, h * 0.4)
        .fill({ color: 0x140a1e, alpha: 0.85 })
        .stroke({ width: h * 0.07, color: 0xffcf5a });
    };
    const setRespins = (n: number): void => setBanner(`RESPINS  ${n}`);

    // Chest that reacts to the collection: idles under the board, bumps on each
    // fresh landing, and plays its level-up flourish on a full board. Optional —
    // if the Spine assets didn't load, the bonus runs exactly as before.
    let chest: ReturnType<typeof createChest> | null = null;
    try {
      await loadChestAssets();
      chest = createChest(ticker);
      const c = chest.view;
      c.scale.set((CELL * 2.0) / CHEST_NATIVE_W);
      c.position.set(0, BLOCK_H / 2 + CELL * 0.05);
      layer.addChild(c);
    } catch {
      chest = null;
    }

    const seeded = new Map<string, CoinValue>();
    for (const coin of bonus.seed) seeded.set(cKey(coin.reel, coin.cell), coin.value);
    for (let reel = 0; reel < REELS; reel++) {
      for (let cell = 0; cell < ROWS; cell++) {
        setCell(reel, cell, seeded.get(cKey(reel, cell)) ?? null);
      }
    }

    playSfx('stickySplashScreen');
    setRespins(BONUS_RESPINS);
    await waitFrames(700);

    for (const step of bonus.respins) {
      for (const land of step.lands) {
        const cont = setCell(land.reel, land.cell, land.value);
        gsap.from(cont.scale, { x: 0, y: 0, duration: 0.32, ease: 'back.out(2)' });
      }
      if (step.lands.length > 0) chest?.playHit();
      setRespins(step.respinsLeft);
      playSfx(step.lands.length > 0 ? 'stickyReelLanding' : 'stickyNoWin');
      await waitFrames(750);
    }

    setBanner(bonus.fullBoard ? 'FULL BOARD!' : 'COLLECT');
    if (bonus.fullBoard) chest?.playTransition();
    playSfx('stickyEnds');
    await waitFrames(900);
    ambient.kill();
    gsap.killTweensOf(glow.scale);
    layer.destroy({ children: true });
    bonusActive = false;
  }

  function layout(width: number, height: number, top: number, bottom: number): void {
    // Size the frame from the MEASURED grid.png geometry so the reels land in
    // its columns: the reel column pitch (CELL+GAP_X) equals the frame's column
    // pitch, and the reel block fills the frame's open vertical span. Scaled
    // (slightly non-uniform) rather than assuming even thirds.
    const reelPitchX = CELL + GAP_X;
    frame.width = reelPitchX / FRAME_COL_PITCH_FRAC;
    frame.height = BLOCK_H / FRAME_ROW_SPAN_FRAC;

    const boardW = frame.width;
    const boardH = frame.height;
    const availH = Math.max(120, height - top - bottom);
    const scale = Math.min((width * 0.94) / boardW, availH / boardH);
    view.scale.set(scale);
    view.x = width / 2;
    view.y = top + availH / 2;
    baseX = view.x;
    baseY = view.y;
    screenH = height;
  }

  return { view, spin, skip, showWins, clearWins, layout, runBonus };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
