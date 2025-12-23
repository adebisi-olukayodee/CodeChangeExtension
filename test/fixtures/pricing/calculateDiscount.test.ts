import { calculateDiscount } from './calculateDiscount';

describe('calculateDiscount', () => {
  it('calculates 10% discount', () => {
    expect(calculateDiscount(100)).toBe(10);
  });
});


