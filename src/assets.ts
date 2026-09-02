import { Assets, Rectangle, Spritesheet, Texture } from 'pixi.js';
import { SYMBOL_FILES, type SymbolId } from './config';

const BASE = 'assets';

export interface GameAssets {
  symbols: Record<SymbolId, Texture>;
  frame: Texture;
  logo: Texture;
  bgDesk: Texture;
  bgMobile: Texture;
  /** Animated gold "burning frame" placed on winning cells (29 frames). */
  winFrame: Texture[];
  /** Animated golden glow frame (19 frames) — highlights Wild symbols. */
  bonusFrame: Texture[];
  /** Coin-burst animation frames. */
  coins: Texture[];
  /** Tier splash art. */
  winText: { big: Texture; mega: Texture; epic: Texture };
  /** Digit glyphs '0'..'9' and 'x' for rendering the win amount. */
  numbers: Record<string, Texture>;
  /** Jackpot tile art shown on money symbols. */
  jackpots: Record<'mini' | 'minor' | 'major' | 'grand', Texture>;
}

async function tex(src: string): Promise<Texture> {
  const t = await Assets.load<Texture>(src);
  t.source.style.scaleMode = 'linear';
  t.source.autoGenerateMipmaps = true;
  t.source.update();
  return t;
}

/** Parse a TexturePacker/Pixi spritesheet (JSON + image alongside it). */
async function loadSheet(jsonUrl: string): Promise<Spritesheet> {
  const data = await (await fetch(jsonUrl)).json();
  const dir = jsonUrl.slice(0, jsonUrl.lastIndexOf('/') + 1);
  const image = await tex(dir + data.meta.image);
  const sheet = new Spritesheet(image, data);
  await sheet.parse();
  return sheet;
}

/** Slice a uniform R×C grid sheet (the sprite-editor export) into frame textures. */
async function loadGridFrames(
  src: string,
  cols: number,
  cellW: number,
  cellH: number,
  count: number,
): Promise<Texture[]> {
  const base = await tex(src);
  const source = base.source;
  const frames: Texture[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    frames.push(new Texture({ source, frame: new Rectangle(x, y, cellW, cellH) }));
  }
  return frames;
}

export async function loadGameAssets(): Promise<GameAssets> {
  const symbolEntries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [SymbolId, string][]).map(
      async ([id, file]) => [id, await tex(`${BASE}/symbols/${file}`)] as const,
    ),
  );
  const symbols = Object.fromEntries(symbolEntries) as Record<SymbolId, Texture>;

  const [
    frame,
    logo,
    bgDesk,
    bgMobile,
    winFrame,
    coinsSheet,
    textSheet,
    numbersSheet,
    bonusSheet,
    mini,
    minor,
    major,
    grand,
  ] = await Promise.all([
    tex(`${BASE}/grid.png`),
    tex(`${BASE}/logo.png`),
    tex(`${BASE}/fon-desk.jpg`),
    tex(`${BASE}/fon-mobila.jpg`),
    loadGridFrames(`${BASE}/win/win-frame.webp`, 4, 216, 212, 29),
    loadSheet(`${BASE}/win/win-moneti.json`),
    loadSheet(`${BASE}/win/win-text.json`),
    loadSheet(`${BASE}/numbers/numbers.json`),
    loadSheet(`${BASE}/win/bonus-frame.json`),
    tex(`${BASE}/mini.png`),
    tex(`${BASE}/minor.png`),
    tex(`${BASE}/major.png`),
    tex(`${BASE}/grand.png`),
  ]);
  const jackpots = { mini, minor, major, grand };

  const coins = coinsSheet.animations['win-moneti'] as Texture[];
  const bonusFrame = bonusSheet.animations['bonus-frame'] as Texture[];
  const winText = {
    big: textSheet.textures['bigwin/bigwin_lv1']!,
    mega: textSheet.textures['bigwin/bigwin_lv2']!,
    epic: textSheet.textures['bigwin/bigwin_lv3']!,
  };
  const numbers: Record<string, Texture> = {};
  for (const ch of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'x']) {
    const t = numbersSheet.textures[ch];
    if (t) numbers[ch] = t;
  }

  return {
    symbols,
    frame,
    logo,
    bgDesk,
    bgMobile,
    winFrame,
    bonusFrame,
    coins,
    winText,
    numbers,
    jackpots,
  };
}
