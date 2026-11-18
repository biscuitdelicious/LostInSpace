import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FALLBACK_PRODUCTS } from './products';
import { ENTRANCE_POINT, aisleCenterX, type MapPoint } from './route';
import {
  PORTRAIT_PLAN,
  SHOPPER_HALO_RADIUS,
  aisleLabelClearance,
  aisleLabelInkBox,
  aisleLabelPlacement,
  drawnBox,
  drawnPoint,
  entranceTextBox,
  frameContains,
  frameCurrentStop,
  fullMapFrame,
  labelBoxOf,
  pinLabelBoxOf,
  pinLabelPlacement,
  renderedWidth,
  shelfBlock,
  shopperNameBox,
  startMarkerBox,
  walkEdgeTapBox,
  type DrawnBox,
} from './map-frame';

function product(name: string) {
  const item = FALLBACK_PRODUCTS.find((entry) => entry.name === name);
  assert.ok(item);
  return item;
}

function overlaps(a: DrawnBox, b: DrawnBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const water = product('Sparkling Mineral Water');
const milk = product('Whole Milk 1L');
const bread = product('Sourdough Bread');
const phone = { viewportWidth: 390, viewportHeight: 524 };

/**
 * Route points shaped like the backend's: entrance, corridor, then into the
 * aisle from the corridor end or round by the back walkway, and a short
 * sideways step to the pin. Fixture data only — the app never plans paths.
 */
function walkTo(aisle: number, pin: MapPoint, via: 'corridor' | 'back'): MapPoint[] {
  const centre = aisleCenterX(aisle);
  const points: MapPoint[] = [ENTRANCE_POINT, { x: ENTRANCE_POINT.x, y: 240 }];
  if (via === 'corridor') {
    points.push({ x: centre, y: 240 });
  } else {
    const detour = aisleCenterX(aisle === 4 ? 5 : 4);
    points.push({ x: detour, y: 240 }, { x: detour, y: 55 }, { x: centre, y: 55 });
  }
  points.push({ x: centre, y: pin.y }, pin);
  return points;
}

/**
 * Every route point the chip would hide, sampled one map unit apart, with
 * how far along the walk it is from the pin.
 */
function hiddenRoutePoints(chip: DrawnBox, route: MapPoint[]): (MapPoint & { fromPin: number })[] {
  const lineHalfWidth = 3;
  const hidden: (MapPoint & { fromPin: number })[] = [];
  let afterSegment = 0;
  for (let index = route.length - 1; index >= 1; index -= 1) {
    const from = route[index - 1];
    const to = route[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(length));
    for (let step = 0; step <= steps; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / steps;
      const y = from.y + ((to.y - from.y) * step) / steps;
      if (
        x > chip.x - lineHalfWidth && x < chip.x + chip.width + lineHalfWidth
        && y > chip.y - lineHalfWidth && y < chip.y + chip.height + lineHalfWidth
      ) hidden.push({ x, y, fromPin: afterSegment + (length * (steps - step)) / steps });
    }
    afterSegment += length;
  }
  return hidden;
}

function pinDotBox(pin: MapPoint): DrawnBox {
  return { x: pin.x - 10, y: pin.y - 10, width: 20, height: 20 };
}

test('a phone list stop zooms into the destination aisle, fills the width, and keeps START and ENTRANCE / CHECKOUT inside the frame', () => {
  // Frame fitting consumes backend route points; it does not plan paths.
  const routePoints = [ENTRANCE_POINT, { x: water.mapX, y: water.mapY }];
  const frame = frameCurrentStop({
    portrait: true,
    aisleNumber: water.aisleNumber,
    pin: { x: water.mapX, y: water.mapY },
    routePoints,
    ...phone,
  });
  const full = fullMapFrame(true);
  assert.ok(frame.width < full.width);
  assert.ok(frame.height < full.height - 200);
  assert.ok(Math.abs(frame.width / frame.height - phone.viewportWidth / phone.viewportHeight) < 0.08);
  assert.ok(renderedWidth(frame, phone.viewportWidth, phone.viewportHeight) > phone.viewportWidth * 0.92);
  assert.ok(renderedWidth(full, phone.viewportWidth, phone.viewportHeight) < phone.viewportWidth * 0.7);

  const pin = drawnPoint({ x: water.mapX, y: water.mapY }, true);
  assert.ok(frameContains(frame, { x: pin.x - 4, y: pin.y - 4, width: 8, height: 8 }));
  assert.ok(frameContains(frame, labelBoxOf(aisleLabelPlacement(water.aisleNumber, true, true))));
  const start = drawnPoint(ENTRANCE_POINT, true);
  assert.ok(frameContains(frame, startMarkerBox(start, true)));
  assert.ok(frameContains(frame, entranceTextBox(true)));
  assert.ok(frame.x >= 0 && frame.y >= 0);
  assert.ok(frame.x + frame.width <= PORTRAIT_PLAN.width + 0.5);
  assert.ok(frame.y + frame.height <= PORTRAIT_PLAN.height + 0.5);
});

test('aisle names sit beside their own shelf row and the product chip never covers an aisle name', () => {
  const aisleBoxes = Array.from({ length: 8 }, (_, index) => {
    const aisle = index + 1;
    const shelf = drawnBox(shelfBlock(aisle), true);
    const label = labelBoxOf(aisleLabelPlacement(aisle, true, true));
    // The name sits to the right of its shelf row, vertically inside the shelf band.
    assert.ok(label.x >= shelf.x + shelf.width);
    assert.ok(label.y >= shelf.y);
    assert.ok(label.y + label.height <= shelf.y + shelf.height);
    return label;
  });

  for (const aisle of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const offset of [-14, 14]) {
      for (const mapY of [88, 108, 145, 192, 215]) {
        for (const via of ['corridor', 'back'] as const) {
          const mapX = aisleCenterX(aisle) + offset;
          const routePoints = walkTo(aisle, { x: mapX, y: mapY }, via);
          const frame = frameCurrentStop({
            portrait: true,
            aisleNumber: aisle,
            pin: { x: mapX, y: mapY },
            routePoints,
            ...phone,
          });
          const pin = drawnPoint({ x: mapX, y: mapY }, true);
          const chip = pinLabelBoxOf(pinLabelPlacement(pin, true, true, {
            aisleNumber: aisle,
            routePoints: routePoints.map((point) => drawnPoint(point, true)),
          }));
          assert.ok(frameContains(frame, chip));
          assert.ok(frameContains(frame, aisleBoxes[aisle - 1]));
          assert.ok(frameContains(frame, startMarkerBox(drawnPoint(ENTRANCE_POINT, true), true)));
          assert.ok(frameContains(frame, entranceTextBox(true)));
          for (const aisleBox of aisleBoxes) {
            assert.equal(overlaps(chip, aisleBox), false);
          }
        }
      }
    }
  }
});

