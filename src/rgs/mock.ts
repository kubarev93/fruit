import {
  BONUS_RESPINS,
  BONUS_TRIGGER,
  COIN,
  COIN_LAND_CHANCE,
  COIN_VALUES,
  JACKPOTS,
  JACKPOT_VALUES,
  REELS,
  ROWS,
  countCoins,
  evaluate,
  randomGrid,
} from '../config';
import type { AuthResult, BonusCoin, BonusRespin, BonusResult, CoinValue, RgsClient, Round } from './types';

export interface MockRgsConfig {
  balance: number;
  currency: string;
  betLadder: number[];
  defaultBet: number;
}

const money = (n: number): number => Math.round(n * 100) / 100;

function pickJackpotId(): CoinValue {
  const total = JACKPOTS.reduce((sum, j) => sum + j.weight, 0);
  let r = Math.random() * total;
  for (const j of JACKPOTS) if ((r -= j.weight) < 0) return { kind: 'jackpot', id: j.id };
  return { kind: 'jackpot', id: 'mini' };
}

function genCoinValue(): CoinValue {
  if (Math.random() < 0.28) return pickJackpotId();
  return { kind: 'cash', amount: COIN_VALUES[(Math.random() * COIN_VALUES.length) | 0]! };
}

function coinPayout(value: CoinValue, bet: number): number {
  return value.kind === 'cash' ? value.amount * bet : JACKPOT_VALUES[value.id] * bet;
}

function coinCellsOf(grid: string[][]): Array<{ reel: number; cell: number }> {
  const cells: Array<{ reel: number; cell: number }> = [];
  grid.forEach((col, reel) =>
    col.forEach((s, cell) => {
      if (s === COIN) cells.push({ reel, cell });
    }),
  );
  return cells;
}

function genBonus(coinCells: Array<{ reel: number; cell: number }>, bet: number): BonusResult {
  const key = (r: number, c: number): string => `${r}:${c}`;
  const values = new Map<string, CoinValue>();

  const seed: BonusCoin[] = coinCells.map(({ reel, cell }) => {
    const value = genCoinValue();
    values.set(key(reel, cell), value);
    return { reel, cell, value };
  });

  let respins = BONUS_RESPINS;
  const steps: BonusRespin[] = [];
  while (respins > 0 && values.size < REELS * ROWS) {
    const lands: BonusCoin[] = [];
    for (let reel = 0; reel < REELS; reel++) {
      for (let cell = 0; cell < ROWS; cell++) {
        if (values.has(key(reel, cell))) continue;
        if (Math.random() >= COIN_LAND_CHANCE) continue;
        const value = genCoinValue();
        values.set(key(reel, cell), value);
        lands.push({ reel, cell, value });
      }
    }
    respins = lands.length > 0 ? BONUS_RESPINS : respins - 1;
    steps.push({ lands, respinsLeft: respins });
  }

  let win = 0;
  for (const value of values.values()) win += coinPayout(value, bet);
  return { seed, respins: steps, fullBoard: values.size === REELS * ROWS, win: money(win) };
}

export function createMockRgs(config: MockRgsConfig): RgsClient {
  let balance = config.balance;

  const resolve = (grid: string[][], bet: number): Round => {
    balance = money(balance - bet);
    const wins = evaluate(grid);
    const win = money(wins.reduce((sum, w) => sum + w.multiplier * bet, 0));
    balance = money(balance + win);

    let bonus: BonusResult | null = null;
    if (countCoins(grid) >= BONUS_TRIGGER) {
      bonus = genBonus(coinCellsOf(grid), bet);
      balance = money(balance + bonus.win);
    }

    return { grid, wins, win, bonus, balance };
  };

  return {
    authenticate(): Promise<AuthResult> {
      return Promise.resolve({
        balance,
        currency: config.currency,
        betLadder: config.betLadder,
        defaultBet: config.defaultBet,
      });
    },
    play(bet: number): Promise<Round> {
      return Promise.resolve(resolve(randomGrid(), bet));
    },
    playForced(grid: string[][], bet: number): Promise<Round> {
      return Promise.resolve(resolve(grid, bet));
    },
  };
}
