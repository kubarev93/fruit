import { Assets, Container, Ticker } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';

const BASE = 'assets/bonus/chest';

/** Native width of the chest skeleton (from `skeleton.width` in the JSON). */
export const CHEST_NATIVE_W = 2106;

const IDLE_ANIM = 'idle/coins_step_0_idle';
const HIT_ANIM = 'hit/coins_step_0_hit';
const TRANSITION_ANIM = 'transition/coins_step_0_transition_to_1';

let loadPromise: Promise<void> | null = null;

/**
 * Load the Hold & Win chest Spine (idle / hit / transition skeletons that all
 * share one atlas + page). Idempotent and cached, so it's safe to kick off at
 * board creation and await again on the first bonus.
 */
export function loadChestAssets(): Promise<void> {
  if (!loadPromise) {
    Assets.add({ alias: 'chestAtlas', src: `${BASE}/chest.atlas` });
    Assets.add({ alias: 'chestIdle', src: `${BASE}/chest-idle.json` });
    Assets.add({ alias: 'chestHit', src: `${BASE}/chest-hit.json` });
    Assets.add({ alias: 'chestTransition', src: `${BASE}/chest-transition.json` });
    loadPromise = Assets.load(['chestAtlas', 'chestIdle', 'chestHit', 'chestTransition']).then(
      () => undefined,
    );
  }
  return loadPromise;
}

export interface Chest {
  readonly view: Container;
  /** React to coins landing on the board. */
  playHit(): void;
  /** Play the "pile grows a level" flourish (e.g. on a full board). */
  playTransition(): void;
  destroy(): void;
}

/**
 * Build a chest that idles by default and can play a one-shot reaction.
 *
 * The three states are separate skeletons (one animation each) that share the
 * same atlas and rig, so we stack them and swap which is visible: idle loops
 * underneath, and a reaction hides it for the length of its one-shot before
 * handing visibility back.
 *
 * Requires {@link loadChestAssets} to have resolved.
 */
export function createChest(ticker?: Ticker): Chest {
  const view = new Container();

  const idle = Spine.from({ skeleton: 'chestIdle', atlas: 'chestAtlas', ticker });
  const hit = Spine.from({ skeleton: 'chestHit', atlas: 'chestAtlas', ticker });
  const transition = Spine.from({ skeleton: 'chestTransition', atlas: 'chestAtlas', ticker });
  view.addChild(idle, hit, transition);

  idle.state.setAnimation(0, IDLE_ANIM, true);
  hit.visible = false;
  transition.visible = false;

  let busy = false;
  const oneShot = (sprite: Spine, anim: string): void => {
    if (busy) return;
    busy = true;
    idle.visible = false;
    sprite.visible = true;
    const entry = sprite.state.setAnimation(0, anim, false);
    entry.listener = {
      complete: () => {
        sprite.visible = false;
        idle.visible = true;
        busy = false;
      },
    };
  };

  return {
    view,
    playHit: () => oneShot(hit, HIT_ANIM),
    playTransition: () => oneShot(transition, TRANSITION_ANIM),
    destroy: () => view.destroy({ children: true }),
  };
}
