import { describe, it, expect } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it.each([
    [0, '$0'],
    [5, '$5'],
    [8, '$8'],
    [1000, '$1,000'],
    [1000000, '$1,000,000'],
    [0.1, '$0.10'],
    [0.05, '$0.05'],
    [12.5, '$12.50'],
    [99.99, '$99.99'],
    [1234.5, '$1,234.50'],
  ])('shows cents only when present: %d -> %s', (value, expected) => {
    expect(formatMoney(value)).toBe(expected);
  });

  it('rounds to the cent', () => {
    expect(formatMoney(1.009)).toBe('$1.01');
    expect(formatMoney(2.004)).toBe('$2');
  });

  it('forces whole dollars with decimals: 0 (rollup mode)', () => {
    expect(formatMoney(0, 0)).toBe('$0');
    expect(formatMoney(5, 0)).toBe('$5');
    expect(formatMoney(1234, 0)).toBe('$1,234');
    expect(formatMoney(1000000, 0)).toBe('$1,000,000');
  });

  it('forces two decimals with decimals: 2', () => {
    expect(formatMoney(8, 2)).toBe('$8.00');
    expect(formatMoney(1234.5, 2)).toBe('$1,234.50');
  });
});
