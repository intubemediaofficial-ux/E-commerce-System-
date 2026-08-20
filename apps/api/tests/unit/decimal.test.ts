import { describe, expect, it } from 'vitest';
import { D, isNegative, toNumber, weightedAverageCost, ZERO } from '../../src/lib/decimal';

describe('weightedAverageCost', () => {
  it('blends old and incoming cost by quantity', () => {
    expect(weightedAverageCost(10, 100, 10, 200).toString()).toBe('150');
  });

  it('returns incoming cost when there is no existing stock', () => {
    expect(weightedAverageCost(0, 0, 5, 42.5).toString()).toBe('42.5');
  });

  it('returns incoming cost when quantities cancel out', () => {
    expect(weightedAverageCost(5, 10, -5, 30).toString()).toBe('30');
  });

  it('rounds to four decimal places', () => {
    expect(weightedAverageCost(3, 10, 1, 11).toString()).toBe('10.25');
    expect(weightedAverageCost(7, 13.3333, 5, 19.7777).toString()).toBe('16.0185');
  });
});

describe('decimal helpers', () => {
  it('creates decimals from strings, numbers and decimals', () => {
    expect(D('1.005').plus(D(1)).toString()).toBe('2.005');
    expect(D(D('2.5')).toString()).toBe('2.5');
    expect(ZERO.isZero()).toBe(true);
  });

  it('detects negative values', () => {
    expect(isNegative('-0.0001')).toBe(true);
    expect(isNegative(0)).toBe(false);
  });

  it('converts to number', () => {
    expect(toNumber('12.75')).toBe(12.75);
  });
});