test('on a phone the Sourdough Bread chip sits below the pin, so the line into aisle 1 and the pin stay visible', () => {
  const pinPoint = { x: bread.mapX, y: bread.mapY };
  const pin = drawnPoint(pinPoint, true);
  for (const via of ['corridor', 'back'] as const) {
    const route = walkTo(bread.aisleNumber, pinPoint, via).map((point) => drawnPoint(point, true));
    for (const focused of [true, false]) {
      const context = { aisleNumber: bread.aisleNumber, routePoints: route };
      const label = pinLabelPlacement(pin, true, focused, context);
      const chip = pinLabelBoxOf(label);
      // The old spot, above the pin, lay along the aisle 1 walkway.
      assert.ok(hiddenRoutePoints(pinLabelBoxOf({ ...label, y: pin.y - 26 }), route).length > 20);
      assert.deepEqual(hiddenRoutePoints(chip, route), []);
      assert.equal(overlaps(chip, pinDotBox(pin)), false);
      assert.ok(chip.y > pin.y);
      // Still over the shelf column, inside the store walls.
      assert.ok(chip.x >= 98 && chip.x + chip.width <= 254);
      assert.ok(chip.y + chip.height <= 685);
    }
  }
  // Before the route arrives the chip is already in its final place.
  assert.deepEqual(
    pinLabelPlacement(pin, true, true, { aisleNumber: bread.aisleNumber }),
    pinLabelPlacement(pin, true, true, {
      aisleNumber: bread.aisleNumber,
      routePoints: walkTo(bread.aisleNumber, pinPoint, 'corridor').map((point) => drawnPoint(point, true)),
    }),
  );
});

