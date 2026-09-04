import { Assets, Container, Ticker } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import type { WinTier } from './config';

const BASE = 'assets/win/bigwin';

export const BIGWIN_NATIVE_W = 1439;
export const BIGWIN_NATIVE_H = 1190;

const TIERS: WinTier[] = ['big', 'mega', 'epic', 'legendary'];

const WIN_ANIM: Record<WinTier, string> = {
  big: 'big_win',
  mega: 'mega_win',
  epic: 'epic_win',
  legendary: 'legendary_win',
};

const TRANSITION_ANIM = ['big_to_mega', 'mega_to_epic', 'epic_to_legendary'];

const SKELETONS = [
  'show',
  'hide',
  'big_win',
  'mega_win',
  'epic_win',
  'legendary_win',
  'big_to_mega',
  'mega_to_epic',
  'epic_to_legendary',
];

const ESCALATE_GAP_MS = 320;

let loadPromise: Promise<void> | null = null;

export function loadBigWinAssets(): Promise<void> {
  if (!loadPromise) {
    Assets.add({ alias: 'bigwinAtlas', src: `${BASE}/bigwin.atlas` });
    for (const s of SKELETONS) Assets.add({ alias: `bigwin_${s}`, src: `${BASE}/${s}.json` });
    loadPromise = Assets.load(['bigwinAtlas', ...SKELETONS.map((s) => `bigwin_${s}`)]).then(
      () => undefined,
    );
  }
  return loadPromise;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface BigWinSpine {
  readonly view: Container;
  play(tier: WinTier, holdMs: number): Promise<void>;
  skip(): void;
  destroy(): void;
}

export function createBigWinSpine(ticker?: Ticker): BigWinSpine {
  const view = new Container();
  view.visible = false;
  const cache = new Map<string, Spine>();
  let aborted = false;
  let resolveStep: (() => void) | null = null;

  const get = (key: string): Spine => {
    let sp = cache.get(key);
    if (!sp) {
      sp = Spine.from({ skeleton: `bigwin_${key}`, atlas: 'bigwinAtlas', ticker });
      sp.visible = false;
      view.addChild(sp);
      cache.set(key, sp);
    }
    return sp;
  };

  const show = (key: string): Spine => {
    const target = get(key);
    for (const [k, sp] of cache) sp.visible = k === key;
    return target;
  };

  const playOnce = (key: string): Promise<void> =>
    new Promise((resolve) => {
      const sp = show(key);
      resolveStep = resolve;
      const entry = sp.state.setAnimation(0, key, false);
      entry.listener = {
        complete: () => {
          resolveStep = null;
          resolve();
        },
      };
    });

  const pose = (key: string): void => {
    const sp = show(key);
    sp.state.setAnimation(0, key, false);
  };

  const finish = (): void => {
    view.visible = false;
    for (const sp of cache.values()) sp.visible = false;
  };

  async function play(tier: WinTier, holdMs: number): Promise<void> {
    aborted = false;
    view.visible = true;
    const targetIdx = Math.max(0, TIERS.indexOf(tier));

    await playOnce('show');
    if (aborted) return finish();
    pose('big_win');

    for (let i = 0; i < targetIdx; i++) {
      await wait(ESCALATE_GAP_MS);
      if (aborted) return finish();
      await playOnce(TRANSITION_ANIM[i]!);
      if (aborted) return finish();
      pose(WIN_ANIM[TIERS[i + 1]!]);
    }

    await wait(holdMs);
    if (aborted) return finish();

    await playOnce('hide');
    finish();
  }

  function skip(): void {
    aborted = true;
    resolveStep?.();
    resolveStep = null;
  }

  function destroy(): void {
    view.destroy({ children: true });
    cache.clear();
  }

  return { view, play, skip, destroy };
}
