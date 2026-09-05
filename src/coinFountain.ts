import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { gsap } from 'gsap';

export interface Point {
  x: number;
  y: number;
}

export interface CoinFountain {
  readonly view: Container;
  burst(origins: Point[], board: number): void;
  clear(): void;
}

function starPoly(outer: number, inner: number, points = 5): number[] {
  const pts: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return pts;
}

function drawCoin(g: Graphics, R: number): void {
  g.circle(0, 0, R).fill(0x6b4410);
  g.circle(0, 0, R * 0.9).fill(0xe0930f);
  g.circle(0, 0, R * 0.72).fill(0xffc63a);
  g.circle(0, 0, R * 0.72).stroke({ width: R * 0.06, color: 0xb9720a });
  g.poly(starPoly(R * 0.44, R * 0.19)).fill(0xe89a12);
  g.ellipse(-R * 0.28, -R * 0.34, R * 0.26, R * 0.14).fill({ color: 0xffffff, alpha: 0.5 });
}

function drawSpark(g: Graphics, R: number): void {
  g.poly(starPoly(R, R * 0.34, 4)).fill(0xfff3c4);
  g.circle(0, 0, R * 0.16).fill(0xffffff);
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export function createCoinFountain(renderer: Renderer): CoinFountain {
  const view = new Container();
  view.eventMode = 'none';

  const COIN_R = 80;
  const cg = new Graphics();
  drawCoin(cg, COIN_R);
  const coinTex: Texture = renderer.generateTexture(cg);
  cg.destroy();
  const coinPx = coinTex.width;

  const SPARK_R = 40;
  const sg = new Graphics();
  drawSpark(sg, SPARK_R);
  const sparkTex: Texture = renderer.generateTexture(sg);
  sg.destroy();
  const sparkPx = sparkTex.width;

  const tweens: gsap.core.Tween[] = [];

  function track(t: gsap.core.Tween): gsap.core.Tween {
    tweens.push(t);
    t.eventCallback('onComplete', () => {
      const i = tweens.indexOf(t);
      if (i >= 0) tweens.splice(i, 1);
    });
    return t;
  }

  function spawnCoin(cx: number, cy: number, board: number): void {
    const coin = new Sprite(coinTex);
    coin.anchor.set(0.5);
    const size = (board * rnd(0.06, 0.1)) / coinPx;
    coin.position.set(cx + rnd(-0.03, 0.03) * board, cy + rnd(-0.03, 0.03) * board);
    coin.scale.set(0);
    view.addChild(coin);

    const grav = 3.6 * board;
    const delay = rnd(0, 0.12);
    const angle = -Math.PI / 2 + rnd(-1, 1) * 1.4;
    const speed = rnd(0.8, 1.5) * board;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const dur = rnd(1.0, 1.5);
    const state = { t: 0 };

    track(
      gsap.to(coin.scale, {
        x: size,
        y: size,
        duration: 0.13,
        delay,
        ease: 'back.out(2.5)',
        onComplete: () => spin(coin, size),
      }),
    );
    track(
      gsap.to(state, {
        t: dur,
        duration: dur,
        delay,
        ease: 'none',
        onUpdate: () => {
          coin.x = cx + vx * state.t;
          coin.y = cy + vy * state.t + 0.5 * grav * state.t * state.t;
        },
      }),
    );
    track(
      gsap.to(coin, {
        alpha: 0,
        duration: 0.28,
        delay: delay + dur - 0.28,
        ease: 'power1.in',
        onComplete: () => coin.destroy(),
      }),
    );
  }

  function spawnSpark(cx: number, cy: number, board: number): void {
    const s = new Sprite(sparkTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    const size = (board * rnd(0.03, 0.06)) / sparkPx;
    s.position.set(cx + rnd(-0.12, 0.12) * board, cy + rnd(-0.12, 0.12) * board);
    s.scale.set(0);
    s.rotation = rnd(0, Math.PI);
    view.addChild(s);
    const tl = gsap.timeline({ delay: rnd(0, 0.5) });
    tl.to(s.scale, { x: size, y: size, duration: 0.16, ease: 'back.out(3)' });
    tl.to(s.scale, { x: 0, y: 0, duration: 0.3, ease: 'power1.in', onComplete: () => s.destroy() });
    track(tl as unknown as gsap.core.Tween);
  }

  function burst(origins: Point[], board: number): void {
    if (origins.length === 0) return;
    const perOrigin = Math.max(6, Math.round(24 / origins.length));
    for (const o of origins) {
      for (let i = 0; i < perOrigin; i++) spawnCoin(o.x, o.y, board);
      for (let i = 0; i < 4; i++) spawnSpark(o.x, o.y, board);
    }
  }

  function spin(coin: Sprite, size: number): void {
    track(
      gsap.to(coin.scale, {
        x: -size,
        duration: rnd(0.24, 0.4),
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      }),
    );
    track(gsap.to(coin, { rotation: rnd(-0.6, 0.6), duration: 1, ease: 'sine.inOut' }));
  }

  function clear(): void {
    for (const t of tweens) t.kill();
    tweens.length = 0;
    view.removeChildren().forEach((c) => c.destroy());
  }

  return { view, burst, clear };
}