test('the product chip never hides the walk into the pin or the pin itself, for any shelf, on a phone or a wide screen', () => {
  for (const portrait of [true, false]) {
    for (const aisle of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const offset of [-20, -14, 0, 14, 20]) {
        for (const mapY of [88, 105, 138, 151, 192, 215]) {
          for (const via of ['corridor', 'back'] as const) {
            const pinPoint = { x: aisleCenterX(aisle) + offset, y: mapY };
            const pin = drawnPoint(pinPoint, portrait);
            const route = walkTo(aisle, pinPoint, via).map((point) => drawnPoint(point, portrait));
            const chip = pinLabelBoxOf(pinLabelPlacement(pin, portrait, false, { aisleNumber: aisle, routePoints: route }));
            const where = `${portrait ? 'portrait' : 'landscape'} aisle ${aisle} offset ${offset} y ${mapY} via ${via}`;
            const hidden = hiddenRoutePoints(chip, route);
            // The last 6 m into the pin are always clear. On a phone the
            // chip stays over the shelves, so the whole line is.
            assert.deepEqual(hidden.filter((point) => portrait || point.fromPin <= 60), [], where);
            assert.equal(overlaps(chip, pinDotBox(pin)), false, where);
            // Inside the store walls.
            const walls = drawnBox({ x: 15, y: 15, width: 670, height: 300 }, portrait);
            assert.ok(frameContains(walls, chip, 0), where);
            for (let other = 1; other <= 8; other += 1) {
              assert.equal(overlaps(chip, labelBoxOf(aisleLabelPlacement(other, portrait, false))), false, where);
            }
          }
        }
      }
    }
  }
});

test('on a wide screen the chip stays above the pin unless the route comes down the aisle from the back walkway', () => {
  const pinPoint = { x: milk.mapX, y: milk.mapY };
  const fromCorridor = pinLabelPlacement(pinPoint, false, false, {
    aisleNumber: milk.aisleNumber,
    routePoints: walkTo(milk.aisleNumber, pinPoint, 'corridor'),
  });
  assert.deepEqual(fromCorridor, pinLabelPlacement(pinPoint, false, false));
  assert.equal(fromCorridor.y, pinPoint.y - 28);
  const fromBack = pinLabelPlacement(pinPoint, false, false, {
    aisleNumber: milk.aisleNumber,
    routePoints: walkTo(milk.aisleNumber, pinPoint, 'back'),
  });
  assert.equal(fromBack.y, pinPoint.y + 28);
});

test('a same-aisle leg and an empty canvas stay inside the plan', () => {
  const frame = frameCurrentStop({
    portrait: true,
    aisleNumber: milk.aisleNumber,
    pin: { x: milk.mapX, y: milk.mapY },
    routePoints: [{ x: product('Greek Yogurt 500g').mapX, y: product('Greek Yogurt 500g').mapY }, { x: milk.mapX, y: milk.mapY }],
    ...phone,
  });
  const pin = drawnPoint({ x: milk.mapX, y: milk.mapY }, true);
  assert.ok(frameContains(frame, { x: pin.x - 4, y: pin.y - 4, width: 8, height: 8 }));
  assert.deepEqual(
    frameCurrentStop({ portrait: true, aisleNumber: 1, pin: { x: 99, y: 105 }, routePoints: [], viewportWidth: 0, viewportHeight: 0 }),
    fullMapFrame(true),
  );
});

