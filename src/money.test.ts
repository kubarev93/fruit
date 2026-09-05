import { describe, it, expect } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it.each([
    [0, '$0.00'],
    [5, '$5.00'],
    [8, '$8.00'],
    [0.1, '$0.10'],
    [0.05, '$0.05'],
    [12.5, '$12.50'],
    [99.99, '$99.99'],
    [1234.5, '$1,234.50'],
    [1000000, '$1,000,000.00'],
  ])('formats %d as %s', (value, expected) => {
    expect(formatMoney(value)).toBe(expected);
  });

  it('always keeps exactly two decimals', () => {
    for (const v of [1, 3.2, 40, 250, 7777.7]) {
      expect(formatMoney(v)).toMatch(/^\$[\d,]+\.\d{2}$/);
    }
  });

  it('rounds to the cent', () => {
    expect(formatMoney(1.009)).toBe('$1.01');
    expect(formatMoney(2.004)).toBe('$2.00');
  });

  it('drops the decimals with decimals: 0 (rollup mode)', () => {
    expect(formatMoney(0, 0)).toBe('$0');
    expect(formatMoney(5, 0)).toBe('$5');
    expect(formatMoney(1234, 0)).toBe('$1,234');
    expect(formatMoney(1000000, 0)).toBe('$1,000,000');
  });
});
