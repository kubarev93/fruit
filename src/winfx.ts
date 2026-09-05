import { AnimatedSprite, Container, Graphics, Sprite, Text } from 'pixi.js';
import type { Ticker } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameAssets } from './assets';
import type { WinTier } from './config';
import { createBigWinSpine, loadBigWinAssets, type BigWinSpine } from './bigWinSpine';
import { formatMoney } from './money';

export interface WinFx {
  readonly view: Container;
  layout(width: number, height: number): void;
  play(tier: WinTier, amount: number): Promise<void>;
  skip(): void;
}

const GLYPH_H = 150;
const HOLD_MS = 1100;
const BIGWIN_SCALE = 0.32;
const BIGWIN_ROOT_Y = 40;
const BIGWIN_HOLDER_Y = 637.2;

export function createWinFx(assets: GameAssets, ticker?: Ticker): WinFx {
  const view = new Container();
  view.eventMode = 'none';
  view.visible = false;

  const dim = new Graphics();
  view.addChild(dim);

  const group = new Container();
  view.addChild(group);

  const coins = new AnimatedSprite(assets.coins);
  coins.anchor.set(0.5);
  coins.animationSpeed = 0.5;
  coins.loop = false;
  group.addChild(coins);

  const textWrap = new Container();
  const text = new Sprite(assets.winText.big);
  text.anchor.set(0.5);
  textWrap.addChild(text);
  group.addChild(textWrap);

  const spineHolder = new Container();
  group.addChild(spineHolder);

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

  const TIER_INDEX: Record<WinTier, number> = { big: 0, mega: 1, epic: 2, legendary: 3 };

  let screenW = 0;
  let screenH = 0;
  let tl: gsap.core.Timeline | null = null;
  let countTween: gsap.core.Tween | null = null;

  let spine: BigWinSpine | null = null;
  void loadBigWinAssets()
    .then(() => {
      spine = createBigWinSpine(ticker);
      spineHolder.addChild(spine.view);
      layout(screenW, screenH);
    })
    .catch(() => {
      spine = null;
    });

  function layout(width: number, height: number): void {
    screenW = width;
    screenH = height;
    dim.clear();
    dim.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 1 });

    const cx = width / 2;
    const cy = height * 0.44;
    group.position.set(cx, cy);

    const span = Math.min(width, height);
    group.scale.set(span / 760);

    coins.position.set(0, 10);
    coins.width = 820;
    coins.height = coins.width * (assets.coins[0]!.height / assets.coins[0]!.width);
    textWrap.position.set(0, -125);
    text.width = 600;
    text.height = text.width * (text.texture.height / text.texture.width);

    if (spine) {
      const s = BIGWIN_SCALE;
      spine.view.scale.set(s);
      spine.view.position.set(0, BIGWIN_ROOT_Y);
      counter.scale.set(0.72);
      counter.position.set(0, BIGWIN_ROOT_Y + BIGWIN_HOLDER_Y * s);
    } else {
      counter.scale.set(1);
      counter.position.set(0, 150);
    }
  }

  function reset(): void {
    tl?.kill();
    tl = null;
    countTween?.kill();
    countTween = null;
    spine?.skip();
    view.visible = false;
    view.alpha = 1;
    coins.gotoAndStop(0);
  }

  function runCount(target: number, duration: number): void {
    const count = { v: 0 };
    countTween = gsap.to(count, {
      v: target,
      duration,
      ease: 'power1.out',
      onUpdate: () => (counter.text = formatMoney(count.v)),
      onComplete: () => (counter.text = formatMoney(target)),
    });
  }

  async function play(tier: WinTier, amount: number): Promise<void> {
    reset();
    layout(screenW, screenH);

    view.visible = true;
    view.alpha = 1;
    dim.alpha = 0;
    counter.text = formatMoney(0);
    const target = Math.max(0, amount);

    gsap.to(dim, { alpha: 0.62, duration: 0.25 });

    if (spine) {
      coins.visible = false;
      textWrap.visible = false;
      const escalateMs = 1000 + TIER_INDEX[tier] * 1320 + HOLD_MS * 0.6;
      runCount(target, escalateMs / 1000);
      await spine.play(tier, HOLD_MS);
      await new Promise<void>((resolve) => {
        tl = gsap.timeline({ onComplete: resolve });
        tl.to(view, { alpha: 0, duration: 0.3, onComplete: () => (view.visible = false) });
      });
      return;
    }

    coins.visible = true;
    textWrap.visible = true;
    text.texture = tier === 'legendary' ? assets.winText.epic : assets.winText[tier];
    layout(screenW, screenH);
    textWrap.scale.set(0);

    await new Promise<void>((resolve) => {
      tl = gsap.timeline({ onComplete: resolve });
      tl.add(() => coins.gotoAndPlay(0), 0.05);
      tl.fromTo(
        textWrap.scale,
        { x: 0, y: 0 },
        { x: 1, y: 1, duration: 0.5, ease: 'back.out(2)' },
        0.1,
      );
      tl.add(() => runCount(target, Math.min(1.8, 0.6 + target * 0.02)), 0.35);
      if (target >= 25) tl.add(() => coins.gotoAndPlay(0), 1.2);
      tl.to({}, { duration: 0.9 });
      tl.to(view, { alpha: 0, duration: 0.4, onComplete: () => (view.visible = false) });
    });
  }

  function skip(): void {
    spine?.skip();
    tl?.progress(1);
  }

  return { view, layout, play, skip };
}
