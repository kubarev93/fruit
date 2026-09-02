import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Renderer, Ticker } from 'pixi.js';
import { ReelSetBuilder, SpriteSymbol } from 'pixi-reels';
import type { ReelSet, ColumnTarget } from 'pixi-reels';
import { gsap } from 'gsap';
import {
  BLOCK_H,
  BLOCK_W,
  CELL,
  GAP,
  REELS,
  ROWS,
  WEIGHTS,
  type LineWin,
  type SymbolId,
} from './config';

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

  async function spin(grid: string[][], turbo: boolean): Promise<void> {
    clearWins();
    const p = reelSet.spin();
    // Give the reels a beat of free spin before revealing the outcome.
    if (!turbo) await wait(220);
    reelSet.setResult(toTargets(grid));
    await p;
  }

  function skip(): void {
    try {
      reelSet.skipSpin();
    } catch {
      reelSet.slamStop();
    }
  }

  // --- win presentation ---
  const frames: Graphics[] = [];
  const line = new Graphics();
  overlay.addChild(line);
  const tweens: gsap.core.Tween[] = [];

  function cellRect(reel: number, cell: number): { x: number; y: number; w: number; h: number } {
    const b = reelSet.getCellBounds(reel, cell);
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }
  function cellCenter(reel: number, cell: number): { x: number; y: number } {
    const r = cellRect(reel, cell);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  async function showWins(wins: LineWin[]): Promise<void> {
    clearWins();
    if (wins.length === 0) return;

    const seen = new Set<string>();
    for (const win of wins) {
      for (const [reel, cell] of win.cells) {
        const key = `${reel}:${cell}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const r = cellRect(reel, cell);
        const g = new Graphics();
        g.roundRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 22)
          .stroke({ color: 0xffd23f, width: 7, alignment: 0.5 })
          .stroke({ color: 0xff8a00, width: 3, alignment: 1 });
        overlay.addChild(g);
        frames.push(g);
        tweens.push(
          gsap.fromTo(
            g,
            { alpha: 0.25 },
            { alpha: 1, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' },
          ),
        );
      }
    }

    // Draw + trace the payline of the highest win.
    const best = [...wins].sort((a, b) => b.multiplier - a.multiplier)[0]!;
    const pts = best.cells.map(([reel, cell]) => cellCenter(reel, cell));
    line.clear();
    line.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) line.lineTo(pts[i]!.x, pts[i]!.y);
    line.stroke({ color: 0xffe14d, width: 10, cap: 'round', join: 'round', alpha: 0.95 });
    line.alpha = 0;
    tweens.push(gsap.to(line, { alpha: 1, duration: 0.35, yoyo: true, repeat: -1, ease: 'sine.inOut' }));

    await wait(1600);
  }

  function clearWins(): void {
    for (const t of tweens) t.kill();
    tweens.length = 0;
    for (const g of frames) g.destroy();
    frames.length = 0;
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
