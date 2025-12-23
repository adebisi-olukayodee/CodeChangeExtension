import { checkout } from './checkoutController';
import { calculateDiscount } from './calculateDiscount';

describe('checkout', () => {
  it('applies discount', () => {
    expect(checkout(100)).toBe(90);
  });
});


