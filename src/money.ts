/**
 * Format a cash amount for win displays.
 *
 * Default: no cents on a whole amount, exactly two on a fractional one —
 * `8 -> "$8"`, `12.5 -> "$12.50"`, `1234.5 -> "$1,234.50"`. Pass an explicit
 * `decimals` (e.g. `0` for the count-up rollup) to force that many.
 */
export function formatMoney(v: number, decimals?: number): string {
  const cents = Math.round(v * 100);
  const d = decimals ?? (cents % 100 === 0 ? 0 : 2);
  return '$' + (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}
