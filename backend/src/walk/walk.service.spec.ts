import { BadRequestException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalkEdge } from './walk-edge.entity';
import { WalkNode } from './walk-node.entity';
import { seedWalkGraph } from './walk-graph.seed';
import { WalkService } from './walk.service';
import { walkEdgeLabel } from './store-layout';

describe('WalkService route API', () => {
  function makeService() {
    const seed = seedWalkGraph();
    const ids = new Map(seed.nodes.map((node, index) => [node.key, index + 1]));
    const nodes = seed.nodes.map((node, index) => ({
      id: index + 1,
      mapX: node.x,
      mapY: node.y,
    })) as WalkNode[];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges = seed.edges.map(([fromKey, toKey], index) => ({
      id: index + 1,
      fromId: ids.get(fromKey)!,
      toId: ids.get(toKey)!,
      blocked: false,
    }));
    const hydrateEdge = (
      row: (typeof edges)[number],
      options?: { populate?: readonly string[] },
    ): WalkEdge => {
      const populate = new Set(options?.populate ?? []);
      return {
        id: row.id,
        from: populate.has('from')
          ? byId.get(row.fromId)!
          : ({ id: row.fromId } as WalkNode),
        to: populate.has('to')
          ? byId.get(row.toId)!
          : ({ id: row.toId } as WalkNode),
        blocked: row.blocked,
      };
    };
    const fork = {
      find: jest.fn(
        (
          entity: unknown,
          _where?: unknown,
          options?: { populate?: readonly string[] },
        ) =>
          Promise.resolve(
            entity === WalkNode
              ? nodes
              : edges.map((row) => hydrateEdge(row, options)),
          ),
      ),
      findOne: jest.fn(
        (
          entity: unknown,
          where: { id?: number },
          options?: { populate?: readonly string[] },
        ) => {
          if (entity === WalkNode) {
            return Promise.resolve(
              nodes.find((node) => node.id === where.id) ?? null,
            );
          }
          const row = edges.find((edge) => edge.id === where.id);
          if (!row) return Promise.resolve(null);
          const hydrated = hydrateEdge(row, options);
          return Promise.resolve(
            new Proxy(hydrated, {
              set(target, prop, value) {
                if (prop === 'blocked' && typeof value === 'boolean') {
                  row.blocked = value;
                }
                return Reflect.set(target, prop, value);
              },
            }),
          );
        },
      ),
      flush: jest.fn(() => Promise.resolve()),
    };
    const em = { fork: () => fork } as unknown as EntityManager;
    return { service: new WalkService(em), nodes, edges, ids };
  }

  const milk = { id: 1, mapX: 525, mapY: 138 };
  const water = { id: 9, mapX: 599, mapY: 192 };
  const bread = { id: 3, mapX: 99, mapY: 105 };
  const start = { x: 345, y: 268 };

  it('returns ordered stops and backend Dijkstra points for a shopping list', async () => {
    const { service } = makeService();
    const result = await service.planRoute({
      start,
      products: [milk, bread, water],
    });
    expect(result.stops.map((stop) => stop.productId)).toEqual([9, 1, 3]);
    const milkLeg = result.stops.find((stop) => stop.productId === 1)!;
    expect(milkLeg.route?.meters).toBe(26.2); // from aisle 8, the previous stop
    expect(milkLeg.route?.points.at(-1)).toEqual({ x: 525, y: 138 });
    expect(result.totalMeters).toBeGreaterThan(0);
  });

  it('keepFirst preserves the current target while optimising later stops', async () => {
    const { service } = makeService();
    const result = await service.planRoute({
      start,
      products: [bread, water, milk],
      keepFirst: true,
    });
    expect(result.stops[0].productId).toBe(3);
    expect(result.stops[0].route?.meters).toBe(44.9);
    expect(result.stops.slice(1).map((stop) => stop.productId)).toEqual([1, 9]);
  });

  it('returns a null route for a shelf in a closed aisle section', async () => {
    const { service, edges, ids } = makeService();
    for (const edge of edges) {
      const pair = new Set([edge.fromId, edge.toId]);
      if (pair.has(ids.get('a7_151')!) && pair.has(ids.get('a7_88')!))
        edge.blocked = true;
    }
    const result = await service.planRoute({ start, products: [milk] });
    expect(result.stops).toEqual([{ productId: 1, route: null }]);
    expect(result.totalMeters).toBe(0);
  });

  it('a shopper at the junction below a closed aisle entrance gets the open detour, or no route when none is left', async () => {
    const { service, edges, ids } = makeService();
    const close = (fromKey: string, toKey: string) => {
      for (const edge of edges) {
        const pair = new Set([edge.fromId, edge.toId]);
        if (pair.has(ids.get(fromKey)!) && pair.has(ids.get(toKey)!))
          edge.blocked = true;
      }
    };
    close('c79', 'a1_215');
    const junctionStart = { x: 79, y: 240 };

    const detoured = await service.planRoute({
      start: junctionStart,
      products: [bread],
    });
    const route = detoured.stops[0].route;
    expect(route).not.toBeNull();
    expect(route!.meters).toBeGreaterThan(2.5);
    // No leg of the reply walks the closed strip x=79 between y=215..240.
    const walksClosedStrip = route!.points.some((point, index) => {
      if (index === 0) return false;
      const previous = route!.points[index - 1];
      if (Math.abs(previous.x - 79) > 0.01 || Math.abs(point.x - 79) > 0.01)
        return false;
      const lo = Math.max(Math.min(previous.y, point.y), 215);
      const hi = Math.min(Math.max(previous.y, point.y), 240);
      return hi - lo > 0.01 && lo < 239.99 && hi > 215.01;
    });
    expect(walksClosedStrip).toBe(false);

    // Seal aisle 1's only other entrance: the reply says unavailable.
    close('a1_55', 'a2_55');
    const sealed = await service.planRoute({
      start: junctionStart,
      products: [bread],
    });
    expect(sealed.stops).toEqual([{ productId: 3, route: null }]);
    expect(sealed.totalMeters).toBe(0);
  });

  it('validates shopper input without touching the graph', async () => {
    const { service } = makeService();
    await expect(
      service.planRoute({ start, products: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.planRoute({ start: { x: -1, y: 2 }, products: [milk] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.planRoute({ start, products: [milk, milk] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('names neighbouring aisle sections distinctly for staff', async () => {
    const { service } = makeService();
    const graph = await service.graph();
    const aisle2 = graph.edges.filter((edge) =>
      edge.name.startsWith('Aisle 2 ·'),
    );
    expect(aisle2.map((edge) => edge.name)).toEqual([
      'Aisle 2 · entrance end to middle',
      'Aisle 2 · middle to back end',
      'Aisle 2 · back end to back walkway',
    ]);
    expect(new Set(aisle2.map((edge) => edge.name)).size).toBe(3);
    expect(
      walkEdgeLabel({ mapX: 345, mapY: 240 }, { mapX: 387, mapY: 240 }),
    ).toBe('Corridor · entrance to aisle 5');
  });

  it('populates endpoints when blocking or reopening so the reply carries the real connection name', async () => {
    const { service, edges, ids } = makeService();
    const corridor = edges.find((edge) => {
      const pair = new Set([edge.fromId, edge.toId]);
      return pair.has(ids.get('c345')!) && pair.has(ids.get('c387')!);
    })!;

    const blocked = await service.setEdgeBlocked(corridor.id, {
      blocked: true,
    });
    expect(blocked).toEqual({
      id: corridor.id,
      fromNodeId: corridor.fromId,
      toNodeId: corridor.toId,
      blocked: true,
      name: 'Corridor · entrance to aisle 5',
    });

    const reopened = await service.setEdgeBlocked(corridor.id, {
      blocked: false,
    });
    expect(reopened.blocked).toBe(false);
    expect(reopened.name).toBe('Corridor · entrance to aisle 5');
  });
});
