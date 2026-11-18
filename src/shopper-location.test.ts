import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insideStoreWalls, tappedWalkwayPosition } from './shopper-location';
import type { WalkGraph } from './walk-graph';

const graph: WalkGraph = {
  nodes: [
    { id: 1, mapX: 345, mapY: 268, label: 'Entrance · door' },
    { id: 2, mapX: 345, mapY: 240, label: 'Entrance · corridor' },
    { id: 3, mapX: 464, mapY: 240, label: 'Corridor · aisle 6' },
    { id: 4, mapX: 541, mapY: 240, label: 'Corridor · aisle 7' },
    { id: 5, mapX: 541, mapY: 215, label: 'Aisle 7 · entrance end' },
    { id: 6, mapX: 541, mapY: 151, label: 'Aisle 7 · middle' },
    { id: 7, mapX: 541, mapY: 88, label: 'Aisle 7 · back end' },
  ],
  edges: [
    { id: 1, fromNodeId: 1, toNodeId: 2, blocked: false, name: 'Entrance · door to corridor' },
    { id: 2, fromNodeId: 2, toNodeId: 3, blocked: false, name: 'Corridor · entrance to aisle 6' },
    { id: 3, fromNodeId: 3, toNodeId: 4, blocked: false, name: 'Corridor · aisle 6 to aisle 7' },
    { id: 4, fromNodeId: 4, toNodeId: 5, blocked: false, name: 'Aisle 7 · corridor to entrance end' },
    { id: 5, fromNodeId: 5, toNodeId: 6, blocked: false, name: 'Aisle 7 · entrance end to middle' },
    { id: 6, fromNodeId: 6, toNodeId: 7, blocked: true, name: 'Aisle 7 · middle to back end' },
  ],
};

test('a shopper tap snaps to the nearest open walkway without doing any path finding', () => {
  assert.deepEqual(tappedWalkwayPosition({ x: 470, y: 244 }, graph), { x: 470, y: 240 });
  assert.deepEqual(tappedWalkwayPosition({ x: 539, y: 183 }, graph), { x: 541, y: 183 });
});

test('a tap far from every walkway still lands on the closest open one instead of failing', () => {
  // 38 map units from the aisle 7 spine and 45 from the corridor: farther
  // than the backend's end-of-walk last mile, and the old tap rejection.
  assert.deepEqual(tappedWalkwayPosition({ x: 503, y: 195 }, graph), { x: 541, y: 195 });
  assert.deepEqual(tappedWalkwayPosition({ x: 100, y: 100 }, graph), { x: 345, y: 240 });
  // Right beside the entrance START dot, still inside the entrance floor.
  assert.deepEqual(tappedWalkwayPosition({ x: 330, y: 300 }, graph), { x: 345, y: 268 });
});

test('a tap on a closed section lands on the nearest open walkway, never the closed one', () => {
  assert.deepEqual(tappedWalkwayPosition({ x: 545, y: 120 }, graph), { x: 541, y: 151 });
});

test('a manual position needs the store floor and at least one open walkway', () => {
  assert.equal(insideStoreWalls({ x: 345, y: 268 }), true);
  assert.equal(insideStoreWalls({ x: 2, y: 2 }), false);
  assert.equal(tappedWalkwayPosition({ x: 2, y: 2 }, graph), null);
  assert.equal(tappedWalkwayPosition({ x: 470, y: 240 }, null), null);
  const closedOnly: WalkGraph = {
    ...graph,
    edges: graph.edges.map((edge) => ({ ...edge, blocked: true })),
  };
  assert.equal(tappedWalkwayPosition({ x: 470, y: 240 }, closedOnly), null);
});
