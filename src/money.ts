/** Format a cash amount for win displays, e.g. 1234.5 -> "$1,234.50". */
export function formatMoney(v: number): string {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
