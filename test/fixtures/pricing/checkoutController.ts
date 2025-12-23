import { calculateDiscount } from './calculateDiscount';

export function checkout(price: number): number {
  const discount = calculateDiscount(price);
  return price - discount;
}


