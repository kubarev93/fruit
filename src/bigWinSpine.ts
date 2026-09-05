import { Assets, Container, Ticker } from 'pixi.js';
import { gsap } from 'gsap';
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
const TIER_HOLD_S = 0.5;

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

  function stopTweens(): void {
    gsap.killTweensOf(spine);
    gsap.killTweensOf(spine.scale);
  }

  function finish(): void {
    stopTweens();
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

    stopTweens();
    spine.alpha = 0;
    spine.scale.set(0.82);
    gsap.to(spine, { alpha: 1, duration: 0.2 });
    gsap.to(spine.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(1.6)' });

    st.setAnimation(0, WIN_ANIM.big, false);
    for (let i = 0; i < targetIdx; i++) {
      st.addAnimation(0, TRANSITION_ANIM[i]!, false, TIER_HOLD_S);
      st.addAnimation(0, WIN_ANIM[TIERS[i + 1]!], false, 0);
    }
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
    stopTweens();
    view.destroy({ children: true });
  }

  return { view, play, skip, destroy };
}
