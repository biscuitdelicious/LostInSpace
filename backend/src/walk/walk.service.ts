import { EntityManager } from '@mikro-orm/postgresql';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  type WalkEdgeData,
  type WalkNodeData,
  type WalkRoute,
  planWalkTrip,
  shortestWalk,
} from './walk-algorithm';
import { WalkEdge } from './walk-edge.entity';
import { seedWalkGraph } from './walk-graph.seed';
import { WalkNode } from './walk-node.entity';
import { walkEdgeLabel, walkNodeLabel } from './store-layout';

export type WalkNodeView = {
  id: number;
  mapX: number;
  mapY: number;
  label: string;
};
export type WalkEdgeView = {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  blocked: boolean;
  name: string;
};
export type WalkGraphView = { nodes: WalkNodeView[]; edges: WalkEdgeView[] };

export type WalkRouteRequest = {
  start: { x: number; y: number };
  products: { id: number; mapX: number; mapY: number }[];
  /** Keep the shopper's current target first; optimise only later stops. */
  keepFirst?: boolean;
};
export type WalkRouteStopView = {
  productId: number;
  route: WalkRoute | null;
};
export type WalkRouteView = {
  stops: WalkRouteStopView[];
  totalMeters: number;
};

/**
 * The store's walkable paths: junctions and the connections between them,
 * in the same map units the FloorPlan draws. Shoppers read the graph and
 * walk its shortest paths; only signed-in staff may change it.
 */
@Injectable()
export class WalkService implements OnModuleInit {
  constructor(private readonly em: EntityManager) {}

  /** First boot on an empty store: lay down the default walkways. */
  async onModuleInit(): Promise<void> {
    const fork = this.em.fork();
    const existing = await fork.count(WalkNode, {});
    if (existing > 0) return;
    const { nodes, edges } = seedWalkGraph();
    const rows = new Map<string, WalkNode>();
    for (const seed of nodes) {
      rows.set(seed.key, fork.create(WalkNode, { mapX: seed.x, mapY: seed.y }));
    }
    await fork.flush();
    for (const [fromKey, toKey] of edges) {
      const from = rows.get(fromKey);
      const to = rows.get(toKey);
      if (!from || !to) continue;
      fork.create(WalkEdge, { from, to, blocked: false });
    }
    await fork.flush();
  }

  async graph(): Promise<WalkGraphView> {
    const fork = this.em.fork();
    const nodes = await fork.find(WalkNode, {}, { orderBy: { id: 'asc' } });
    const edges = await fork.find(
      WalkEdge,
      {},
      { populate: ['from', 'to'], orderBy: { id: 'asc' } },
    );
    return {
      nodes: nodes.map((node) => ({
        id: node.id,
        mapX: node.mapX,
        mapY: node.mapY,
        label: walkNodeLabel(node),
      })),
      edges: edges.map((edge) => toEdgeView(edge)),
    };
  }

  async addEdge(body: unknown): Promise<WalkEdgeView> {
    const value = (body ?? {}) as Record<string, unknown>;
    const fromNodeId = readId(value.fromNodeId, 'fromNodeId');
    const toNodeId = readId(value.toNodeId, 'toNodeId');
    if (fromNodeId === toNodeId) {
      throw new BadRequestException(
        'A connection needs two different junctions',
      );
    }
    const fork = this.em.fork();
    const from = await fork.findOne(WalkNode, { id: fromNodeId });
    const to = await fork.findOne(WalkNode, { id: toNodeId });
    if (!from || !to) throw new NotFoundException('Junction not found');
    const duplicate = await fork.findOne(WalkEdge, {
      $or: [
        { from: fromNodeId, to: toNodeId },
        { from: toNodeId, to: fromNodeId },
      ],
    });
    if (duplicate)
      throw new BadRequestException('Those junctions are already connected');
    const edge = fork.create(WalkEdge, { from, to, blocked: false });
    await fork.flush();
    return toEdgeView(edge);
  }

