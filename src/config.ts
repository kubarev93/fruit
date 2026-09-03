/**
 * Static game configuration: the symbol set, the reel geometry, the paylines
 * and the paytable. Kept free of Pixi/DOM so it can be unit-tested and reused.
 */

/** Every symbol id used by the base game, mapped to its source art file. */
export const SYMBOL_FILES: Record<string, string> = {
  wild: 'a.png', // W — substitutes for any paying symbol
  grapes: 'b.png',
  coconut: 'c.png',
  strawberry: 'd.png',
  pear: 'k.png',
  heart: 'l.png',
  clover: 'm.png',
  spade: 'n.png',
  diamond: 'o.png',
  coin: 'z.png', // Hold & Win money symbol (a gold tile holding a value/jackpot)
};

export type SymbolId = keyof typeof SYMBOL_FILES;

export const WILD: SymbolId = 'wild';
export const COIN: SymbolId = 'coin';

/** The paying symbols (everything except the wild), high value first. */
export const PAYING: SymbolId[] = [
  'heart',
  'strawberry',
  'grapes',
  'coconut',
  'pear',
  'diamond',
  'clover',
  'spade',
];

/**
 * Strip weights — how often each symbol shows up on the reels. Rarer symbols
 * pay more. The wild is the rarest.
 */
export const WEIGHTS: Record<SymbolId, number> = {
  wild: 4,
  coin: 5, // money symbol — rare
  heart: 8,
  strawberry: 10,
  grapes: 11,
  coconut: 12,
  pear: 14,
  diamond: 16,
  clover: 18,
  spade: 20,
};

/** Payout multiplier (× total bet) for a full 3-of-a-kind line. Coin pays 0
 *  on lines — it's a money symbol, not a line symbol. */
export const PAYOUTS: Record<SymbolId, number> = {
  wild: 50,
  heart: 25,
  strawberry: 18,
  grapes: 14,
  coconut: 10,
  pear: 8,
  diamond: 6,
  clover: 4,
  spade: 3,
  coin: 0,
};

/** Jackpot tiers a money symbol can carry, weighted (mini common → grand rare). */
export interface Jackpot {
  id: 'mini' | 'minor' | 'major' | 'grand';
  weight: number;
}
export const JACKPOTS: Jackpot[] = [
  { id: 'mini', weight: 60 },
  { id: 'minor', weight: 25 },
  { id: 'major', weight: 12 },
  { id: 'grand', weight: 3 },
];

/** Cash values (× bet) a money symbol can carry. */
export const COIN_VALUES = [1, 2, 3, 5, 8, 10, 15, 20, 25, 50, 100];

/** Jackpot payout (× bet) when a money symbol carrying that tier is collected. */
export const JACKPOT_VALUES: Record<'mini' | 'minor' | 'major' | 'grand', number> = {
  mini: 20,
  minor: 100,
  major: 500,
  grand: 5000,
};

/** Hold & Win bonus tuning. */
export const BONUS_TRIGGER = 4; // coins on a spin to start the bonus
export const BONUS_RESPINS = 3; // respins granted, reset whenever a new coin lands
export const COIN_LAND_CHANCE = 0.24; // per empty cell, per respin

/** Grid shape. */
export const REELS = 3;
export const ROWS = 3;

/**
 * Design-space cell size (px) — the whole scene is scaled to fit the screen.
 * Set to the symbol art's NATIVE size (768px): pixi-reels renders a recycled
 * symbol at its texture's native size (it resets the sprite scale to 1 on reuse
 * without re-applying `symbolSize`), so matching the two keeps every symbol the
 * right size — no giant symbols mid-spin — while preserving full resolution.
 */
export const CELL = 768;
/** Gaps between symbols. Horizontal is wider to match the frame's column pitch. */
export const GAP_X = 150;
export const GAP_Y = 58;

/** Pixel width/height of the 3×3 symbol block (no frame). */
export const BLOCK_W = REELS * CELL + (REELS - 1) * GAP_X;
export const BLOCK_H = ROWS * CELL + (ROWS - 1) * GAP_Y;

/**
 * grid.png structure, measured from the art (344×315): the three columns sit at
 * x = 62 / 172 / 282 (pitch ≈ 110), and the open reel area runs y = 10..300.
 * The reels are aligned to this instead of assuming even thirds.
 */
export const FRAME_COL_PITCH_FRAC = 110 / 344; // reel pitch ÷ frame width
export const FRAME_ROW_SPAN_FRAC = 290 / 315; // reel block height ÷ frame height

/** A payline as a list of [reelIndex, cellIndex] cells, left → right. */
export type Payline = ReadonlyArray<readonly [number, number]>;

/** 5 lines on a 3×3: the three rows, then the two diagonals. */
export const PAYLINES: readonly Payline[] = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
  ], // top row
  [
    [0, 1],
    [1, 1],
    [2, 1],
  ], // middle row
  [
    [0, 2],
    [1, 2],
    [2, 2],
  ], // bottom row
  [
    [0, 0],
    [1, 1],
    [2, 2],
  ], // ↘ diagonal
  [
    [0, 2],
    [1, 1],
    [2, 0],
  ], // ↗ diagonal
];

export interface LineWin {
  line: number;
  symbol: SymbolId;
  cells: ReadonlyArray<readonly [number, number]>;
  multiplier: number;
}

/**
 * Evaluate a landed grid (`grid[reel][cell]`) against every payline. A line
 * wins when all three symbols match, with the wild substituting for any
 * paying symbol. Returns one entry per winning line.
 */
export function evaluate(grid: string[][]): LineWin[] {
  const wins: LineWin[] = [];
  PAYLINES.forEach((line, index) => {
    const ids = line.map(([r, c]) => grid[r]?.[c]);
    if (ids.some((s) => s == null)) return;

    // The winning symbol is the first non-wild on the line (all-wild counts as wild).
    const anchor = (ids.find((s) => s !== WILD) ?? WILD) as SymbolId;
    const matches = ids.every((s) => s === anchor || s === WILD);
    if (!matches) return;

    const multiplier = PAYOUTS[anchor] ?? 0;
    if (multiplier <= 0) return; // money symbols / non-payers don't win lines

    wins.push({ line: index, symbol: anchor, cells: line, multiplier });
  });
  return wins;
}

export type WinTier = 'big' | 'mega' | 'epic';

export function winTier(multiplier: number): WinTier | null {
  if (multiplier >= 50) return 'epic';
  if (multiplier >= 25) return 'mega';
  if (multiplier >= 10) return 'big';
  return null;
}
