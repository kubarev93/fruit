import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ReelSymbol } from 'pixi-reels';

export interface CoconutSymbolOptions {
  texture: Texture;
}

/**
 * The coconut, animated. Unlike the plain SpriteSymbol symbols it carries its
 * own life:
 *
 *   - idle: a slow "breathing" scale, a lazy sway and bob, a highlight that
 *     sweeps across the shell (masked to the coconut's own silhouette so only
 *     the shell lights up), and the odd sparkle. Runs only while the symbol is
 *     sitting still on a landed reel — it is stopped the moment the reel spins
 *     so a moving/blurred symbol isn't fighting a wobble.
 *   - win: the shell CRACKS OPEN. A jagged flash runs down the middle, the two
 *     halves (the same texture, each masked to one side) fly apart with shell
 *     shards and a burst of sparkles, then spring back together so the symbol is
 *     left whole for the next idle. Driven by the spotlight via playWin().
 *
 * All motion happens on an inner `content` container, never on `this.view`:
 * the reel set reads `view.position` back to work out which slot a symbol is
 * in, so the visual is kept one level down where it can be scaled, rotated and
 * nudged freely.
 */
export class CoconutSymbol extends ReelSymbol {
  private readonly content: Container;
  private readonly sprite: Sprite;
  private readonly shine: Sprite;
  private readonly shineMask: Sprite;
  private readonly sparkles: Container;

  // Crack-open rig: two halves of the same texture, a seam flash, a radial
  // burst glow and flying shell shards. Hidden until playWin().
  private readonly crack: Container;
  private readonly leftHalf: Container;
  private readonly rightHalf: Container;
  private readonly leftMask: Graphics;
  private readonly rightMask: Graphics;
  private readonly seam: Sprite;
  private readonly glow: Sprite;
  private readonly shards: Container;

  private w = 0;
  private h = 0;
  private active = false;
  private spinning = false;
  private idle: gsap.core.Timeline[] = [];
  private winTl: gsap.core.Timeline | null = null;

  constructor(opts: CoconutSymbolOptions) {
    super();

    this.content = new Container();
    this.view.addChild(this.content);

    this.sprite = new Sprite(opts.texture);
    this.sprite.anchor.set(0.5);
    this.content.addChild(this.sprite);

    // Silhouette used purely as an alpha mask for the highlight sweep.
    this.shineMask = new Sprite(opts.texture);
    this.shineMask.anchor.set(0.5);
    this.content.addChild(this.shineMask);

    this.shine = new Sprite(shineTexture());
    this.shine.anchor.set(0.5);
    this.shine.rotation = -0.32;
    this.shine.blendMode = 'add';
    this.shine.alpha = 0;
    this.shine.mask = this.shineMask;
    this.content.addChild(this.shine);

    // --- crack rig ---
    this.crack = new Container();
    this.crack.visible = false;
    this.content.addChild(this.crack);

    this.leftHalf = new Container();
    this.rightHalf = new Container();
    this.leftMask = new Graphics();
    this.rightMask = new Graphics();
    for (const [half, mask] of [
      [this.leftHalf, this.leftMask],
      [this.rightHalf, this.rightMask],
    ] as const) {
      const s = new Sprite(opts.texture);
      s.anchor.set(0.5);
      half.addChild(s);
      half.addChild(mask);
      s.mask = mask;
      this.crack.addChild(half);
    }

    this.glow = new Sprite(glowTexture());
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.alpha = 0;
    this.crack.addChild(this.glow);

    this.seam = new Sprite(seamTexture());
    this.seam.anchor.set(0.5);
    this.seam.blendMode = 'add';
    this.seam.alpha = 0;
    this.crack.addChild(this.seam);

    this.shards = new Container();
    this.content.addChild(this.shards);

    this.sparkles = new Container();
    this.content.addChild(this.sparkles);
  }

  protected onActivate(): void {
    this.active = true;
    this.spinning = false;
    this.resetPose();
    this.startIdle();
  }

  protected onDeactivate(): void {
    this.active = false;
    this.stopIdle();
    this.winTl?.kill();
    this.winTl = null;
    this.clearTransients();
    this.resetPose();
  }

  override onReelSpinStart(): void {
    this.spinning = true;
    this.stopIdle();
    this.resetPose();
  }

