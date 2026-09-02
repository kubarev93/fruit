import { AnimatedSprite, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Renderer, Ticker } from 'pixi.js';
import { ReelSetBuilder, SpriteSymbol, SymbolSpotlight } from 'pixi-reels';
import type { ReelSet, ColumnTarget, SymbolPosition } from 'pixi-reels';
import { gsap } from 'gsap';
import {
  BLOCK_H,
  BLOCK_W,
  CELL,
  GAP,
  PAYLINES,
  PAYOUTS,
  REELS,
  ROWS,
  WEIGHTS,
  WILD,
  type LineWin,
  type SymbolId,
} from './config';

/** A pending line is worth teasing the last reel for if it could pay this much. */
const TEASE_MIN_PAYOUT = 14;

/** Fraction of the frame art that is border (each side), used to inset the reels. */
const FRAME_PAD = 0.055;

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
}

export function createBoard(
  ticker: Ticker,
  renderer: Renderer,
  symbolTextures: Record<SymbolId, Texture>,
  frameTexture: Texture,
  winFrameTextures: Texture[],
  bonusFrameTextures: Texture[],
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
    .symbolGap(GAP, GAP)
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
    const p = reelSet.spin();
    // Give the reels a beat of free spin before revealing the outcome.
    if (!turbo) await wait(220);
    reelSet.setResult(toTargets(grid));
    // Anticipation: slow the final reel dramatically when a big line is pending.
    if (!turbo && teaseLastReel(grid)) {
      reelSet.setAnticipation([REELS - 1], { slowdown: { from: 0.5, to: 0.12 } });
    }
    await p;
    highlightWilds(grid);
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
  }

  function clearWilds(): void {
    for (const a of wildFrames) a.destroy();
    wildFrames.length = 0;
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
      }
    }

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
    line.clear();
    line.alpha = 0;
  }

  function layout(width: number, height: number, top: number, bottom: number): void {
    // Fit the frame art around the reel block, then scale the board into the
    // free vertical band between the logo (top) and the HUD (bottom).
    const frameAspect = frameTexture.width / frameTexture.height;
    const innerW = frameTexture.width * (1 - FRAME_PAD * 2);
    const artScale = BLOCK_W / innerW;
    frame.width = frameTexture.width * artScale;
    frame.height = frame.width / frameAspect;

    const boardW = frame.width;
    const boardH = frame.height;
    const availH = Math.max(120, height - top - bottom);
    const scale = Math.min((width * 0.94) / boardW, availH / boardH);
    view.scale.set(scale);
    view.x = width / 2;
    view.y = top + availH / 2;
  }

  return { view, spin, skip, showWins, clearWins, layout, randomGrid };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
