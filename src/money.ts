/**
 * Format a cash amount for win displays, e.g. 1234.5 -> "$1,234.50".
 * Pass `decimals: 0` for the count-up rollup so it shows whole dollars.
 */
export function formatMoney(v: number, decimals = 2): string {
  return '$' + v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
