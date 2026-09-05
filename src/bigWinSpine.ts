import { Assets, Container, Ticker } from 'pixi.js';
import { gsap } from 'gsap';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import type { WinTier } from './config';

const BASE = 'assets/win/bigwin';

export const BIGWIN_NATIVE_W = 1439;
export const BIGWIN_NATIVE_H = 1190;

const MIX = 0.25;

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
  play(tier: WinTier, holdMs: number, onHide?: () => void): Promise<void>;
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

  function play(_tier: WinTier, holdMs: number, onHide?: () => void): Promise<void> {
    const st = spine.state;

    st.clearTracks();
    spine.skeleton.setToSetupPose();
    view.visible = true;
    stopTweens();
    spine.alpha = 1;
    spine.scale.set(1);

    // Clean, jump-free presentation: the authored `show` reveals the "BIG WIN!"
    // frame, it holds while the amount counts up, then `hide` takes it out. The
    // per-tier word poses sit at different heights with no smooth transition, so
    // stepping through them read as a jump; the reveal alone is the win moment.
    st.setAnimation(0, 'show', false);
    const hide = st.addAnimation(0, 'hide', false, holdMs / 1000);

    return new Promise<void>((resolve) => {
      resolvePlay = resolve;
      hide.listener = { start: () => onHide?.(), complete: () => finish() };
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
