import { AnimatedSprite, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Renderer, Ticker } from 'pixi.js';
import { ReelSetBuilder, SpriteSymbol, SymbolSpotlight } from 'pixi-reels';
import type { ReelSet, ColumnTarget, SymbolPosition } from 'pixi-reels';
import { gsap } from 'gsap';
import { playSfx, stopSfx } from './sfx';
import {
  BLOCK_H,
  BLOCK_W,
  BONUS_RESPINS,
  CELL,
  COIN,
  COIN_LAND_CHANCE,
  COIN_VALUES,
  FRAME_COL_PITCH_FRAC,
  FRAME_ROW_SPAN_FRAC,
  GAP_X,
  GAP_Y,
  JACKPOT_VALUES,
  JACKPOTS,
  PAYLINES,
  PAYOUTS,
  REELS,
  ROWS,
  WEIGHTS,
  WILD,
  type LineWin,
  type SymbolId,
} from './config';

type JackpotId = 'mini' | 'minor' | 'major' | 'grand';

/** A pending line is worth teasing the last reel for if it could pay this much. */
const TEASE_MIN_PAYOUT = 14;


export interface Board {
  /** The whole board (wooden frame + reels + win overlay), scaled to fit. */
  readonly view: Container;
  /** Start a spin, land on `grid` ([reel][cell]), resolve when settled. */
  spin(grid: string[][], turbo: boolean): Promise<void>;
  /** Land the in-flight spin immediately. */
  skip(): void;
  /** Highlight winning lines: gold frames on winners + an animated payline. */
  showWins(wins: LineWin[]): Promise<void>;
  /** Clear any win highlight. */
  clearWins(): void;
  /** Re-fit the board into the given screen rect. */
  layout(width: number, height: number, top: number, bottom: number): void;
  /** A ready weighted random grid for demo/idle spins. */
  randomGrid(): string[][];
  /** Count the money symbols on a grid. */
  countCoins(grid: string[][]): number;
  /** Run the Hold & Win respin round from the triggering coins; resolves with
   *  the total win (× bet already applied). */
  runBonus(bet: number, coinCells: Array<{ reel: number; cell: number }>): Promise<number>;
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
        r.register(id, SpriteSymbol, { textures: { [id]: tex } });
      }
    })
    .weights(WEIGHTS)
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

  reelSet.events.on('spin:reelLanded', () => playSfx('reelLanding'));

  const symbolIds = Object.keys(symbolTextures) as SymbolId[];
  const weighted: SymbolId[] = [];
  for (const id of symbolIds) for (let i = 0; i < (WEIGHTS[id] ?? 1); i++) weighted.push(id);
  const randomSymbol = (): SymbolId => weighted[(Math.random() * weighted.length) | 0]!;

  function randomGrid(): string[][] {
    return Array.from({ length: REELS }, () =>
      Array.from({ length: ROWS }, () => randomSymbol() as string),
    );
  }

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

  async function spin(grid: string[][], turbo: boolean): Promise<void> {
    clearWins();
    clearWilds();
    clearCoins();
    stopSfx(); // clear any lingering long sound (spin/anticipation/bigwin) from before
    playSfx('spin-start');
    playSfx('reelsSpin');
    const p = reelSet.spin();
    // Give the reels a beat of free spin before revealing the outcome.
    if (!turbo) await wait(220);
    reelSet.setResult(toTargets(grid));
    // Anticipation: slow the final reel dramatically when a big line is pending.
    if (!turbo && teaseLastReel(grid)) {
      reelSet.setAnticipation([REELS - 1], { slowdown: { from: 0.5, to: 0.12 } });
      playSfx('anticipation');
    }
    await p;
    stopSfx('reelsSpin'); // the long spin loop ends the moment the reels land
    stopSfx('anticipation');
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
  const tweens: gsap.core.Tween[] = [];
  let lineCycle: gsap.core.Tween | null = null;

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
  }

  function pick<T>(items: readonly T[]): T {
    return items[(Math.random() * items.length) | 0]!;
  }
  function pickJackpot(): JackpotId {
    const total = JACKPOTS.reduce((sum, j) => sum + j.weight, 0);
    let r = Math.random() * total;
    for (const j of JACKPOTS) if ((r -= j.weight) < 0) return j.id;
    return 'mini';
  }

  /** Give every landed money symbol its glow + a random value (cash or jackpot). */
  function highlightCoins(grid: string[][]): void {
    clearCoins();
    for (let reel = 0; reel < grid.length; reel++) {
      for (let cell = 0; cell < grid[reel]!.length; cell++) {
        if (grid[reel]![cell] !== COIN) continue;
        const c = cellCenter(reel, cell);
        const group = new Container();
        group.position.set(c.x, c.y);

        // ~28% of coins carry a jackpot tier; the rest carry a cash value.
        if (Math.random() < 0.28) {
          const jp = new Sprite(jackpotTextures[pickJackpot()]);
          jp.anchor.set(0.5);
          jp.width = CELL * 0.92;
          jp.height = CELL * 0.92;
          group.addChild(jp);
        } else {
          const value = new Text({
            text: `${pick(COIN_VALUES)}`,
            style: {
              fontFamily: 'Arial Black, Arial, sans-serif',
              fontSize: CELL * 0.34,
              fontWeight: '900',
              fill: '#ffe14d',
              stroke: { color: '#5a3a00', width: CELL * 0.03, join: 'round' },
              dropShadow: { color: '#000000', alpha: 0.35, blur: 6, distance: 6, angle: Math.PI / 2 },
            },
          });
          value.anchor.set(0.5);
          group.addChild(value);
        }

        // Golden glow frame (same as Wilds), additive so its dark fill drops out.
        const glow = new AnimatedSprite(bonusFrameTextures);
        glow.anchor.set(0.5);
        glow.width = CELL * 1.14;
        glow.height = CELL * 1.14;
        glow.animationSpeed = 0.4;
        glow.loop = true;
        glow.blendMode = 'add';
        glow.play();
        group.addChild(glow);

        overlay.addChild(group);
        coinFx.push(group);
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

  async function showWins(wins: LineWin[]): Promise<void> {
    clearWins();
    if (wins.length === 0) return;

    // A burning gold frame on every unique winning cell.
    const seen = new Set<string>();
    const positions: SymbolPosition[] = [];
    for (const win of wins) {
      for (const [reel, cell] of win.cells) {
        const key = `${reel}:${cell}`;
        if (seen.has(key)) continue;
        seen.add(key);
        positions.push({ reelIndex: reel, cellIndex: cell });
        const c = cellCenter(reel, cell);
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
      }
    }

    // Sound: payline sweep + a win chime scaled to the best line.
    const best = Math.max(...wins.map((w) => w.multiplier));
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
  type CoinVal = { kind: 'cash'; v: number } | { kind: 'jp'; id: JackpotId };
  const cKey = (r: number, c: number): string => `${r}:${c}`;
  const genCoinValue = (): CoinVal =>
    Math.random() < 0.28 ? { kind: 'jp', id: pickJackpot() } : { kind: 'cash', v: pick(COIN_VALUES) };
  const coinPayout = (v: CoinVal, bet: number): number =>
    v.kind === 'cash' ? v.v * bet : JACKPOT_VALUES[v.id] * bet;

  function countCoins(grid: string[][]): number {
    let n = 0;
    for (const col of grid) for (const s of col) if (s === COIN) n++;
    return n;
  }

  /** Build one bonus cell: gold tile + value (cash text / jackpot) + glow. */
  function bonusCell(reel: number, cell: number, val: CoinVal | null): Container {
    const c = cellCenter(reel, cell);
    const cont = new Container();
    cont.position.set(c.x, c.y);
    const tile = new Sprite(coinTile);
    tile.anchor.set(0.5);
    tile.width = CELL * 0.92;
    tile.height = CELL * 0.92;
    tile.alpha = val ? 1 : 0.18;
    cont.addChild(tile);
    if (val) {
      if (val.kind === 'jp') {
        const jp = new Sprite(jackpotTextures[val.id]);
        jp.anchor.set(0.5);
        jp.width = CELL * 0.92;
        jp.height = CELL * 0.92;
        cont.addChild(jp);
      } else {
        const t = new Text({
          text: `${val.v}`,
          style: {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: CELL * 0.34,
            fontWeight: '900',
            fill: '#ffe14d',
            stroke: { color: '#5a3a00', width: CELL * 0.03, join: 'round' },
          },
        });
        t.anchor.set(0.5);
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

  async function runBonus(
    bet: number,
    coinCells: Array<{ reel: number; cell: number }>,
  ): Promise<number> {
    clearWins();
    clearWilds();
    clearCoins();

    const layer = new Container();
    view.addChild(layer);
    const dim = new Graphics();
    dim.rect(-BLOCK_W / 2 - CELL, -BLOCK_H / 2 - CELL, BLOCK_W + CELL * 2, BLOCK_H + CELL * 2)
      .fill({ color: 0x000000, alpha: 0.66 });
    layer.addChild(dim);

    const boardLayer = new Container();
    boardLayer.x = -BLOCK_W / 2;
    boardLayer.y = -BLOCK_H / 2;
    layer.addChild(boardLayer);

    const values = new Map<string, CoinVal>();
    const conts = new Map<string, Container>();
    const setCell = (reel: number, cell: number, val: CoinVal | null): void => {
      conts.get(cKey(reel, cell))?.destroy({ children: true });
      const cont = bonusCell(reel, cell, val);
      boardLayer.addChild(cont);
      conts.set(cKey(reel, cell), cont);
    };

    // Respins counter.
    const label = new Text({
      text: '',
      style: {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: CELL * 0.3,
        fontWeight: '900',
        fill: '#ffffff',
        stroke: { color: '#1b3a6b', width: CELL * 0.03, join: 'round' },
      },
    });
    label.anchor.set(0.5, 0);
    label.position.set(0, -BLOCK_H / 2 - CELL * 0.62);
    layer.addChild(label);
    const setRespins = (n: number): void => {
      label.text = `RESPINS  ${n}`;
    };

    // Seed: held coins get values, the rest start empty.
    for (let reel = 0; reel < REELS; reel++) {
      for (let cell = 0; cell < ROWS; cell++) {
        const held = coinCells.some((cc) => cc.reel === reel && cc.cell === cell);
        const val = held ? genCoinValue() : null;
        if (val) values.set(cKey(reel, cell), val);
        setCell(reel, cell, val);
      }
    }

    playSfx('stickySplashScreen');
    let respins = BONUS_RESPINS;
    setRespins(respins);
    await waitFrames(700);

    while (respins > 0 && values.size < REELS * ROWS) {
      let landed = false;
      for (let reel = 0; reel < REELS; reel++) {
        for (let cell = 0; cell < ROWS; cell++) {
          if (values.has(cKey(reel, cell))) continue;
          if (Math.random() >= COIN_LAND_CHANCE) continue;
          const val = genCoinValue();
          values.set(cKey(reel, cell), val);
          setCell(reel, cell, val);
          const cont = conts.get(cKey(reel, cell))!;
          gsap.from(cont.scale, { x: 0, y: 0, duration: 0.32, ease: 'back.out(2)' });
          landed = true;
        }
      }
      respins = landed ? BONUS_RESPINS : respins - 1;
      setRespins(respins);
      playSfx(landed ? 'stickyReelLanding' : 'stickyNoWin');
      await waitFrames(750);
    }

    // Collect.
    let total = 0;
    for (const v of values.values()) total += coinPayout(v, bet);
    total = Math.round(total * 1e8) / 1e8;
    label.text = values.size === REELS * ROWS ? 'FULL BOARD!' : 'COLLECT';
    playSfx('stickyEnds');
    await waitFrames(900);
    layer.destroy({ children: true });
    return total;
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
  }

  return { view, spin, skip, showWins, clearWins, layout, randomGrid, countCoins, runBonus };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
