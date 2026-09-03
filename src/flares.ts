import { Container, Sprite, Texture } from 'pixi.js';
import { gsap } from 'gsap';

export interface Flares {
  readonly view: Container;
  layout(width: number, height: number): void;
}

/** Subtle animated lens-flare + glitter drifting over the sky background. */
export function createFlares(assets: { vfx1: Texture; vfx2: Texture; glitter: Texture[] }): Flares {
  const view = new Container();
  view.eventMode = 'none';
  view.alpha = 0.4; // subtle — a gentle enhancement, not a spotlight

  // A soft light glow near the sun (kept faint; the twinkles carry the effect).
  const flare = new Sprite(assets.vfx1);
  flare.anchor.set(0.5);
  flare.blendMode = 'add';
  flare.alpha = 0.35;
  view.addChild(flare);
  gsap.to(flare, { alpha: 0.5, duration: 4.2, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  gsap.to(flare.scale, { x: 1.06, y: 1.06, duration: 5.2, yoyo: true, repeat: -1, ease: 'sine.inOut' });

  // Glitter twinkles scattered across the upper sky. [x%, y%, size-factor]
  const spots: Array<[number, number, number]> = [
    [0.16, 0.12, 0.55],
    [0.48, 0.07, 0.42],
    [0.82, 0.16, 0.6],
    [0.31, 0.22, 0.36],
    [0.68, 0.27, 0.46],
    [0.9, 0.09, 0.4],
  ];
  const twinkles: Sprite[] = spots.map(([, , ], i) => {
    const s = new Sprite(assets.glitter[i % assets.glitter.length]!);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.alpha = 0;
    view.addChild(s);
    gsap.to(s, {
      alpha: 0.9,
      duration: 1.2 + Math.random(),
      delay: Math.random() * 3,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
    });
    gsap.to(s.scale, {
      x: 1.35,
      y: 1.35,
      duration: 2 + Math.random(),
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
    });
    return s;
  });

  function layout(width: number, height: number): void {
    const span = Math.min(width, height);
    flare.position.set(width * 0.72, height * 0.15);
    flare.width = span * 0.95;
    flare.height = flare.width * (assets.vfx1.height / assets.vfx1.width);
    spots.forEach(([px, py, sc], i) => {
      const s = twinkles[i]!;
      s.position.set(width * px, height * py);
      s.width = span * 0.13 * sc;
      s.height = s.width * (s.texture.height / s.texture.width);
    });
  }

  return { view, layout };
}
