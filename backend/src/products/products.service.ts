import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Product } from './product.entity';
import { SEED_PRODUCTS } from './products.seed';

@Injectable()
export class ProductsService implements OnModuleInit {
  constructor(private readonly em: EntityManager) {}

  async onModuleInit(): Promise<void> {
    // The schema is owned by the migrations (see src/migrations), which
    // run before the app starts. This hook only seeds an empty catalogue.
    const fork = this.em.fork();
    const existingCount = await fork.count(Product);
    if (existingCount === 0) {
      for (const item of SEED_PRODUCTS) {
        fork.create(Product, item);
      }
      await fork.flush();
    }
  }

  async search(query?: string): Promise<Product[]> {
    const fork = this.em.fork();
    const trimmed = query?.trim() ?? '';
    if (!trimmed) {
      return fork.find(
        Product,
        {},
        { orderBy: { aisleNumber: 'ASC', name: 'ASC' } },
      );
    }
    const pattern = `%${trimmed}%`;
    return fork.find(
      Product,
      {
        $or: [
          { name: { $ilike: pattern } },
          { category: { $ilike: pattern } },
          { aisleLocation: { $ilike: pattern } },
        ],
      },
      { orderBy: { aisleNumber: 'ASC', name: 'ASC' } },
    );
  }
}
