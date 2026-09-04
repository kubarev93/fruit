import { Container, Sprite, Text, Texture } from 'pixi.js';
import { ReelSymbol } from 'pixi-reels';
import { COIN_VALUES, JACKPOTS } from './config';
import { COIN_TILE_FILL, COIN_JACKPOT_FILL, COIN_TEXT_BOX_W, COIN_TEXT_BOX_H, fitScale } from './coinFit';

type JackpotId = 'mini' | 'minor' | 'major' | 'grand';

export interface CoinSymbolOptions {
  tile: Texture;
  jackpots: Record<JackpotId, Texture>;
}

const JACKPOT_IDS: JackpotId[] = ['mini', 'minor', 'major', 'grand'];

/**
 * Base font size the value is rasterised at. The glyphs are then scaled to fit
 * the inner panel, so this is only a quality ceiling: high enough that the
 * common 1–2 digit values scale DOWN (crisp) rather than up.
 */
const CASH_FONT_SIZE = 420;

export class CoinSymbol extends ReelSymbol {
  private readonly tile: Sprite;
  private readonly jackpotSprites: Record<JackpotId, Sprite>;
  private readonly cashText: Text;
  private w = 0;
  private h = 0;

  constructor(opts: CoinSymbolOptions) {
    super();

    this.tile = new Sprite(opts.tile);
    this.tile.anchor.set(0.5);
    this.view.addChild(this.tile);

    const content = new Container();
    this.view.addChild(content);

    this.jackpotSprites = {} as Record<JackpotId, Sprite>;
    for (const id of JACKPOT_IDS) {
      const s = new Sprite(opts.jackpots[id]);
      s.anchor.set(0.5);
      s.visible = false;
      content.addChild(s);
      this.jackpotSprites[id] = s;
    }

    this.cashText = new Text({
      text: '',
      style: {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: CASH_FONT_SIZE,
        fontWeight: '900',
        fill: '#ffffff',
        stroke: { color: '#7a3d00', width: 40, join: 'round' },
      },
    });
    this.cashText.anchor.set(0.5);
    this.cashText.visible = false;
    content.addChild(this.cashText);
  }

  protected onActivate(): void {
    this.roll();
    this.layout();
  }

  protected onDeactivate(): void {
    for (const id of JACKPOT_IDS) this.jackpotSprites[id].visible = false;
    this.cashText.visible = false;
  }

  private roll(): void {
    for (const id of JACKPOT_IDS) this.jackpotSprites[id].visible = false;
    this.cashText.visible = false;
    if (Math.random() < 0.28) {
      this.jackpotSprites[this.pickJackpot()].visible = true;
    } else {
      this.cashText.text = `${COIN_VALUES[(Math.random() * COIN_VALUES.length) | 0]!}`;
      this.cashText.visible = true;
    }
  }

  private pickJackpot(): JackpotId {
    const total = JACKPOTS.reduce((sum, j) => sum + j.weight, 0);
    let r = Math.random() * total;
    for (const j of JACKPOTS) if ((r -= j.weight) < 0) return j.id;
    return 'mini';
  }

  private layout(): void {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const tileW = this.w * COIN_TILE_FILL;
    const tileH = this.h * COIN_TILE_FILL;
    this.tile.position.set(cx, cy);
    this.tile.width = tileW;
    this.tile.height = tileH;
    const jackW = this.w * COIN_JACKPOT_FILL;
    const jackH = this.h * COIN_JACKPOT_FILL;
    for (const id of JACKPOT_IDS) {
      const s = this.jackpotSprites[id];
      s.position.set(cx, cy);
      s.width = jackW;
      s.height = jackH;
    }
    this.cashText.position.set(cx, cy);
    this.fitCashText(tileW, tileH);
  }

  /** Scale the value so any 1–3 digit number sits inside the coin's inner panel. */
  private fitCashText(tileW: number, tileH: number): void {
    this.cashText.scale.set(1);
    const s = fitScale(
      this.cashText.width,
      this.cashText.height,
      tileW * COIN_TEXT_BOX_W,
      tileH * COIN_TEXT_BOX_H,
    );
    this.cashText.scale.set(s);
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.layout();
  }

  playWin(): Promise<void> {
    return new Promise((resolve) => {
      this.gsap.to(this.view.scale, {
        x: 1.12,
        y: 1.12,
        duration: 0.15,
        yoyo: true,
        repeat: 1,
        ease: 'power2.inOut',
        onComplete: () => resolve(),
      });
    });
  }

  stopAnimation(): void {
    this.gsap.killTweensOf(this.view.scale);
    this.view.scale.set(1, 1);
  }
}
