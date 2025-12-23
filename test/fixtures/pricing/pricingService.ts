import { calculateDiscount } from './calculateDiscount';

export class PricingService {
  applyDiscount(price: number): number {
    return calculateDiscount(price);
  }
}


