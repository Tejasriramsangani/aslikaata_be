import { describe, it, expect } from 'vitest';
import { WeightUtil } from '../src/common/utils/weight.util.js';

describe('WeightUtil', () => {
  it('should calculate net weight correctly when wastage is valid', () => {
    // 5000g gross - 200g wastage = 4800g net
    const net = WeightUtil.calculateNetWeight(5000, 200);
    expect(net).toBe(4800);
  });

  it('should calculate net weight when wastage is 0', () => {
    const net = WeightUtil.calculateNetWeight(3000, 0);
    expect(net).toBe(3000);
  });

  it('should throw an error if gross weight is zero or negative', () => {
    expect(() => WeightUtil.calculateNetWeight(0, 0)).toThrow('Gross weight must be a positive integer');
    expect(() => WeightUtil.calculateNetWeight(-500, 0)).toThrow('Gross weight must be a positive integer');
  });

  it('should throw an error if wastage is negative', () => {
    expect(() => WeightUtil.calculateNetWeight(1000, -50)).toThrow('Wastage weight must be a non-negative integer');
  });

  it('should throw an error if wastage equals gross weight (non-negotiable Rule 5.2)', () => {
    expect(() => WeightUtil.calculateNetWeight(1000, 1000)).toThrow(
      'Wastage (1000g) must be strictly less than gross weight (1000g)',
    );
  });

  it('should throw an error if wastage exceeds gross weight', () => {
    expect(() => WeightUtil.calculateNetWeight(1000, 1200)).toThrow(
      'Wastage (1200g) must be strictly less than gross weight (1000g)',
    );
  });
});
