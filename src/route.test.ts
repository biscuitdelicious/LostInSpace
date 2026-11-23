import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FALLBACK_PRODUCTS } from './products';
import {
  aisleCenterX,
  formatDistance,
  routeDetourNotice,
  routeInstruction,
  routeTurnDirection,
} from './route';

const milk = FALLBACK_PRODUCTS.find((p) => p.name === 'Whole Milk 1L');
assert.ok(milk);

test('distance formatting keeps one decimal place', () => {
  assert.equal(formatDistance(34.2), '34.2 m');
  assert.equal(formatDistance(7.46), '7.5 m');
});

test('route instruction reads like a Waze step', () => {
  assert.equal(routeInstruction(milk), 'Turn into aisle 7, left side, middle shelf');
  const bananas = FALLBACK_PRODUCTS.find((p) => p.name === 'Organic Bananas');
  assert.ok(bananas);
  assert.equal(routeInstruction(bananas), 'Turn into aisle 2, left side, middle shelf');
});

test('routeTurnDirection points left for left shelves, right for right shelves, and straight for centre', () => {
  const bread = FALLBACK_PRODUCTS.find((p) => p.name === 'Sourdough Bread');
  const yogurt = FALLBACK_PRODUCTS.find((p) => p.name === 'Greek Yogurt 500g');
  assert.ok(bread);
  assert.ok(yogurt);
  assert.equal(routeTurnDirection(milk), 'left');
  assert.equal(routeTurnDirection(bread), 'right');
  assert.equal(routeTurnDirection(yogurt), 'right');
  assert.equal(
    routeTurnDirection({ aisleLocation: 'Aisle 4, centre', aisleNumber: 4, mapX: aisleCenterX(4) }),
    'straight',
  );
  assert.equal(
    routeTurnDirection({ aisleLocation: 'Aisle 4', aisleNumber: 4, mapX: aisleCenterX(4) - 14 }),
    'left',
  );
  assert.equal(
    routeTurnDirection({ aisleLocation: 'Aisle 4', aisleNumber: 4, mapX: aisleCenterX(4) + 14 }),
    'right',
  );
});

test('detour routes describe the real first turn and the closed section instead of the blocked aisle entrance', () => {
  const bread = FALLBACK_PRODUCTS.find((p) => p.name === 'Sourdough Bread');
  const bananas = FALLBACK_PRODUCTS.find((p) => p.name === 'Organic Bananas');
  assert.ok(bread);
  assert.ok(bananas);

  const aisle2Detour = {
    detour: {
      closedSection: 'aisle 1 entrance',
      firstAisle: 2,
      via: 'back walkway' as const,
      firstTurn: 'left' as const,
    },
  };
  assert.equal(
    routeInstruction(bread, aisle2Detour),
    'Turn into aisle 2, via back walkway to aisle 1',
  );
  assert.equal(routeDetourNotice(aisle2Detour), 'Aisle 1 entrance closed');
  assert.equal(routeTurnDirection(bread, aisle2Detour), 'left');

  const straightDetour = {
    detour: {
      closedSection: 'aisle 1 entrance',
      firstAisle: 2,
      via: 'back walkway' as const,
      firstTurn: 'straight' as const,
    },
  };
  assert.equal(
    routeInstruction(bread, straightDetour),
    'Take aisle 2, via back walkway to aisle 1',
  );
  assert.equal(routeTurnDirection(bread, straightDetour), 'straight');

  const backWalkwayDetour = {
    detour: {
      closedSection: 'aisle 1 entrance',
      firstAisle: null,
      via: 'back walkway' as const,
      firstTurn: 'right' as const,
    },
  };
  assert.equal(
    routeInstruction(bananas, backWalkwayDetour),
    'Take the back walkway to aisle 2',
  );
  assert.equal(routeTurnDirection(bananas, backWalkwayDetour), 'right');

  const customDetour = {
    detour: {
      closedSection: 'front corridor',
      firstAisle: 2,
      via: null,
      firstTurn: 'left' as const,
    },
  };
  assert.equal(routeInstruction(bread, customDetour), 'Turn into aisle 2, then to aisle 1');
  assert.equal(routeDetourNotice(customDetour), 'Front corridor closed');
  assert.equal(routeDetourNotice(null), null);
});
