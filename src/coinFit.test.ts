import { describe, it, expect } from 'vitest';
import { fitScale } from './coinFit';

describe('fitScale', () => {
  it('fills the box exactly when the text matches one dimension', () => {
    expect(fitScale(100, 50, 200, 200)).toBe(2);
    expect(fitScale(50, 100, 200, 200)).toBe(2);
  });

  it('is limited by height for a narrow (few-digit) value', () => {
    const box = 400;
    const oneDigit = fitScale(140, 300, box, box);
    expect(oneDigit).toBeCloseTo(box / 300);
  });

  it('is limited by width for a wide (3-digit) value, so it shrinks to fit', () => {
    const box = 400;
    const threeDigit = fitScale(800, 320, box, box);
    expect(threeDigit).toBeCloseTo(box / 800);
    expect(threeDigit).toBeLessThan(1);
  });

  it('keeps digit height constant until width forces a shrink', () => {
    const boxW = 431;
    const boxH = 412;
    const textH = 360;
    const two = fitScale(360, textH, boxW, boxH);
    const three = fitScale(760, textH, boxW, boxH);
    expect(two).toBeCloseTo(boxH / textH);
    expect(three).toBeCloseTo(boxW / 760);
    expect(three).toBeLessThan(two);
  });

  it('never produces a non-finite scale for empty/degenerate text', () => {
    expect(fitScale(0, 0, 200, 200)).toBe(1);
    expect(fitScale(0, 100, 200, 200)).toBe(1);
    expect(fitScale(100, 0, 200, 200)).toBe(1);
  });
});