  override onReelLanded(): void {
    this.spinning = false;
    this.startIdle();
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.content.position.set(width / 2, height / 2);

    const size = Math.min(width, height) * 0.94;
    for (const s of [this.sprite, this.shineMask]) {
      s.width = size;
      s.height = size;
    }
    this.shine.height = size * 1.35;
    this.shine.width = size * 0.5;

    // Size the two halves and (re)cut their masks. A 2px overlap at the seam
    // hides the hairline where the two masks meet when the shell is whole.
    const half = size / 2;
    const ov = 2;
    for (const [c, mask, left] of [
      [this.leftHalf, this.leftMask, true],
      [this.rightHalf, this.rightMask, false],
    ] as const) {
      const s = c.getChildAt(0) as Sprite;
      s.width = size;
      s.height = size;
      mask.clear();
      if (left) mask.rect(-half, -half, half + ov, size).fill(0xffffff);
      else mask.rect(-ov, -half, half + ov, size).fill(0xffffff);
    }

    this.seam.height = size * 1.04;
    this.seam.width = size * 0.2;
    this.glow.width = size * 1.4;
    this.glow.height = size * 1.4;

    if (this.active && !this.spinning) this.startIdle();
  }

  playWin(): Promise<void> {
    this.stopIdle();
    this.winTl?.kill();
    this.resetPose();

    const size = Math.min(this.w, this.h);
    const dx = size * 0.24;
    const dy = size * 0.05;

    return new Promise((resolve) => {
      const tl = this.gsap.timeline({
        onComplete: () => {
          this.winTl = null;
          resolve();
        },
      });
      this.winTl = tl;

      // Swap the whole shell for the two-piece rig.
      tl.set(this.sprite, { visible: false }, 0);
      tl.set(this.crack, { visible: true }, 0);
      tl.set([this.leftHalf, this.rightHalf], { x: 0, y: 0, rotation: 0 }, 0);

      // A short wind-up: the shell tenses before it gives.
      tl.to(this.crack.scale, { x: 1.07, y: 0.9, duration: 0.08, ease: 'power2.out' }, 0)
        .to(this.crack.scale, { x: 1, y: 1, duration: 0.16, ease: 'power1.inOut' }, 0.08);

      const tBreak = 0.16;

      // The jagged seam lights up right at the break.
      tl.set(this.seam, { alpha: 0, scaleY: 0.7 }, tBreak)
        .to(this.seam, { alpha: 1, scaleY: 1, duration: 0.05, ease: 'power2.out' }, tBreak)
        .to(this.seam, { alpha: 0, duration: 0.22, ease: 'power2.in' }, tBreak + 0.05);

      // Radial burst of light behind the halves.
      tl.set(this.glow, { alpha: 0 }, tBreak)
        .set(this.glow.scale, { x: 0.5, y: 0.5 }, tBreak)
        .to(this.glow, { alpha: 0.9, duration: 0.06, ease: 'power2.out' }, tBreak)
        .to(this.glow.scale, { x: 1.3, y: 1.3, duration: 0.4, ease: 'power2.out' }, tBreak)
        .to(this.glow, { alpha: 0, duration: 0.34, ease: 'power2.in' }, tBreak + 0.08);

      // Halves burst apart...
      tl.to(this.leftHalf, { x: -dx, y: dy, rotation: -0.3, duration: 0.17, ease: 'back.out(2.2)' }, tBreak)
        .to(this.rightHalf, { x: dx, y: dy, rotation: 0.3, duration: 0.17, ease: 'back.out(2.2)' }, tBreak);

      // ...hold open, then spring back whole.
      tl.to(this.leftHalf, { x: 0, y: 0, rotation: 0, duration: 0.52, ease: 'elastic.out(1, 0.55)' }, tBreak + 0.34)
        .to(this.rightHalf, { x: 0, y: 0, rotation: 0, duration: 0.52, ease: 'elastic.out(1, 0.55)' }, tBreak + 0.34);

      // Shell shards + a burst of sparkles fly from the seam.
      tl.add(() => {
        for (let i = 0; i < 8; i++) {
          const dir = i < 4 ? -1 : 1;
          this.spawnShard(dir);
        }
        const r = size * 0.42;
        const n = 9;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
          const d = r * (0.35 + Math.random() * 0.5);
          this.spawnSparkle(Math.cos(a) * d, Math.sin(a) * d, 0.5 + Math.random() * 0.5);
        }
      }, tBreak);

      // Restore the whole shell for idle once the halves have rejoined.
      tl.set(this.sprite, { visible: true }, tBreak + 0.34 + 0.5);
      tl.set(this.crack, { visible: false }, tBreak + 0.34 + 0.5);
    });
  }

  stopAnimation(): void {
    this.winTl?.kill();
    this.winTl = null;
    this.clearTransients();
    this.resetPose();
    if (this.active && !this.spinning) this.startIdle();
  }

  protected override onDestroy(): void {
    this.stopIdle();
    this.winTl?.kill();
  }

  private resetPose(): void {
    this.content.scale.set(1, 1);
    this.content.rotation = 0;
    this.content.position.set(this.w / 2, this.h / 2);
    this.shine.alpha = 0;
    this.sprite.visible = true;
    this.crack.visible = false;
    this.crack.scale.set(1, 1);
    this.leftHalf.position.set(0, 0);
    this.leftHalf.rotation = 0;
    this.rightHalf.position.set(0, 0);
    this.rightHalf.rotation = 0;
    this.seam.alpha = 0;
    this.glow.alpha = 0;
  }

  private startIdle(): void {
    if (!this.active || this.spinning || this.isDestroyed) return;
    this.stopIdle();
    const cx = this.w / 2;
    const cy = this.h / 2;

    // Breathing scale + a lazy sway and bob, all on one yoyo timeline.
    const breathe = this.gsap.timeline({ repeat: -1, yoyo: true });
    breathe
      .to(this.content.scale, { x: 1.028, y: 1.028, duration: 1.9, ease: 'sine.inOut' }, 0)
      .to(this.content, { rotation: 0.03, duration: 2.4, ease: 'sine.inOut' }, 0)
      .to(this.content, { y: cy - 7, duration: 1.6, ease: 'sine.inOut' }, 0);
    this.content.position.set(cx, cy);

    // A highlight sweep on a long, idle cadence.
    const shineLoop = this.gsap.timeline({ repeat: -1 });
    shineLoop.add(() => this.sweep(0.65), 1.2).to({}, { duration: 4.6 });

    // The occasional sparkle somewhere on the shell.
    const sparkleLoop = this.gsap.timeline({ repeat: -1, repeatRefresh: true });
    sparkleLoop
      .add(() => {
        const r = Math.min(this.w, this.h) * 0.32;
        const a = Math.random() * Math.PI * 2;
        const d = r * (0.3 + Math.random() * 0.7);
        this.spawnSparkle(Math.cos(a) * d, Math.sin(a) * d, 0.45 + Math.random() * 0.35);
      }, 0)
      .to({}, { duration: 2.4 + Math.random() * 1.8 });

    this.idle = [breathe, shineLoop, sparkleLoop];
  }

  private stopIdle(): void {
    for (const tl of this.idle) tl.kill();
    this.idle = [];
  }

  /** Run one highlight streak across the shell. */
  private sweep(peak: number): void {
    const reach = Math.min(this.w, this.h) * 0.62;
    this.gsap.killTweensOf(this.shine);
    this.gsap.killTweensOf(this.shine.position);
    this.shine.position.set(-reach, 0);
    this.shine.alpha = 0;
    this.gsap.to(this.shine.position, { x: reach, duration: 0.85, ease: 'sine.in' });
    this.gsap
      .timeline()
      .to(this.shine, { alpha: peak, duration: 0.3, ease: 'sine.out' })
      .to(this.shine, { alpha: 0, duration: 0.4, ease: 'sine.in' });
  }

  private spawnSparkle(x: number, y: number, size: number): void {
    const s = new Sprite(sparkleTexture());
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.rotation = Math.random() * Math.PI;
    s.blendMode = 'add';
    s.scale.set(0);
    s.alpha = 1;
    this.sparkles.addChild(s);

    const full = Math.min(this.w, this.h) * 0.18 * size;
    this.gsap
      .timeline({ onComplete: () => s.destroy() })
      .to(s.scale, { x: full / s.texture.width, y: full / s.texture.width, duration: 0.22, ease: 'back.out(2)' }, 0)
      .to(s, { rotation: s.rotation + 0.9, duration: 0.5, ease: 'none' }, 0)
      .to(s.scale, { x: 0, y: 0, duration: 0.28, ease: 'power2.in' }, 0.22)
      .to(s, { alpha: 0, duration: 0.28, ease: 'power2.in' }, 0.22);
  }

  /** A shell chip flung from the seam: out and up, then falling under gravity. */
  private spawnShard(dir: -1 | 1): void {
    const s = new Sprite(shardTexture());
    s.anchor.set(0.5);
    const size = Math.min(this.w, this.h);
    const chip = size * (0.06 + Math.random() * 0.05);
    s.width = chip;
    s.height = chip * (0.7 + Math.random() * 0.5);
    s.position.set(dir * size * 0.04, 0);
    s.rotation = Math.random() * Math.PI;
    this.shards.addChild(s);

    const outX = dir * size * (0.22 + Math.random() * 0.22);
    const peakY = -size * (0.12 + Math.random() * 0.12);
    const fallY = size * (0.28 + Math.random() * 0.2);

    this.gsap
      .timeline({ onComplete: () => s.destroy() })
      .to(s, { x: outX, duration: 0.55, ease: 'power1.out' }, 0)
      .to(s, { y: peakY, duration: 0.2, ease: 'power2.out' }, 0)
      .to(s, { y: fallY, duration: 0.4, ease: 'power2.in' }, 0.2)
      .to(s, { rotation: s.rotation + dir * (2 + Math.random() * 2), duration: 0.6, ease: 'none' }, 0)
      .to(s, { alpha: 0, duration: 0.22, ease: 'power2.in' }, 0.38);
  }

  private clearTransients(): void {
    for (const layer of [this.sparkles, this.shards]) {
      this.gsap.killTweensOf(layer.children);
      layer.removeChildren().forEach((c) => c.destroy());
    }
  }
}

