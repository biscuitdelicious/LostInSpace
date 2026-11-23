import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closedWalkEdges,
  fetchWalkGraph,
  findWalkEdgeAtPoint,
  requestWalkRoute,
  resolveWalkEdges,
  toProductRoute,
} from './walk-graph';

const graph = {
  nodes: [{ id: 1, mapX: 345, mapY: 268, label: 'Entrance · door' }],
  edges: [{ id: 2, fromNodeId: 1, toNodeId: 3, blocked: false, name: 'Entrance · door to corridor' }],
};

test('fetchWalkGraph returns the backend graph including staff-facing names', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => graph }) as Response) as typeof fetch;
  try {
    assert.deepEqual(await fetchWalkGraph('http://example.test'), graph);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchWalkGraph returns null for an offline or empty graph', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    assert.equal(await fetchWalkGraph('http://example.test'), null);
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ nodes: [], edges: [] }) }) as Response) as typeof fetch;
    assert.equal(await fetchWalkGraph('http://example.test'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('requestWalkRoute sends only positions and product ids, with keepFirst for running trips', async () => {
  const original = globalThis.fetch;
  let request: { url: string; body: { start: unknown; keepFirst: boolean; products: unknown[] } } | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    request = { url: String(input), body: JSON.parse(String(init?.body)) };
    return {
      ok: true,
      json: async () => ({
        stops: [
          { productId: 8, route: { points: [{ x: 345, y: 268 }, { x: 599, y: 192 }], meters: 42.1 } },
          { productId: 1, route: null },
        ],
        totalMeters: 42.1,
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const result = await requestWalkRoute({ x: 345, y: 268 }, [
      { id: 1, mapX: 525, mapY: 138 },
      { id: 8, mapX: 599, mapY: 192 },
    ], true, 'http://example.test');
    assert.equal(request!.url, 'http://example.test/walk/route');
    assert.equal(request!.body.keepFirst, true);
    assert.deepEqual(request!.body.products, [{ id: 1, mapX: 525, mapY: 138 }, { id: 8, mapX: 599, mapY: 192 }]);
    assert.deepEqual(result.stops.map(stop => stop.productId), [8, 1]);
    assert.equal(result.stops[1].route, null); // closed is explicit, never a fallback route
  } finally {
    globalThis.fetch = original;
  }
});

test('requestWalkRoute rejects incomplete or failed responses', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 503 }) as Response) as typeof fetch;
    await assert.rejects(requestWalkRoute({ x: 1, y: 1 }, [{ id: 1, mapX: 2, mapY: 2 }], false, 'http://example.test'));
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ stops: [] }) }) as Response) as typeof fetch;
    await assert.rejects(requestWalkRoute({ x: 1, y: 1 }, [{ id: 1, mapX: 2, mapY: 2 }], false, 'http://example.test'));
  } finally {
    globalThis.fetch = original;
  }
});

test('toProductRoute converts backend points into SVG path data and keeps detour details when present', () => {
  assert.deepEqual(toProductRoute({ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], meters: 12.5 }), {
    points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    path: 'M 1 2 L 3 4',
    distanceMeters: 12.5,
  });
  const detour = {
    closedSection: 'aisle 1 entrance',
    firstAisle: 2,
    via: 'back walkway' as const,
    firstTurn: 'left' as const,
  };
  assert.deepEqual(
    toProductRoute({ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], meters: 40.9, detour }),
    {
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      path: 'M 1 2 L 3 4',
      distanceMeters: 40.9,
      detour,
    },
  );
});

test('resolveWalkEdges, closedWalkEdges, and findWalkEdgeAtPoint map segments and hit-test taps', () => {
  const sampleGraph = {
    nodes: [
      { id: 1, mapX: 541, mapY: 240, label: 'Corridor · aisle 7' },
      { id: 2, mapX: 541, mapY: 215, label: 'Aisle 7 · entrance end' },
      { id: 3, mapX: 541, mapY: 151, label: 'Aisle 7 · middle' },
      { id: 4, mapX: 541, mapY: 88, label: 'Aisle 7 · back end' },
      { id: 5, mapX: 464, mapY: 240, label: 'Corridor · aisle 6' },
    ],
    edges: [
      { id: 10, fromNodeId: 1, toNodeId: 2, blocked: false, name: 'Aisle 7 · corridor to entrance end' },
      { id: 11, fromNodeId: 2, toNodeId: 3, blocked: false, name: 'Aisle 7 · entrance end to middle' },
      { id: 12, fromNodeId: 3, toNodeId: 4, blocked: true, name: 'Aisle 7 · middle to back end' },
      { id: 13, fromNodeId: 5, toNodeId: 1, blocked: false, name: 'Corridor · aisle 6 to aisle 7' },
      { id: 99, fromNodeId: 3, toNodeId: 999, blocked: true, name: 'Dangling edge' },
    ],
  };

  assert.equal(resolveWalkEdges(null).length, 0);
  assert.equal(resolveWalkEdges(sampleGraph).length, 4);
  assert.deepEqual(
    closedWalkEdges(sampleGraph).map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })),
    [{ id: 12, from: { x: 541, y: 151 }, to: { x: 541, y: 88 } }],
  );

  // Tapping near the closed middle-to-back stretch picks edge 12.
  assert.equal(findWalkEdgeAtPoint({ x: 545, y: 120 }, sampleGraph)?.id, 12);
  // Tapping near the entrance-to-middle stretch picks edge 11.
  assert.equal(findWalkEdgeAtPoint({ x: 538, y: 182 }, sampleGraph)?.id, 11);
  // Tapping right near junction (541, 151) breaks ties toward the closer midpoint.
  assert.equal(findWalkEdgeAtPoint({ x: 541, y: 149 }, sampleGraph)?.id, 12);
  assert.equal(findWalkEdgeAtPoint({ x: 541, y: 153 }, sampleGraph)?.id, 11);
  // Taps far away from any walkway return null.
  assert.equal(findWalkEdgeAtPoint({ x: 120, y: 120 }, sampleGraph), null);
});