test('when a product section is closed and no route is drawn, the product chip avoids covering the closed walkway', () => {
  // Milk sits at (525, 138); when Aisle 7 middle-to-back (541,151 -> 541,88)
  // is closed on a wide screen, placing the chip above the pin would cross
  // x=541 inside y=88..151, so it flips below the pin to leave the closure clear.
  const pinPoint = { x: milk.mapX, y: milk.mapY };
  const label = pinLabelPlacement(pinPoint, false, false, {
    aisleNumber: milk.aisleNumber,
    routePoints: [],
    blockedSegments: [[{ x: 541, y: 151 }, { x: 541, y: 88 }]],
  });
  assert.equal(label.y, pinPoint.y + 28);
});

/** Every walkway segment of the seeded store graph, in store coordinates. */
function storeWalkwaySegments(): [MapPoint, MapPoint][] {
  const aisleXs = Array.from({ length: 8 }, (_, index) => aisleCenterX(index + 1));
  const corridorXs = [...aisleXs, ENTRANCE_POINT.x].sort((a, b) => a - b);
  const segments: [MapPoint, MapPoint][] = [
    [ENTRANCE_POINT, { x: ENTRANCE_POINT.x, y: 240 }],
  ];
  for (let i = 1; i < corridorXs.length; i += 1) {
    segments.push([{ x: corridorXs[i - 1], y: 240 }, { x: corridorXs[i], y: 240 }]);
  }
  for (let i = 1; i < aisleXs.length; i += 1) {
    segments.push([{ x: aisleXs[i - 1], y: 55 }, { x: aisleXs[i], y: 55 }]);
  }
  const spineYs = [240, 215, 151, 88, 55];
  for (const x of aisleXs) {
    for (let i = 1; i < spineYs.length; i += 1) {
      segments.push([{ x, y: spineYs[i - 1] }, { x, y: spineYs[i] }]);
    }
  }
  return segments;
}

/**
 * Everywhere the YOU marker can be drawn: each walkway sampled every map
 * unit (a tap snaps onto one), plus the shelf spots a list trip continues
 * from after "Found it".
 */
function shopperSpots(): MapPoint[] {
  const spots: MapPoint[] = [];
  for (const [from, to] of storeWalkwaySegments()) {
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y));
    for (let step = 0; step <= steps; step += 1) {
      spots.push({ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps });
    }
  }
  for (let aisle = 1; aisle <= 8; aisle += 1) {
    for (const offset of [-14, 14]) {
      for (let y = 88; y <= 215; y += 1) spots.push({ x: aisleCenterX(aisle) + offset, y });
    }
  }
  return spots;
}

/** The dot (with its outline), the halo, and the YOU text of a tapped spot. */
function shopperMarkerCovers(box: DrawnBox, shopper: MapPoint, portrait: boolean): boolean {
  const nearestX = Math.min(Math.max(shopper.x, box.x), box.x + box.width);
  const nearestY = Math.min(Math.max(shopper.y, box.y), box.y + box.height);
  const insideHalo = Math.hypot(nearestX - shopper.x, nearestY - shopper.y) < SHOPPER_HALO_RADIUS;
  return insideHalo || overlaps(box, shopperNameBox(shopper, portrait));
}

