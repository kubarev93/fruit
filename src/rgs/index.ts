import { createHttpRgs } from './http';
import { createMockRgs } from './mock';
import type { RgsClient } from './types';

export * from './types';

export interface RgsOptions {
  balance: number;
  currency: string;
  betLadder: number[];
  defaultBet: number;
  url?: string;
}

export function createRgs(opts: RgsOptions): RgsClient {
  const url =
    opts.url ??
    (import.meta.env.VITE_RGS_URL as string | undefined) ??
    new URLSearchParams(location.search).get('rgs') ??
    undefined;
  if (url) return createHttpRgs({ baseUrl: url });
  return createMockRgs({
    balance: opts.balance,
    currency: opts.currency,
    betLadder: opts.betLadder,
    defaultBet: opts.defaultBet,
  });
}