let shineTex: Texture | null = null;
let sparkleTex: Texture | null = null;
let shardTex: Texture | null = null;
let seamTex: Texture | null = null;
let glowTex: Texture | null = null;

/** A soft vertical light band (horizontal alpha bell) — swept for the shine. */
function shineTexture(): Texture {
  if (shineTex) return shineTex;
  const w = 128;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.58, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  shineTex = Texture.from(c);
  return shineTex;
}

/** A 4-point glint: a radial core plus two soft spikes. */
function sparkleTexture(): Texture {
  if (sparkleTex) return sparkleTex;
  const s = 128;
  const cx = s / 2;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;

  const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, s * 0.28);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.5, 'rgba(255,248,220,0.6)');
  core.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, s, s);

  ctx.globalCompositeOperation = 'lighter';
  const spike = (horizontal: boolean) => {
    const g = horizontal
      ? ctx.createLinearGradient(0, cx, s, cx)
      : ctx.createLinearGradient(cx, 0, cx, s);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    const thin = s * 0.05;
    if (horizontal) ctx.fillRect(0, cx - thin / 2, s, thin);
    else ctx.fillRect(cx - thin / 2, 0, thin, s);
  };
  spike(true);
  spike(false);

  sparkleTex = Texture.from(c);
  return sparkleTex;
}

