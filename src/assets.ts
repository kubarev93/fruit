import { Assets, Texture } from 'pixi.js';
import { SYMBOL_FILES, type SymbolId } from './config';

const BASE = 'assets';

export interface GameAssets {
  symbols: Record<SymbolId, Texture>;
  frame: Texture;
  logo: Texture;
  bgDesk: Texture;
  bgMobile: Texture;
}

async function tex(src: string): Promise<Texture> {
  const t = await Assets.load<Texture>(src);
  t.source.style.scaleMode = 'linear';
  t.source.autoGenerateMipmaps = true;
  t.source.update();
  return t;
}

export async function loadGameAssets(): Promise<GameAssets> {
  const symbolEntries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [SymbolId, string][]).map(
      async ([id, file]) => [id, await tex(`${BASE}/symbols/${file}`)] as const,
    ),
  );
  const symbols = Object.fromEntries(symbolEntries) as Record<SymbolId, Texture>;

  const [frame, logo, bgDesk, bgMobile] = await Promise.all([
    tex(`${BASE}/grid.png`),
    tex(`${BASE}/logo.png`),
    tex(`${BASE}/fon-desk.jpg`),
    tex(`${BASE}/fon-mobila.jpg`),
  ]);

  return { symbols, frame, logo, bgDesk, bgMobile };
}
