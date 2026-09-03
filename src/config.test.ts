import { describe, it, expect } from 'vitest';
import {
  evaluate,
  winTier,
  PAYOUTS,
  PAYING,
  PAYLINES,
  WEIGHTS,
  JACKPOTS,
  JACKPOT_VALUES,
  COIN_VALUES,
  SYMBOL_FILES,
  WILD,
  COIN,
  REELS,
  ROWS,
} from './config';

const fill = (s: string): string[][] => [
  [s, s, s],
  [s, s, s],
  [s, s, s],
];

describe('evaluate', () => {
  it('returns no wins when nothing lines up', () => {
    const grid = [
      ['spade', 'clover', 'diamond'],
      ['heart', 'grapes', 'coconut'],
      ['pear', 'strawberry', 'spade'],
    ];
    expect(evaluate(grid)).toEqual([]);
  });

  it('pays a three-of-a-kind on the top row', () => {
    const grid = [
      ['heart', 'spade', 'clover'],
      ['heart', 'grapes', 'coconut'],
      ['heart', 'pear', 'diamond'],
    ];
    const wins = evaluate(grid);
    expect(wins).toHaveLength(1);
    expect(wins[0]).toMatchObject({ line: 0, symbol: 'heart', multiplier: PAYOUTS.heart });
  });

  it('lets the wild substitute for a paying symbol', () => {
    const grid = [
      ['heart', 'spade', 'clover'],
      [WILD, 'grapes', 'coconut'],
      ['heart', 'pear', 'diamond'],
    ];
    const wins = evaluate(grid);
    expect(wins).toHaveLength(1);
    expect(wins[0]).toMatchObject({ symbol: 'heart', multiplier: PAYOUTS.heart });
  });

  it('pays the wild value for an all-wild line', () => {
    const grid = [
      [WILD, 'spade', 'clover'],
      [WILD, 'grapes', 'coconut'],
      [WILD, 'pear', 'diamond'],
    ];
    const wins = evaluate(grid);
    expect(wins).toHaveLength(1);
    expect(wins[0]).toMatchObject({ symbol: WILD, multiplier: PAYOUTS[WILD] });
  });

  it('pays the ↘ diagonal', () => {
    const grid = [
      ['clover', 'spade', 'pear'],
      ['heart', 'clover', 'coconut'],
      ['grapes', 'diamond', 'clover'],
    ];
    const wins = evaluate(grid);
    expect(wins).toHaveLength(1);
    expect(wins[0]).toMatchObject({ line: 3, symbol: 'clover', multiplier: PAYOUTS.clover });
  });

  it('pays all five lines when the whole grid is one symbol', () => {
    const wins = evaluate(fill('heart'));
    expect(wins).toHaveLength(PAYLINES.length);
    const total = wins.reduce((sum, w) => sum + w.multiplier, 0);
    expect(total).toBe(PAYLINES.length * PAYOUTS.heart);
  });

  it('never pays a money-symbol line', () => {
    expect(evaluate(fill(COIN))).toEqual([]);
  });

  it('does not pay a line mixing a coin with paying symbols', () => {
    const grid = [
      [COIN, 'spade', 'clover'],
      ['heart', 'grapes', 'coconut'],
      ['heart', 'pear', 'diamond'],
    ];
    expect(evaluate(grid)).toEqual([]);
  });

  it('does not pay a wild + coin line (anchor is the coin)', () => {
    const grid = [
      [WILD, 'spade', 'clover'],
      [COIN, 'grapes', 'coconut'],
      [WILD, 'pear', 'diamond'],
    ];
    expect(evaluate(grid)).toEqual([]);
  });

  it('skips lines with missing cells without throwing', () => {
    expect(
      evaluate([
        ['heart', 'spade', 'clover'],
        ['heart', 'grapes', 'coconut'],
      ]),
    ).toEqual([]);
  });
});

describe('winTier', () => {
  it.each([
    [0, null],
    [9.99, null],
    [10, 'big'],
    [24.9, 'big'],
    [25, 'mega'],
    [49.9, 'mega'],
    [50, 'epic'],
    [1000, 'epic'],
  ])('maps %s× to %s', (mult, tier) => {
    expect(winTier(mult)).toBe(tier);
  });
});

describe('config invariants', () => {
  it('gives every paying symbol a positive payout', () => {
    for (const id of PAYING) expect(PAYOUTS[id]).toBeGreaterThan(0);
  });

  it('pays the coin 0 on lines', () => {
    expect(PAYOUTS[COIN]).toBe(0);
  });

  it('has a weight for every registered symbol', () => {
    for (const id of Object.keys(SYMBOL_FILES)) expect(WEIGHTS[id]).toBeGreaterThan(0);
  });

  it('has five in-bounds paylines of three cells', () => {
    expect(PAYLINES).toHaveLength(5);
    for (const line of PAYLINES) {
      expect(line).toHaveLength(3);
      for (const [reel, cell] of line) {
        expect(reel).toBeGreaterThanOrEqual(0);
        expect(reel).toBeLessThan(REELS);
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThan(ROWS);
      }
    }
  });

  it('has valid, positively-weighted jackpots with payouts', () => {
    const ids = ['mini', 'minor', 'major', 'grand'];
    expect(JACKPOTS.map((j) => j.id).sort()).toEqual([...ids].sort());
    for (const j of JACKPOTS) expect(j.weight).toBeGreaterThan(0);
    for (const id of ids) expect(JACKPOT_VALUES[id as keyof typeof JACKPOT_VALUES]).toBeGreaterThan(0);
  });

  it('has only positive coin values', () => {
    expect(COIN_VALUES.length).toBeGreaterThan(0);
    for (const v of COIN_VALUES) expect(v).toBeGreaterThan(0);
  });
});
