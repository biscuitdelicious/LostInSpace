import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { StaffAuthGuard } from '../auth/staff-auth.guard';
import { Product } from '../products/product.entity';
import { LocationReportsController } from './location-reports.controller';
import { LocationReportsService } from './location-reports.service';
import { ProductReport } from './product-report.entity';

describe('LocationReports', () => {
  const milk: Product = {
    id: 1,
    name: 'Whole Milk 1L',
    category: 'Dairy & Eggs',
    aisleLocation: 'Aisle 7, left, middle shelf',
    aisleNumber: 7,
    mapX: 525,
    mapY: 138,
  };
  const products = [milk];
  const reports: ProductReport[] = [];
  let nextId = 10;

  const fork = {
    findOne: jest.fn((entity: unknown, where: { id?: number }) => {
      const rows = entity === Product ? products : reports;
      return Promise.resolve(rows.find((row) => row.id === where.id) ?? null);
    }),
    find: jest.fn((_entity: unknown, where: { status?: string }) => {
      const matched = reports.filter(
        (report) => !where.status || report.status === where.status,
      );
      return Promise.resolve(matched);
    }),
    create: jest.fn((_entity: unknown, data: Omit<ProductReport, 'id'>) => {
      const report = { id: nextId, ...data } as ProductReport;
      nextId += 1;
      reports.push(report);
      return report;
    }),
    nativeDelete: jest.fn((entity: unknown, where: { id?: number }) => {
      if (entity !== ProductReport || where.id === undefined)
        return Promise.resolve(0);
      const before = reports.length;
      for (let i = reports.length - 1; i >= 0; i -= 1) {
        if (reports[i].id === where.id) reports.splice(i, 1);
      }
      return Promise.resolve(before - reports.length);
    }),
    flush: jest.fn(() => Promise.resolve()),
  };

  let controller: LocationReportsController;

  beforeEach(async () => {
    reports.length = 0;
    nextId = 10;
    milk.aisleLocation = 'Aisle 7, left, middle shelf';
    milk.aisleNumber = 7;
    milk.mapX = 525;
    milk.mapY = 138;
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [LocationReportsController],
      providers: [
        LocationReportsService,
        StaffAuthGuard,
        {
          provide: AuthService,
          useValue: { authenticate: jest.fn() },
        },
        { provide: EntityManager, useValue: { fork: () => fork } },
      ],
    }).compile();
    controller = module.get(LocationReportsController);
  });

  const aisle2 = { aisleNumber: 2, side: 'left', shelf: 'middle' };

  it('saves the aisle, side, and shelf the shopper picked', async () => {
    const created = await controller.create({
      productId: 1,
      ...aisle2,
      mapY: 142,
    });
    expect(created).toEqual(
      expect.objectContaining({
        productId: 1,
        productName: 'Whole Milk 1L',
        kind: 'moved',
        status: 'pending',
        originalAisleLocation: 'Aisle 7, left, middle shelf',
        reportedAisleLocation: 'Aisle 2, left, middle shelf',
        reportedAisleNumber: 2,
        reportedMapX: 142,
        reportedMapY: 142,
      }),
    );

    // Where along the aisle the map was tapped never decides the shelf:
    // a tap near the far end can still be the bottom shelf, on the right.
    const farEnd = await controller.create({
      productId: 1,
      aisleNumber: 3,
      side: 'right',
      shelf: 'bottom',
      mapY: 20,
    });
    expect(farEnd).toEqual(
      expect.objectContaining({
        reportedAisleLocation: 'Aisle 3, right, bottom shelf',
        reportedAisleNumber: 3,
        reportedMapX: 247,
        reportedMapY: 88,
      }),
    );
    const noTap = await controller.create({
      productId: 1,
      aisleNumber: 8,
      side: 'left',
      shelf: 'top',
    });
    expect(noTap.reportedMapX).toBe(604);
    expect(noTap.reportedMapY).toBe(151);
  });

  it('refuses out-of-stock, a missing side or shelf, and unknown aisles or products', async () => {
    const invalid = [
      { productId: 1, ...aisle2, kind: 'out_of_stock' },
      { productId: 1, aisleNumber: 2, shelf: 'middle' },
      { productId: 1, aisleNumber: 2, side: 'left' },
      { productId: 1, aisleNumber: 2, side: 'middle', shelf: 'middle' },
      { productId: 1, aisleNumber: 2, side: 'left', shelf: 'floor' },
      { productId: 1, aisleNumber: 9, side: 'left', shelf: 'middle' },
      { productId: 1, aisleNumber: 0, side: 'left', shelf: 'middle' },
      { productId: 1, aisleNumber: 2.5, side: 'left', shelf: 'middle' },
      { productId: 1, ...aisle2, mapY: 'far' },
      // The old tap-coordinates payload no longer says where the product is.
      { productId: 1, mapX: 140, mapY: 142 },
      { productId: 'milk', ...aisle2 },
      null,
    ];
    for (const body of invalid) {
      await expect(controller.create(body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    await expect(
      controller.create({ productId: 99, ...aisle2 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(reports).toHaveLength(0);
  });

  it('lists pending reports first and accepts a repeated status query', async () => {
    await controller.create({ productId: 1, ...aisle2 });
    const older = reports[0];
    older.status = 'rejected';
    await controller.create({
      productId: 1,
      aisleNumber: 1,
      side: 'right',
      shelf: 'top',
    });
    const listed = await controller.list(['pending', 'rejected']);
    expect(listed.map((report) => report.status)).toEqual(['pending']);
    expect((await controller.list()).map((report) => report.status)).toEqual([
      'pending',
      'rejected',
    ]);
  });

  it('confirm moves the product, reject leaves it, and a shopper can read the decision', async () => {
    const report = await controller.create({
      productId: 1,
      ...aisle2,
      mapY: 142,
    });
    expect((await controller.get(String(report.id))).status).toBe('pending');
    const confirmed = await controller.confirm(String(report.id));
    expect(confirmed.status).toBe('confirmed');
    expect((await controller.get(String(report.id))).status).toBe('confirmed');
    expect(milk).toEqual(
      expect.objectContaining({
        aisleLocation: 'Aisle 2, left, middle shelf',
        aisleNumber: 2,
        mapX: 142,
        mapY: 142,
      }),
    );
    await expect(controller.confirm(String(report.id))).rejects.toBeInstanceOf(
      BadRequestException,
    );

    milk.aisleLocation = 'Aisle 7, left, middle shelf';
    const second = await controller.create({
      productId: 1,
      aisleNumber: 4,
      side: 'right',
      shelf: 'middle',
    });
    const rejected = await controller.reject(String(second.id));
    expect(rejected.status).toBe('rejected');
    expect((await controller.get(String(second.id))).status).toBe('rejected');
    expect(milk.aisleLocation).toBe('Aisle 7, left, middle shelf');
    await expect(controller.reject('0')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.get('abc')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.confirm('404')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.get('404')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('staff can delete a report so test or duplicate rows never linger', async () => {
    const report = await controller.create({ productId: 1, ...aisle2 });
    expect(reports).toHaveLength(1);
    expect(await controller.remove(String(report.id))).toEqual({ ok: true });
    expect(reports).toHaveLength(0);
    await expect(controller.get(String(report.id))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.remove('404')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('requires staff authentication on list, confirm, reject, and remove while keeping create and get public for shoppers', () => {
    const guardsOn = (method: keyof LocationReportsController) => {
      const target = Object.getOwnPropertyDescriptor(
        LocationReportsController.prototype,
        method,
      )?.value as object;
      return Reflect.getMetadata(GUARDS_METADATA, target) as unknown;
    };
    expect(guardsOn('list')).toEqual([StaffAuthGuard]);
    expect(guardsOn('confirm')).toEqual([StaffAuthGuard]);
    expect(guardsOn('reject')).toEqual([StaffAuthGuard]);
    expect(guardsOn('remove')).toEqual([StaffAuthGuard]);
    expect(guardsOn('create')).toBeUndefined();
    expect(guardsOn('get')).toBeUndefined();
  });
});
