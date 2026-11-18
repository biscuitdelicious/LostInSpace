import { EntityManager } from '@mikro-orm/postgresql';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Product } from '../products/product.entity';
import {
  ProductReport,
  REPORT_KIND,
  ReportStatus,
} from './product-report.entity';
import {
  AISLE_COUNT,
  SHELF_LEVELS,
  SHELF_SIDES,
  ShelfChoice,
  shelfLocation,
} from './shelf-location';

export type LocationReportView = {
  id: number;
  productId: number;
  productName: string;
  kind: typeof REPORT_KIND;
  status: ReportStatus;
  originalAisleLocation: string;
  originalAisleNumber: number;
  originalMapX: number;
  originalMapY: number;
  reportedAisleLocation: string;
  reportedAisleNumber: number;
  reportedMapX: number;
  reportedMapY: number;
  createdAt: string;
};

@Injectable()
export class LocationReportsService {
  constructor(private readonly em: EntityManager) {}

  async create(body: unknown): Promise<LocationReportView> {
    const input = readMovedReport(body);
    const location = shelfLocation(input.choice);
    const fork = this.em.fork();
    const product = await fork.findOne(Product, { id: input.productId });
    if (!product) throw new NotFoundException('Product not found');
    const report = fork.create(ProductReport, {
      product,
      productName: product.name,
      kind: REPORT_KIND,
      status: 'pending',
      originalAisleLocation: product.aisleLocation,
      originalAisleNumber: product.aisleNumber,
      originalMapX: product.mapX,
      originalMapY: product.mapY,
      reportedAisleLocation: location.aisleLocation,
      reportedAisleNumber: location.aisleNumber,
      reportedMapX: location.mapX,
      reportedMapY: location.mapY,
      createdAt: new Date(),
    });
    await fork.flush();
    return toView(report);
  }

  async list(status?: string): Promise<LocationReportView[]> {
    const where: { kind: typeof REPORT_KIND; status?: ReportStatus } = status
      ? { status: readStatus(status), kind: REPORT_KIND }
      : { kind: REPORT_KIND };
    const fork = this.em.fork();
    const reports = await fork.find(ProductReport, where, {
      populate: ['product'],
      orderBy: { createdAt: 'DESC' },
    });
    return reports
      .map(toView)
      .sort(
        (a, b) =>
          Number(a.status !== 'pending') - Number(b.status !== 'pending'),
      );
  }

  /** One report, so a shopper's phone can see whether staff decided yet. */
  async get(id: number): Promise<LocationReportView> {
    const report = await this.findReport(this.em.fork(), id);
    return toView(report);
  }

  /**
   * Staff-only: remove a report entirely (test runs, duplicates, or
   * mistakes). Confirmed reports already moved the product and stay in
   * the history, so only decided-and-safe rows are worth deleting.
   */
  async remove(id: number): Promise<{ ok: true }> {
    const fork = this.em.fork();
    await this.findReport(fork, id);
    await fork.nativeDelete(ProductReport, { id });
    return { ok: true };
  }

  async confirm(id: number): Promise<LocationReportView> {
    const fork = this.em.fork();
    const report = await this.pendingReport(fork, id);
    const product = await fork.findOne(Product, { id: report.product.id });
    if (!product) throw new NotFoundException('Product not found');
    product.aisleLocation = report.reportedAisleLocation;
    product.aisleNumber = report.reportedAisleNumber;
    product.mapX = report.reportedMapX;
    product.mapY = report.reportedMapY;
    report.status = 'confirmed';
    await fork.flush();
    return toView(report);
  }

  async reject(id: number): Promise<LocationReportView> {
    const fork = this.em.fork();
    const report = await this.pendingReport(fork, id);
    report.status = 'rejected';
    await fork.flush();
    return toView(report);
  }

  private async findReport(
    fork: EntityManager,
    id: number,
  ): Promise<ProductReport> {
    if (!Number.isInteger(id) || id < 1)
      throw new BadRequestException('Report id is invalid');
    const report = await fork.findOne(
      ProductReport,
      { id },
      { populate: ['product'] },
    );
    if (!report || report.kind !== REPORT_KIND)
      throw new NotFoundException('Report not found');
    return report;
  }

  private async pendingReport(
    fork: EntityManager,
    id: number,
  ): Promise<ProductReport> {
    const report = await this.findReport(fork, id);
    if (report.status !== 'pending') {
      throw new BadRequestException(
        'Only a pending report can be confirmed or rejected',
      );
    }
    return report;
  }
}

function readMovedReport(body: unknown): {
  productId: number;
  choice: ShelfChoice;
} {
  if (!body || typeof body !== 'object')
    throw new BadRequestException('Report body is required');
  const value = body as Record<string, unknown>;
  if (value.kind !== undefined && value.kind !== REPORT_KIND) {
    throw new BadRequestException(
      'Only moved reports are accepted. Out of stock needs a specific brand, and products do not track brands.',
    );
  }
  const productId = readFinite(value.productId, 'productId');
  if (!Number.isInteger(productId) || productId < 1) {
    throw new BadRequestException('productId must be a product id');
  }
  const aisleNumber = readFinite(value.aisleNumber, 'aisleNumber');
  if (
    !Number.isInteger(aisleNumber) ||
    aisleNumber < 1 ||
    aisleNumber > AISLE_COUNT
  ) {
    throw new BadRequestException(
      `aisleNumber must be an aisle from 1 to ${AISLE_COUNT}`,
    );
  }
  // Side and shelf are picked by the shopper, never inferred from a tap.
  const side = SHELF_SIDES.find((item) => item === value.side);
  if (!side) throw new BadRequestException('side must be left or right');
  const shelf = SHELF_LEVELS.find((item) => item === value.shelf);
  if (!shelf) {
    throw new BadRequestException('shelf must be top, middle, or bottom');
  }
  const choice: ShelfChoice = {
    aisleNumber,
    side,
    shelf,
  };
  if (value.mapY !== undefined) choice.mapY = readFinite(value.mapY, 'mapY');
  return { productId, choice };
}

function readFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`${name} must be a number`);
  }
  return value;
}

function readStatus(status: string): ReportStatus {
  if (status === 'pending' || status === 'confirmed' || status === 'rejected')
    return status;
  throw new BadRequestException(
    'status must be pending, confirmed, or rejected',
  );
}

export function toView(report: ProductReport): LocationReportView {
  const createdAt =
    report.createdAt instanceof Date
      ? report.createdAt
      : new Date(report.createdAt);
  return {
    id: report.id,
    productId: report.product.id,
    productName: report.productName,
    kind: REPORT_KIND,
    status: report.status,
    originalAisleLocation: report.originalAisleLocation,
    originalAisleNumber: report.originalAisleNumber,
    originalMapX: report.originalMapX,
    originalMapY: report.originalMapY,
    reportedAisleLocation: report.reportedAisleLocation,
    reportedAisleNumber: report.reportedAisleNumber,
    reportedMapX: report.reportedMapX,
    reportedMapY: report.reportedMapY,
    createdAt: createdAt.toISOString(),
  };
}
