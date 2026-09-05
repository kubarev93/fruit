import { Container, Text } from 'pixi.js';
import { gsap } from 'gsap';
import { formatMoney } from './money';

export interface WinBadge {
  readonly view: Container;
  show(cx: number, cy: number, amount: number, size: number): void;
  clear(): void;
}

export function createWinBadge(): WinBadge {
  const view = new Container();
  view.eventMode = 'none';

  const label = new Text({
    text: '',
    style: {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: 220,
      fontWeight: '900',
      fill: '#ffd24a',
      stroke: { color: '#5a2d00', width: 26, join: 'round' },
      dropShadow: { color: '#000000', alpha: 0.4, blur: 8, distance: 7, angle: Math.PI / 2 },
    },
  });
  label.anchor.set(0.5);
  view.addChild(label);

  const tweens: gsap.core.Tween[] = [];
  let tl: gsap.core.Timeline | null = null;

  function clear(): void {
    tl?.kill();
    tl = null;
    for (const t of tweens) t.kill();
    tweens.length = 0;
    view.visible = false;
  }

  function show(cx: number, cy: number, amount: number, size: number): void {
    clear();
    const target = Math.max(0, amount);

    label.scale.set(1);
    label.text = formatMoney(target);
    const s = (size * 0.8) / label.height;

    view.visible = true;
    view.alpha = 1;
    view.position.set(cx, cy);
    view.scale.set(0);

    const count = { v: 0 };
    label.text = formatMoney(0, 0);

    tl = gsap.timeline({ onComplete: () => (view.visible = false) });
    tl.to(view.scale, { x: s * 1.15, y: s * 1.15, duration: 0.22, ease: 'back.out(3)' });
    tl.to(view.scale, { x: s, y: s, duration: 0.12, ease: 'power2.out' });
    tl.to(
      count,
      {
        v: target,
        duration: Math.min(1.1, 0.3 + target * 0.01),
        ease: 'power1.out',
        onUpdate: () => (label.text = formatMoney(Math.floor(count.v), 0)),
        onComplete: () => (label.text = formatMoney(target)),
      },
      '<',
    );
    tl.to({}, { duration: 0.6 });
    tl.to(view, { y: cy - size * 0.4, alpha: 0, duration: 0.4, ease: 'power1.in' });
  }

  return { view, show, clear };
}