  async setEdgeBlocked(id: number, body: unknown): Promise<WalkEdgeView> {
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException('Connection id is invalid');
    }
    const value = (body ?? {}) as Record<string, unknown>;
    if (typeof value.blocked !== 'boolean') {
      throw new BadRequestException('blocked must be true or false');
    }
    const fork = this.em.fork();
    const edge = await fork.findOne(
      WalkEdge,
      { id },
      { populate: ['from', 'to'] },
    );
    if (!edge) throw new NotFoundException('Connection not found');
    edge.blocked = value.blocked;
    await fork.flush();
    return toEdgeView(edge);
  }

  async removeEdge(id: number): Promise<{ ok: true }> {
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException('Connection id is invalid');
    }
    const fork = this.em.fork();
    const edge = await fork.findOne(WalkEdge, { id });
    if (!edge) throw new NotFoundException('Connection not found');
    await fork.nativeDelete(WalkEdge, { id });
    return { ok: true };
  }

  /**
   * Public shopper route planning. Product ids are opaque references: only
   * their map coordinates take part in Dijkstra. `keepFirst` is used for a
   * running trip, where the current target must not change under the
   * shopper; starting a list optimises every stop.
   */
  async planRoute(body: unknown): Promise<WalkRouteView> {
    const request = readRouteRequest(body);
    const { nodes, edges } = await this.data();
    const plan = request.keepFirst
      ? planKeepingFirst(nodes, edges, request)
      : planWalkTrip(
          nodes,
          edges,
          request.start,
          request.products.map((product) => ({
            x: product.mapX,
            y: product.mapY,
          })),
        );
    const stops = plan.order.map((pointIndex, index) => ({
      productId: request.products[pointIndex - 1].id,
      route: plan.legs[index],
    }));
    return { stops, totalMeters: plan.totalMeters };
  }

  private async data(): Promise<{
    nodes: WalkNodeData[];
    edges: WalkEdgeData[];
  }> {
    const fork = this.em.fork();
    const nodes = await fork.find(WalkNode, {}, { orderBy: { id: 'asc' } });
    const edges = await fork.find(WalkEdge, {}, { orderBy: { id: 'asc' } });
    return {
      nodes: nodes.map((node) => ({ id: node.id, x: node.mapX, y: node.mapY })),
      edges: edges.map((edge) => ({
        id: edge.id,
        fromId: edge.from.id,
        toId: edge.to.id,
        blocked: edge.blocked,
      })),
    };
  }
}

function toEdgeView(edge: WalkEdge): WalkEdgeView {
  return {
    id: edge.id,
    fromNodeId: edge.from.id,
    toNodeId: edge.to.id,
    blocked: edge.blocked,
    name: walkEdgeLabel(edge.from, edge.to),
  };
}

function readPoint(value: unknown, field: string): { x: number; y: number } {
  const point = (value ?? {}) as Record<string, unknown>;
  if (
    typeof point.x !== 'number' ||
    !Number.isFinite(point.x) ||
    typeof point.y !== 'number' ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.x > 700 ||
    point.y < 0 ||
    point.y > 330
  ) {
    throw new BadRequestException(`${field} must be a point on the store map`);
  }
  return { x: point.x, y: point.y };
}

function readRouteRequest(body: unknown): WalkRouteRequest {
  const value = (body ?? {}) as Record<string, unknown>;
  const start = readPoint(value.start, 'start');
  if (
    !Array.isArray(value.products) ||
    value.products.length < 1 ||
    value.products.length > 50
  ) {
    throw new BadRequestException(
      'products must contain between 1 and 50 products',
    );
  }
  const seen = new Set<number>();
  const products = value.products.map((item: unknown) => {
    const product = (item ?? {}) as Record<string, unknown>;
    const id = readId(product.id, 'product id');
    if (seen.has(id))
      throw new BadRequestException('products must not contain duplicates');
    seen.add(id);
    const point = readPoint(
      { x: product.mapX, y: product.mapY },
      'product location',
    );
    return { id, mapX: point.x, mapY: point.y };
  });
  if (value.keepFirst !== undefined && typeof value.keepFirst !== 'boolean') {
    throw new BadRequestException('keepFirst must be true or false');
  }
  return { start, products, keepFirst: value.keepFirst === true };
}

function planKeepingFirst(
  nodes: WalkNodeData[],
  edges: WalkEdgeData[],
  request: WalkRouteRequest,
): ReturnType<typeof planWalkTrip> {
  const first = request.products[0];
  const firstPoint = { x: first.mapX, y: first.mapY };
  const firstLeg = shortestWalk(nodes, edges, request.start, firstPoint);
  const rest = request.products.slice(1);
  if (!rest.length) {
    return { order: [1], legs: [firstLeg], totalMeters: firstLeg?.meters ?? 0 };
  }
  const later = planWalkTrip(
    nodes,
    edges,
    firstPoint,
    rest.map((product) => ({ x: product.mapX, y: product.mapY })),
  );
  return {
    order: [1, ...later.order.map((index) => index + 1)],
    legs: [firstLeg, ...later.legs],
    totalMeters:
      Math.round(((firstLeg?.meters ?? 0) + later.totalMeters) * 10) / 10,
  };
}

function readId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BadRequestException(`${field} must be a junction id`);
  }
  return value;
}
