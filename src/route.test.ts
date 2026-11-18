import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FALLBACK_PRODUCTS } from './products';
import {
  aisleCenterX,
  formatDistance,
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