test('the reported spot: YOU in the corridor at aisle 6 no longer sits on the AISLE 6 name', () => {
  const tapped = { x: 464, y: 240 };
  // Wide screen: the name used to start 7 units below the dot centre.
  const landscapeHome = aisleLabelPlacement(6, false, false);
  assert.equal(shopperMarkerCovers(aisleLabelInkBox(landscapeHome), tapped, false), true);
  const landscape = aisleLabelPlacement(6, false, false, { shopper: tapped });
  assert.equal(shopperMarkerCovers(aisleLabelInkBox(landscape), tapped, false), false);
  // It drops towards the entrance, still centred under its own aisle.
  assert.equal(landscape.x, landscapeHome.x);
  assert.equal(landscape.y, landscapeHome.y + 12);
  for (const other of [1, 2, 3, 4, 5, 7, 8]) {
    assert.deepEqual(aisleLabelPlacement(other, false, false, { shopper: tapped }), aisleLabelPlacement(other, false, false));
  }

  // Phone: the corridor is far from the names on the right, so nothing moves…
  const corridor = drawnPoint(tapped, true);
  for (let aisle = 1; aisle <= 8; aisle += 1) {
    assert.deepEqual(aisleLabelPlacement(aisle, true, false, { shopper: corridor }), aisleLabelPlacement(aisle, true, false));
  }
  // …but the back walkway runs straight through them.
  const back = drawnPoint({ x: 464, y: 55 }, true);
  const portraitHome = aisleLabelPlacement(6, true, false);
  assert.equal(shopperMarkerCovers(aisleLabelInkBox(portraitHome), back, true), true);
  const portrait = aisleLabelPlacement(6, true, false, { shopper: back });
  assert.equal(shopperMarkerCovers(aisleLabelInkBox(portrait), back, true), false);
  assert.equal(portrait.x, portraitHome.x);
  assert.equal(portrait.y, portraitHome.y + 30);
});

test('every aisle name stays readable wherever the YOU dot lands, on a phone or a wide screen', () => {
  const spots = shopperSpots();
  assert.ok(spots.length > 4000);
  for (const portrait of [false, true]) {
    const walls = drawnBox({ x: 15, y: 15, width: 670, height: 300 }, portrait);
    const entranceBar = drawnBox({ x: 235, y: 279, width: 220, height: 35 }, portrait);
    for (const focused of [false, true]) {
      const homes = Array.from({ length: 8 }, (_, index) => aisleLabelPlacement(index + 1, portrait, focused));
      let moved = 0;
      for (const spot of spots) {
        const shopper = drawnPoint(spot, portrait);
        const where = `${portrait ? 'portrait' : 'landscape'}${focused ? ' close-up' : ''} YOU at ${spot.x}, ${spot.y}`;
        const labels = homes.map((_, index) => aisleLabelPlacement(index + 1, portrait, focused, { shopper }));
        labels.forEach((label, index) => {
          const home = homes[index];
          const ink = aisleLabelInkBox(label);
          const aisle = `${where} aisle ${index + 1}`;
          // Neither the dot, its halo, nor the YOU text touches the name.
          assert.equal(shopperMarkerCovers(ink, shopper, portrait), false, aisle);
          assert.ok(aisleLabelClearance(label, shopper, portrait) >= 1.5, aisle);
          // A name moves only when the marker would cover it.
          if (aisleLabelClearance(home, shopper, portrait) >= 1.5) assert.deepEqual(label, home, aisle);
          else moved += 1;
          // It keeps its size and stays next to its own aisle, inside the
          // walls, and off the shelves, the corridor, and the entrance bar.
          assert.deepEqual({ ...label, x: home.x, y: home.y }, home, aisle);
          assert.ok(Math.abs(label.x - home.x) <= 18 && Math.abs(label.y - home.y) <= 36, aisle);
          assert.ok(frameContains(walls, ink, 0), aisle);
          assert.equal(overlaps(ink, entranceBar), false, aisle);
          if (portrait) assert.equal(label.x, home.x, aisle);
          else assert.ok(label.y >= home.y, aisle);
          for (let shelf = 1; shelf <= 8; shelf += 1) {
            assert.equal(overlaps(ink, drawnBox(shelfBlock(shelf), portrait)), false, aisle);
          }
        });
        // Names never run into each other while one steps aside.
        for (let i = 1; i < labels.length; i += 1) {
          assert.equal(overlaps(aisleLabelInkBox(labels[i - 1]), aisleLabelInkBox(labels[i])), false, where);
        }
      }
      assert.ok(moved > 0);
    }
  }
});

