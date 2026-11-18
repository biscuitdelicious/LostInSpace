import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { StaffAuthGuard } from '../auth/staff-auth.guard';
import { WalkController } from './walk.controller';
import {
  WalkService,
  type WalkEdgeView,
  type WalkGraphView,
  type WalkRouteView,
} from './walk.service';

describe('WalkController', () => {
  let service: Partial<WalkService>;
  let controller: WalkController;
  let nextEdgeId: number;

  const graph: WalkGraphView = {
    nodes: [
      { id: 1, mapX: 345, mapY: 268, label: 'Entrance · door' },
      { id: 2, mapX: 345, mapY: 240, label: 'Entrance · corridor' },
      { id: 3, mapX: 387, mapY: 240, label: 'Corridor · aisle 5' },
    ],
    edges: [
      {
        id: 10,
        fromNodeId: 1,
        toNodeId: 2,
        blocked: false,
        name: 'Entrance · door to corridor',
      },
      {
        id: 11,
        fromNodeId: 2,
        toNodeId: 3,
        blocked: true,
        name: 'Corridor · entrance to aisle 5',
      },
    ],
  };

  beforeEach(() => {
    nextEdgeId = 12;
    service = {
      graph: jest.fn(() => Promise.resolve(graph)),
      addEdge: jest.fn((body: unknown) => {
        const value = body as { fromNodeId?: number; toNodeId?: number };
        if (!value?.fromNodeId || !value?.toNodeId) {
          return Promise.reject(
            new BadRequestException('fromNodeId must be a junction id'),
          );
        }
        if (value.fromNodeId === value.toNodeId) {
          return Promise.reject(
            new BadRequestException(
              'A connection needs two different junctions',
            ),
          );
        }
        const known =
          graph.nodes.some((node) => node.id === value.fromNodeId) &&
          graph.nodes.some((node) => node.id === value.toNodeId);
        if (!known)
          return Promise.reject(new NotFoundException('Junction not found'));
        const duplicate = graph.edges.some(
          (edge) =>
            (edge.fromNodeId === value.fromNodeId &&
              edge.toNodeId === value.toNodeId) ||
            (edge.fromNodeId === value.toNodeId &&
              edge.toNodeId === value.fromNodeId),
        );
        if (duplicate) {
          return Promise.reject(
            new BadRequestException('Those junctions are already connected'),
          );
        }
        const created: WalkEdgeView = {
          id: nextEdgeId++,
          fromNodeId: value.fromNodeId,
          toNodeId: value.toNodeId,
          blocked: false,
          name: 'Test connection',
        };
        graph.edges.push(created);
        return Promise.resolve(created);
      }),
      setEdgeBlocked: jest.fn((id: number, body: unknown) => {
        const edge = graph.edges.find((item) => item.id === id);
        if (!edge)
          return Promise.reject(new NotFoundException('Connection not found'));
        const value = body as { blocked?: unknown };
        if (typeof value?.blocked !== 'boolean') {
          return Promise.reject(
            new BadRequestException('blocked must be true or false'),
          );
        }
        edge.blocked = value.blocked;
        return Promise.resolve(edge);
      }),
      removeEdge: jest.fn((id: number) => {
        const index = graph.edges.findIndex((item) => item.id === id);
        if (index < 0)
          return Promise.reject(new NotFoundException('Connection not found'));
        graph.edges.splice(index, 1);
        return Promise.resolve({ ok: true as const });
      }),
    };
    controller = new WalkController(service as WalkService);
  });

  const guardsOn = (method: keyof WalkController) => {
    const target = Object.getOwnPropertyDescriptor(
      WalkController.prototype,
      method,
    )?.value as object;
    return Reflect.getMetadata(GUARDS_METADATA, target) as unknown;
  };

  it('serves the walk graph to shoppers without any sign-in', async () => {
    await expect(controller.graph()).resolves.toEqual(graph);
    expect(guardsOn('graph')).toBeUndefined();
  });

  it('plans shopper routes publicly and keeps staff-only changes guarded', async () => {
    const planned: WalkRouteView = {
      stops: [
        {
          productId: 9,
          route: {
            points: [
              { x: 345, y: 268 },
              { x: 387, y: 240 },
            ],
            meters: 4.5,
          },
        },
      ],
      totalMeters: 4.5,
    };
    service.planRoute = jest.fn(() => Promise.resolve(planned));
    await expect(
      controller.planRoute({
        start: { x: 345, y: 268 },
        products: [{ id: 9, mapX: 387, mapY: 240 }],
      }),
    ).resolves.toEqual(planned);
    expect(service.planRoute).toHaveBeenCalled();
    expect(guardsOn('planRoute')).toBeUndefined();
  });

  it('requires staff authentication on every mutation', () => {
    expect(guardsOn('addEdge')).toEqual([StaffAuthGuard]);
    expect(guardsOn('setBlocked')).toEqual([StaffAuthGuard]);
    expect(guardsOn('removeEdge')).toEqual([StaffAuthGuard]);
  });

  it('adds, blocks, reopens, and removes connections', async () => {
    const created = await controller.addEdge({ fromNodeId: 1, toNodeId: 3 });
    expect(created).toMatchObject({
      fromNodeId: 1,
      toNodeId: 3,
      blocked: false,
    });
    expect(created.id).toBe(12);

    await expect(
      controller.addEdge({ fromNodeId: 1, toNodeId: 3 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.addEdge({ fromNodeId: 1, toNodeId: 99 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.addEdge({ fromNodeId: 2, toNodeId: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const blocked = await controller.setBlocked('12', { blocked: true });
    expect(blocked.blocked).toBe(true);
    await expect(
      controller.setBlocked('12', { blocked: 'yes' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.setBlocked('404', { blocked: true }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(await controller.removeEdge('12')).toEqual({ ok: true });
    await expect(controller.removeEdge('12')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(graph.edges.map((edge) => edge.id)).toEqual([10, 11]);
  });
});
