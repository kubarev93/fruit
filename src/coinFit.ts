/**
 * How much of a cell the coin tile fills. The `z.png` artwork is a compact
 * gold box (~0.62×0.65 of its transparent 768² canvas), so drawing it at the
 * cell size leaves it visibly smaller than the fruit symbols, whose art fills
 * ~0.78 of their canvas. Scaling past 1 grows the visible gold box to match
 * them; at 1.22 it lands at ~0.76×0.80 of the cell, in line with the fruits,
 * and the art still clears the cell edges (no bleed into neighbours).
 */
export const COIN_TILE_FILL = 1.22;

/**
 * How much of a cell a jackpot tile (mini/minor/major/grand) fills. Unlike the
 * `z.png` coin art, the jackpot art already fills its whole canvas, so it must
 * NOT use {@link COIN_TILE_FILL} (that would blow it up past the cell). Keep it
 * at the tile art's own footprint.
 */
export const COIN_JACKPOT_FILL = 0.92;

/**
 * The flat inner panel of the gold box (inside the bevel), as a fraction of
 * the drawn tile — the area the value text must stay within. Kept a touch
 * tighter than the measured panel (~0.48×0.50) for breathing room.
 */
export const COIN_TEXT_BOX_W = 0.46;
export const COIN_TEXT_BOX_H = 0.44;

/**
 * Uniform scale that fits a `textW × textH` box inside a `boxW × boxH` box.
 * Height-limited for the usual 1–2 digit values (so digits keep a constant
 * height); width-limited for a 3-digit value like "100", which shrinks to fit.
 */
export function fitScale(textW: number, textH: number, boxW: number, boxH: number): number {
  if (textW <= 0 || textH <= 0) return 1;
  return Math.min(boxW / textW, boxH / textH);
}
