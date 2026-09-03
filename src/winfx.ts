import { AnimatedSprite, Container, Graphics, Sprite, Text } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameAssets } from './assets';
import type { WinTier } from './config';

export interface WinFx {
  readonly view: Container;
  layout(width: number, height: number): void;
  /** Play the Big/Mega/Epic splash, counting the multiplier up. Resolves when done. */
  play(tier: WinTier, multiplier: number): Promise<void>;
  skip(): void;
}

const GLYPH_H = 150; // design height of the counter digits

export function createWinFx(assets: GameAssets): WinFx {
  const view = new Container();
  view.eventMode = 'none';
  view.visible = false;

  const dim = new Graphics();
  view.addChild(dim);

  // Everything else lives in a centered group we scale/position in layout().
  const group = new Container();
  view.addChild(group);

  const coins = new AnimatedSprite(assets.coins);
  coins.anchor.set(0.5);
  coins.animationSpeed = 0.5;
  coins.loop = false;
  group.addChild(coins);

  // Text sits in a wrapper so the "pop" animates the wrapper's scale while the
  // sprite's own width/height stays fixed to the laid-out size.
  const textWrap = new Container();
  const text = new Sprite(assets.winText.big);
  text.anchor.set(0.5);
  textWrap.addChild(text);
  group.addChild(textWrap);

  // The win multiplier counter is ONE Text object (updated via `.text`) — a
  // single display object like the tier sprite, so it stays put. (An earlier
  // multi-sprite glyph counter drifted under the per-frame count-up updates.)
  const counter = new Text({
    text: '0x',
    style: {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: GLYPH_H,
      fontWeight: '900',
      fill: '#ffffff',
      stroke: { color: '#1b3a6b', width: GLYPH_H * 0.11, join: 'round' },
      dropShadow: { color: '#000000', alpha: 0.35, blur: 4, distance: 4, angle: Math.PI / 2 },
    },
  });
  counter.anchor.set(0.5);
  group.addChild(counter);

  let screenW = 0;
  let screenH = 0;
  const timeline = { tl: null as gsap.core.Timeline | null };

  function renderNumber(str: string): void {
    counter.text = str;
  }

  function layout(width: number, height: number): void {
    screenW = width;
    screenH = height;
    dim.clear();
    dim.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 1 });

    const cx = width / 2;
    const cy = height * 0.44;
    group.position.set(cx, cy);

    const span = Math.min(width, height);
    const s = span / 760; // design span
    group.scale.set(s);

    coins.position.set(0, 10);
    coins.width = 820;
    coins.height = coins.width * (assets.coins[0]!.height / assets.coins[0]!.width);
    textWrap.position.set(0, -125);
    text.width = 600;
    text.height = text.width * (text.texture.height / text.texture.width);
    counter.position.set(0, 75);
  }

  function reset(): void {
    timeline.tl?.kill();
    timeline.tl = null;
    view.visible = false;
    view.alpha = 1;
    coins.gotoAndStop(0);
  }

  async function play(tier: WinTier, multiplier: number): Promise<void> {
    reset();
    text.texture = assets.winText[tier];
    layout(screenW, screenH);

    view.visible = true;
    view.alpha = 1;
    dim.alpha = 0;
    textWrap.scale.set(0); // reset pop
    const target = Math.max(1, Math.round(multiplier));
    renderNumber('0x');

    const count = { v: 0 };
    return new Promise<void>((resolve) => {
      const tl = gsap.timeline({ onComplete: resolve });
      timeline.tl = tl;
      tl.to(dim, { alpha: 0.62, duration: 0.25 }, 0);
      // coin burst
      tl.add(() => coins.gotoAndPlay(0), 0.05);
      // tier text pop
      tl.fromTo(
        textWrap.scale,
        { x: 0, y: 0 },
        { x: 1, y: 1, duration: 0.5, ease: 'back.out(2)' },
        0.1,
      );
      // count the multiplier up
      tl.to(
        count,
        {
          v: target,
          duration: Math.min(1.6, 0.5 + target * 0.02),
          ease: 'power1.out',
          onUpdate: () => renderNumber(`${Math.floor(count.v)}x`),
          onComplete: () => renderNumber(`${target}x`),
        },
        0.35,
      );
      // replay the coin burst once more for longer wins
      if (target >= 25) tl.add(() => coins.gotoAndPlay(0), 1.2);
      tl.to({}, { duration: 0.9 }); // hold
      tl.to(view, { alpha: 0, duration: 0.4, onComplete: () => (view.visible = false) });
    });
  }

  function skip(): void {
    if (timeline.tl) timeline.tl.progress(1);
  }

  return { view, layout, play, skip };
}
