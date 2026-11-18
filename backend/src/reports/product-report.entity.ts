import { Entity, Enum, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { Product } from '../products/product.entity';

export const REPORT_KIND = 'moved';
export const REPORT_STATUSES = ['pending', 'confirmed', 'rejected'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * A shopper report that a product was seen on a different shelf.
 * Out-of-stock reports are intentionally not stored: products are not
 * split by brand, so "out of stock" would not say which brand was missing.
 */
@Entity()
export class ProductReport {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => Product)
  product!: Product;

  @Property()
  productName!: string;

  @Enum(() => [REPORT_KIND])
  kind: typeof REPORT_KIND = REPORT_KIND;

  @Enum(() => REPORT_STATUSES)
  status: ReportStatus = 'pending';

  @Property()
  originalAisleLocation!: string;

  @Property()
  originalAisleNumber!: number;

  @Property()
  originalMapX!: number;

  @Property()
  originalMapY!: number;

  @Property()
  reportedAisleLocation!: string;

  @Property()
  reportedAisleNumber!: number;

  @Property()
  reportedMapX!: number;

  @Property()
  reportedMapY!: number;

  @Property()
  createdAt: Date = new Date();
}