test('an aisle name that steps off the YOU dot does not land on the route line, and the chip still never covers it', () => {
  // Phone, standing on the back walkway at aisle 6: the route to aisle 7
  // runs down the walkway, the route to aisle 5 runs up it.
  const shopper = drawnPoint({ x: aisleCenterX(6), y: 55 }, true);
  const home = aisleLabelPlacement(6, true, false);
  for (const [towards, side] of [[7, -1], [5, 1]] as const) {
    const route = [
      { x: aisleCenterX(6), y: 55 },
      { x: aisleCenterX(towards), y: 55 },
      { x: aisleCenterX(towards), y: 151 },
    ].map((point) => drawnPoint(point, true));
    const label = aisleLabelPlacement(6, true, false, { shopper, routePoints: route });
    const ink = aisleLabelInkBox(label);
    assert.equal(shopperMarkerCovers(ink, shopper, true), false);
    // The name moves to the side of the dot the route does not leave from.
    assert.equal(Math.sign(label.y - home.y), side);
    assert.deepEqual(hiddenRoutePoints(ink, route), []);
  }

  // The chip rules hold for a name that moved, too.
  for (const portrait of [true, false]) {
    for (const spot of [{ x: 541, y: 55 }, { x: 541, y: 240 }, { x: 510, y: 240 }, { x: 541, y: 70 }]) {
      const pinPoint = { x: milk.mapX, y: milk.mapY };
      const pin = drawnPoint(pinPoint, portrait);
      const route = [spot, { x: 541, y: spot.y }, { x: 541, y: pinPoint.y }, pinPoint].map((point) => drawnPoint(point, portrait));
      const chip = pinLabelBoxOf(pinLabelPlacement(pin, portrait, false, { aisleNumber: milk.aisleNumber, routePoints: route }));
      for (let aisle = 1; aisle <= 8; aisle += 1) {
        const label = aisleLabelPlacement(aisle, portrait, false, { shopper: route[0], routePoints: route });
        assert.equal(overlaps(chip, labelBoxOf(label)), false);
      }
    }
  }
});

test('a phone close-up frames the aisle name where it is drawn when the shopper stands next to it', () => {
  // Tapped on the back walkway at aisle 7, heading for milk in aisle 7.
  const start = { x: aisleCenterX(7), y: 55 };
  const routePoints = [start, { x: aisleCenterX(7), y: milk.mapY }, { x: milk.mapX, y: milk.mapY }];
  const frame = frameCurrentStop({
    portrait: true,
    aisleNumber: milk.aisleNumber,
    pin: { x: milk.mapX, y: milk.mapY },
    routePoints,
    manualStart: true,
    start,
    ...phone,
  });
  const shopper = drawnPoint(start, true);
  const label = aisleLabelPlacement(7, true, true, { shopper, routePoints: routePoints.map((point) => drawnPoint(point, true)) });
  assert.notDeepEqual(label, aisleLabelPlacement(7, true, true));
  assert.equal(shopperMarkerCovers(aisleLabelInkBox(label), shopper, true), false);
  assert.ok(frameContains(frame, labelBoxOf(label)));
  assert.ok(frameContains(frame, startMarkerBox(shopper, true, true)));
});

test('walkEdgeTapBox gives every store walkway segment a distinct, non-overlapping tap target in landscape and portrait', () => {
  const segments = storeWalkwaySegments();
  assert.equal(segments.length, 48);

  for (const portrait of [false, true]) {
    const boxes = segments.map(([from, to]) => walkEdgeTapBox(from, to, portrait));
    for (let i = 0; i < boxes.length; i += 1) {
      assert.ok(boxes[i].width >= 12 && boxes[i].height >= 12);
      for (let j = i + 1; j < boxes.length; j += 1) {
        assert.equal(
          overlaps(boxes[i], boxes[j]),
          false,
          `${portrait ? 'portrait' : 'landscape'} segment ${i} overlaps segment ${j}`,
        );
      }
    }
  }
});
