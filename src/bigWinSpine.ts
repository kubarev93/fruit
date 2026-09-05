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

const MIX = 0.16;

let loadPromise: Promise<void> | null = null;

export function loadBigWinAssets(): Promise<void> {
  if (!loadPromise) {
    Assets.add({ alias: 'bigwinAtlas', src: `${BASE}/bigwin.atlas` });
    Assets.add({ alias: 'bigwinSkel', src: `${BASE}/bigwin.json` });
    loadPromise = Assets.load(['bigwinAtlas', 'bigwinSkel']).then(() => undefined);
  }
  return loadPromise;
}

export interface BigWinSpine {
  readonly view: Container;
  play(tier: WinTier, holdMs: number): Promise<void>;
  skip(): void;
  destroy(): void;
}

export function createBigWinSpine(ticker?: Ticker): BigWinSpine {
  const view = new Container();
  view.visible = false;

  const spine = Spine.from({ skeleton: 'bigwinSkel', atlas: 'bigwinAtlas', ticker });
  view.addChild(spine);
  spine.state.data.defaultMix = MIX;

  let resolvePlay: (() => void) | null = null;

  function finish(): void {
    view.visible = false;
    const r = resolvePlay;
    resolvePlay = null;
    r?.();
  }

  function play(tier: WinTier, holdMs: number): Promise<void> {
    const targetIdx = Math.max(0, TIERS.indexOf(tier));
    const st = spine.state;

    st.clearTracks();
    spine.skeleton.setToSetupPose();
    view.visible = true;

    st.setAnimation(0, 'show', false);
    for (let i = 0; i < targetIdx; i++) st.addAnimation(0, TRANSITION_ANIM[i]!, false, 0);
    st.addAnimation(0, WIN_ANIM[tier], false, 0);
    const hide = st.addAnimation(0, 'hide', false, holdMs / 1000);

    return new Promise<void>((resolve) => {
      resolvePlay = resolve;
      hide.listener = { complete: () => finish() };
    });
  }

  function skip(): void {
    spine.state.clearTracks();
    finish();
  }

  function destroy(): void {
    view.destroy({ children: true });
  }

  return { view, play, skip, destroy };
}
