import type { JackpotId, LineWin } from '../config';

export type CoinValue = { kind: 'cash'; amount: number } | { kind: 'jackpot'; id: JackpotId };

export interface BonusCoin {
  reel: number;
  cell: number;
  value: CoinValue;
}

export interface BonusRespin {
  lands: BonusCoin[];
  respinsLeft: number;
}

export interface BonusResult {
  seed: BonusCoin[];
  respins: BonusRespin[];
  fullBoard: boolean;
  win: number;
}

export interface Round {
  grid: string[][];
  wins: LineWin[];
  win: number;
  bonus: BonusResult | null;
  balance: number;
}

export interface AuthResult {
  balance: number;
  currency: string;
  betLadder: number[];
  defaultBet: number;
}

export interface RgsClient {
  authenticate(): Promise<AuthResult>;
  play(bet: number): Promise<Round>;
  playForced?(grid: string[][], bet: number): Promise<Round>;
}
