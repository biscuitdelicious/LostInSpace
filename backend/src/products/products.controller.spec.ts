import { EntityManager } from '@mikro-orm/postgresql';
import { Test, TestingModule } from '@nestjs/testing';
import { Product } from './product.entity';
import { ProductsController } from './products.controller';
import { SEED_PRODUCTS } from './products.seed';
import { ProductsService } from './products.service';

describe('ProductsController & ProductsService', () => {
  let controller: ProductsController;
  let service: ProductsService;
  const created: Array<Omit<Product, 'id'>> = [];
  let countResult = 0;

  const mockFork = {
    count: jest.fn(() => Promise.resolve(countResult)),
    create: jest.fn((_entity: unknown, data: Omit<Product, 'id'>) => {
      created.push(data);
      return data;
    }),
    flush: jest.fn(() => Promise.resolve()),
    find: jest.fn((_entity: unknown, where: Record<string, unknown>) => {
      const all = SEED_PRODUCTS.map((item, idx) => ({ id: idx + 1, ...item }));
      if (!where || Object.keys(where).length === 0) {
        return Promise.resolve(all);
      }
      return Promise.resolve(
        all.filter((p) => p.name.toLowerCase().includes('milk')),
      );
    }),
  };

  const mockEm = {
    fork: jest.fn(() => mockFork),
  };

  beforeEach(async () => {
    created.length = 0;
    countResult = 0;
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        ProductsService,
        { provide: EntityManager, useValue: mockEm },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    service = module.get<ProductsService>(ProductsService);
  });

  it('seeds initial products when the table is empty, without touching the schema', async () => {
    await service.onModuleInit();
    expect(created).toHaveLength(SEED_PRODUCTS.length);
    expect(mockFork.flush).toHaveBeenCalledTimes(1);
  });

  it('returns all products when q is empty and filters when q is provided', async () => {
    const all = await controller.findAll('');
    expect(all.length).toBe(SEED_PRODUCTS.length);

    const filtered = await controller.findAll('milk');
    expect(filtered).toEqual([
      expect.objectContaining({
        name: 'Whole Milk 1L',
        aisleLocation: 'Aisle 7, left, middle shelf',
      }),
    ]);
  });

  it('handles repeated q params (array) using the first value', async () => {
    const result = await controller.findAll(['milk', 'bread']);
    expect(result).toEqual([
      expect.objectContaining({ name: 'Whole Milk 1L' }),
    ]);
  });
});