/** An irregular brown shell chip with a lit top edge. */
function shardTexture(): Texture {
  if (shardTex) return shardTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  const pts = [
    [10, 20],
    [34, 8],
    [56, 22],
    [50, 46],
    [24, 56],
    [8, 40],
  ];
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#7a4522');
  g.addColorStop(1, '#3d1f0e');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(210,150,90,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  shardTex = Texture.from(c);
  return shardTex;
}

/** A jagged vertical crack line (additive) flashed on the break. */
function seamTexture(): Texture {
  if (seamTex) return seamTex;
  const w = 64;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const mid = w / 2;
  const steps = 9;
  ctx.beginPath();
  ctx.moveTo(mid, 0);
  for (let i = 1; i <= steps; i++) {
    const y = (h / steps) * i;
    const jitter = (i % 2 === 0 ? 1 : -1) * (6 + Math.random() * 8);
    ctx.lineTo(mid + jitter, y);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,240,200,1)';
  ctx.shadowBlur = 10;
  ctx.stroke();
  seamTex = Texture.from(c);
  return seamTex;
}

/** A soft round white glow (additive) for the burst behind the halves. */
function glowTexture(): Texture {
  if (glowTex) return glowTex;
  const s = 256;
  const cx = s / 2;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0, 'rgba(255,250,230,0.95)');
  g.addColorStop(0.35, 'rgba(255,240,200,0.5)');
  g.addColorStop(1, 'rgba(255,230,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  glowTex = Texture.from(c);
  return glowTex;
}
