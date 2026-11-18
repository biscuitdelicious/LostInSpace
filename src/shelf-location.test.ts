import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aisleCenterX } from './route';
import { frameCurrentStop } from './map-frame';
import { aisleFromTap, aisleTapPoint, shelfLocation, storePointToLocal, tapToStorePoint } from './shelf-location';

test('a tap picks the aisle from anywhere in its lane, never the side or shelf', () => {
  // Both edges of aisle 3 and its name label are the same big target.
  for (const x of [aisleCenterX(3) - 38, aisleCenterX(3), aisleCenterX(3) + 38]) {
    for (const y of [10, 90, 150, 215, 256]) {
      assert.equal(aisleFromTap({ x, y })?.aisleNumber, 3);
    }
  }
  assert.equal(aisleFromTap({ x: aisleCenterX(1) - 30, y: 150 })?.aisleNumber, 1);
  assert.equal(aisleFromTap({ x: aisleCenterX(8) + 30, y: 150 })?.aisleNumber, 8);
  // The tap keeps how far along the aisle it was, inside the shelving.
  assert.deepEqual(aisleFromTap({ x: 240, y: 20 }), { aisleNumber: 3, mapY: 88 });
  assert.deepEqual(aisleFromTap({ x: 240, y: 142.4 }), { aisleNumber: 3, mapY: 142 });
  assert.deepEqual(aisleFromTap({ x: 240, y: 260 }), { aisleNumber: 3, mapY: 215 });
});

test('the entrance walkway and outside the store are not an aisle', () => {
  assert.equal(aisleFromTap({ x: 345, y: 290 }), null);
  assert.equal(aisleFromTap({ x: 10, y: 150 }), null);
  assert.equal(aisleFromTap({ x: 690, y: 150 }), null);
  assert.equal(aisleFromTap({ x: 345, y: 2 }), null);
});

test('side and shelf come only from the shopper’s choice', () => {
  const tap = { aisleNumber: 3, mapY: 100 };
  // Same tap near the far end of the aisle, every side and shelf is possible.
  assert.deepEqual(shelfLocation({ ...tap, side: 'left', shelf: 'bottom' }), {
    aisleNumber: 3,
    aisleLocation: 'Aisle 3, left, bottom shelf',
    mapX: aisleCenterX(3) - 14,
    mapY: 100,
  });
  assert.deepEqual(shelfLocation({ ...tap, side: 'right', shelf: 'top' }), {
    aisleNumber: 3,
    aisleLocation: 'Aisle 3, right, top shelf',
    mapX: aisleCenterX(3) + 14,
    mapY: 100,
  });
  assert.equal(shelfLocation({ ...tap, side: 'right', shelf: 'middle' }).aisleLocation, 'Aisle 3, right, middle shelf');
  // Until a side is picked the pin sits on the aisle centre line.
  assert.deepEqual(aisleTapPoint(tap, null), { x: aisleCenterX(3), y: 100 });
});

test('taps round-trip through the full map and through an aisle close-up', () => {
  const target = { x: 240, y: 142 };
  for (const portrait of [false, true]) {
    const local = storePointToLocal(target, 390, 520, portrait);
    const decoded = tapToStorePoint({ localX: local.x, localY: local.y, svgWidth: 390, svgHeight: 520, portrait });
    assert.ok(decoded);
    assert.ok(Math.abs(decoded.x - target.x) < 0.01);
    assert.ok(Math.abs(decoded.y - target.y) < 0.01);
  }
  const frame = frameCurrentStop({ portrait: true, aisleNumber: 3, pin: target, routePoints: [], viewportWidth: 390, viewportHeight: 420 });
  assert.ok(frame.width < 330);
  const zoomed = storePointToLocal(target, 390, 420, true, frame);
  const full = storePointToLocal(target, 390, 420, true);
  assert.ok(Math.abs(zoomed.x - full.x) + Math.abs(zoomed.y - full.y) > 20);
  const decoded = tapToStorePoint({ localX: zoomed.x, localY: zoomed.y, svgWidth: 390, svgHeight: 420, portrait: true, frame });
  assert.ok(decoded);
  assert.ok(Math.abs(decoded.x - target.x) < 0.01);
  assert.ok(Math.abs(decoded.y - target.y) < 0.01);
  assert.equal(aisleFromTap(decoded)?.aisleNumber, 3);
  assert.equal(tapToStorePoint({ localX: -20, localY: 10, svgWidth: 390, svgHeight: 200, portrait: false }), null);
  assert.equal(tapToStorePoint({ localX: 10, localY: 10, svgWidth: 0, svgHeight: 200, portrait: false }), null);
});
