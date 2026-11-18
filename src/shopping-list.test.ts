import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FALLBACK_PRODUCTS } from './products';
import { ENTRANCE_POINT, aisleCenterX, type MapPoint } from './route';
import {
  EMPTY_SHOPPING_STATE,
  productForShopper,
  remainingTripDistance,
  shoppingReducer,
  type ShoppingState,
  type ShoppingStop,
} from './shopping-list';

function product(name: string) {
  const item = FALLBACK_PRODUCTS.find(p => p.name === name);
  assert.ok(item);
  return item;
}
const milk = product('Whole Milk 1L');
const bread = product('Sourdough Bread');
const water = product('Sparkling Mineral Water');
const coffee = product('Roasted Arabica Coffee');
const aisle3 = { aisleLocation: 'Aisle 3, left, top shelf', aisleNumber: 3, mapX: aisleCenterX(3) - 14, mapY: 108 };
const movedCoffee = { ...coffee, ...aisle3 };

function list(...items: typeof milk[]) {
  return items.reduce((state, item) => shoppingReducer(state, { type: 'add', product: item }), EMPTY_SHOPPING_STATE);
}

function start(items: typeof milk[]): ShoppingState {
  return shoppingReducer(list(...items), { type: 'start', position: ENTRANCE_POINT });
}

/** A server-shaped answer, used to test reducer behaviour without path finding. */
function applyPlan(state: ShoppingState, orderedIds?: number[], closedIds: number[] = []): ShoppingState {
  assert.ok(state.trip);
  const trip = state.trip;
  const remaining = trip.stops.slice(trip.currentIndex);
  const byId = new Map(remaining.map(stop => [stop.product.id, stop.product]));
  const ids = orderedIds ?? remaining.map(stop => stop.product.id);
  let from: MapPoint = trip.start;
  const stops: ShoppingStop[] = ids.map(id => {
    const item = byId.get(id);
    assert.ok(item);
    const closed = closedIds.includes(id);
    const points = [{ ...from }, { x: item.mapX, y: item.mapY }];
    from = { x: item.mapX, y: item.mapY };
    return {
      product: item,
      route: closed ? null : { points, path: `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`, distanceMeters: 10 },
      routeStatus: closed ? 'closed' : 'ready',
    };
  });
  return shoppingReducer(state, {
    type: 'applyRoutePlan',
    currentIndex: trip.currentIndex,
    productIds: remaining.map(stop => stop.product.id),
    stops,
    start: trip.start,
  });
}

test('start deduplicates items and waits for backend routes instead of inventing a path', () => {
  const state = start([milk, milk, bread]);
  assert.deepEqual(state.trip?.stops.map(stop => stop.product.id), [milk.id, bread.id]);
  assert.ok(state.trip?.stops.every(stop => stop.route === null && stop.routeStatus === 'pending'));
  assert.equal(state.trip?.routeStarted, false);
  assert.equal(shoppingReducer(EMPTY_SHOPPING_STATE, { type: 'start', position: ENTRANCE_POINT }).trip, null);
  assert.deepEqual(shoppingReducer(state, { type: 'remove', id: milk.id }), state); // frozen while routing
});

test('a backend answer supplies the walking order and every leg starts at the previous stop', () => {
  const state = applyPlan(start([bread, water, milk]), [water.id, milk.id, bread.id]);
  assert.deepEqual(state.trip?.stops.map(stop => stop.product.id), [water.id, milk.id, bread.id]);
  assert.equal(state.trip?.routeStarted, true);
  assert.ok(state.trip?.stops.every(stop => stop.routeStatus === 'ready'));
  assert.deepEqual(state.trip?.stops[1].route?.points[0], { x: water.mapX, y: water.mapY });
  assert.equal(remainingTripDistance(state.trip!), 30);
});

test('Found it requires a ready leg, advances one stop, and completes the last', () => {
  let state = start([milk, bread, water]);
  assert.equal(shoppingReducer(state, { type: 'found' }), state); // cannot advance while pending
  state = applyPlan(state);
  const first = state.trip!.stops[0];
  state = shoppingReducer(state, { type: 'found' });
  assert.equal(state.trip?.currentIndex, 1);
  assert.equal(state.items.some(item => item.id === first.product.id), false);
  assert.equal(remainingTripDistance(state.trip!), 20);
  state = shoppingReducer(state, { type: 'found' });
  state = shoppingReducer(state, { type: 'found' });
  assert.equal(state.trip, null);
  assert.deepEqual(state.items, []);
  assert.equal(state.completedCount, 3);
  assert.equal(shoppingReducer(state, { type: 'dismissCompletion' }).completedCount, null);
});

test('a closed current stop has no path and cannot be marked found', () => {
  let state = applyPlan(start([milk, bread]), undefined, [milk.id]);
  const current = state.trip!.stops[0];
  assert.equal(current.routeStatus, 'closed');
  assert.equal(current.route, null);
  assert.equal(shoppingReducer(state, { type: 'found' }), state);
  state = applyPlan(state); // reopened by a later response
  state = shoppingReducer(state, { type: 'found' });
  assert.equal(state.trip?.currentIndex, 1);
});

test('End retains unfinished items and restarting excludes those already found', () => {
  let state = applyPlan(start([bread, milk, water]));
  state = shoppingReducer(state, { type: 'found' });
  state = shoppingReducer(state, { type: 'end' });
  assert.equal(state.trip, null);
  assert.deepEqual(state.items.map(item => item.id), [milk.id, water.id]);
  state = shoppingReducer(state, { type: 'start', position: ENTRANCE_POINT });
  assert.equal(state.trip?.stops.length, 2);
});

test('a saved list picks up confirmed moves and unchanged products keep identity', () => {
  const state = list(bread, coffee);
  assert.equal(shoppingReducer(state, { type: 'sync', catalogue: FALLBACK_PRODUCTS }), state);
  const catalogue = FALLBACK_PRODUCTS.map(item => (item.id === coffee.id ? movedCoffee : item));
  const synced = shoppingReducer(state, { type: 'sync', catalogue });
  assert.deepEqual(synced.items, [bread, movedCoffee]);
  assert.equal(synced.items[0], bread);
  assert.equal(shoppingReducer(synced, { type: 'start', position: ENTRANCE_POINT }).trip?.stops[1].product.aisleNumber, 3);
});

test('a move during a route keeps the current target and invalidates only unfinished legs', () => {
  let state = applyPlan(start([water, milk, coffee, bread]));
  state = shoppingReducer(state, { type: 'found' });
  const before = state.trip!;
  const movedBread = { ...bread, aisleLocation: 'Aisle 6, right, top shelf', aisleNumber: 6, mapX: aisleCenterX(6) + 14, mapY: 105 };
  const synced = shoppingReducer(state, { type: 'sync', catalogue: [movedBread] });
  assert.equal(synced.trip?.stops[0], before.stops[0]); // already found
  assert.equal(synced.trip?.stops[1].product, milk); // current target stays
  assert.equal(synced.trip?.stops[3].product, movedBread);
  assert.ok(synced.trip?.stops.slice(1).every(stop => stop.route === null && stop.routeStatus === 'pending'));
  const replanned = applyPlan(synced, [milk.id, movedBread.id, coffee.id]);
  assert.deepEqual(replanned.trip?.stops.map(stop => stop.product.aisleNumber), [8, 7, 6, 5]);
});

test('a stale backend response cannot overwrite a newer route or a later stop', () => {
  let state = applyPlan(start([milk, bread]));
  const firstResponse = {
    type: 'applyRoutePlan' as const,
    currentIndex: 0,
    productIds: [milk.id, bread.id],
    stops: state.trip!.stops,
    start: ENTRANCE_POINT,
  };
  state = shoppingReducer(state, { type: 'found' });
  assert.equal(shoppingReducer(state, firstResponse), state);
  const replan = shoppingReducer(state, { type: 'replan' });
  assert.ok(replan.trip?.stops.slice(1).every(stop => stop.routeStatus === 'pending'));
  const failed = shoppingReducer(replan, { type: 'routePlanFailed', currentIndex: 1, productIds: [bread.id] });
  assert.equal(failed.trip?.stops[1].routeStatus, 'unavailable');
  assert.equal(failed.trip?.stops[1].route, null);
});

test('Not here uses the reported place until staff decide, with routes refreshed by the backend', () => {
  let state = applyPlan(start([coffee, bread]));
  state = shoppingReducer(state, { type: 'report', productId: coffee.id, reportId: 41, seenAt: aisle3 });
  assert.deepEqual(state.trip?.stops[0].product, movedCoffee);
  assert.equal(state.trip?.stops[0].routeStatus, 'pending');
  assert.deepEqual(state.items.find(item => item.id === coffee.id), movedCoffee);
  assert.equal(shoppingReducer(state, { type: 'sync', catalogue: FALLBACK_PRODUCTS }), state);
  const confirmed = shoppingReducer(state, { type: 'sync', catalogue: FALLBACK_PRODUCTS.map(item => item.id === coffee.id ? movedCoffee : item), decidedReportIds: [41] });
  assert.deepEqual(confirmed.reports, {});
  assert.equal(confirmed.trip?.stops[0].product.aisleNumber, 3);
  const rejected = shoppingReducer(state, { type: 'sync', catalogue: FALLBACK_PRODUCTS, decidedReportIds: [41] });
  assert.deepEqual(rejected.trip?.stops[0].product, coffee);
  assert.equal(rejected.trip?.stops[0].route, null);
});

test('a newer report is not dropped when an older one is decided', () => {
  let state = shoppingReducer(list(coffee), { type: 'report', productId: coffee.id, reportId: 41, seenAt: aisle3 });
  const aisle2 = { aisleLocation: 'Aisle 2, right, bottom shelf', aisleNumber: 2, mapX: aisleCenterX(2) + 14, mapY: 190 };
  state = shoppingReducer(state, { type: 'report', productId: coffee.id, reportId: 42, seenAt: aisle2 });
  const synced = shoppingReducer(state, { type: 'sync', catalogue: FALLBACK_PRODUCTS, decidedReportIds: [41] });
  assert.equal(synced, state);
  assert.equal(synced.reports[coffee.id].reportId, 42);
  assert.deepEqual(productForShopper(coffee, FALLBACK_PRODUCTS, state.reports).aisleNumber, 2);
});

test('a manual position replaces the current trip origin and rejects stale route answers', () => {
  let state = applyPlan(start([water, milk, bread]));
  const tapped = { x: 464, y: 240 };
  const moved = shoppingReducer(state, { type: 'relocate', position: tapped });
  assert.deepEqual(moved.trip?.start, tapped);
  assert.deepEqual(moved.trip?.stops.map(stop => stop.product.id), state.trip?.stops.map(stop => stop.product.id));
  assert.ok(moved.trip?.stops.every(stop => stop.route === null && stop.routeStatus === 'pending'));
  assert.equal(moved.trip?.routeStarted, true);

  const stale = shoppingReducer(state, { type: 'relocate', position: tapped });
  assert.equal(shoppingReducer(stale, {
    type: 'applyRoutePlan',
    currentIndex: 0,
    productIds: stale.trip!.stops.map(stop => stop.product.id),
    stops: state.trip!.stops,
    start: ENTRANCE_POINT,
  }), stale);

  const planned = shoppingReducer(moved, {
    type: 'applyRoutePlan',
    currentIndex: 0,
    productIds: moved.trip!.stops.map(stop => stop.product.id),
    stops: moved.trip!.stops.map(stop => ({
      ...stop,
      route: { points: [tapped, { x: stop.product.mapX, y: stop.product.mapY }], path: '', distanceMeters: 10 },
      routeStatus: 'ready',
    })),
    start: tapped,
  });
  assert.equal(planned.trip?.stops[0].routeStatus, 'ready');
});

test('a legacy saved trip without an origin accepts its first fresh backend route', () => {
  const initial = start([milk]);
  const legacy: ShoppingState = {
    ...initial,
    trip: { ...initial.trip!, start: { x: 0, y: 0 } },
  };
  const restored = shoppingReducer(legacy, {
    type: 'applyRoutePlan',
    currentIndex: 0,
    productIds: [milk.id],
    start: ENTRANCE_POINT,
    stops: [{
      product: milk,
      route: { points: [ENTRANCE_POINT, { x: milk.mapX, y: milk.mapY }], path: '', distanceMeters: 34.2 },
      routeStatus: 'ready',
    }],
  });
  assert.equal(restored.trip?.stops[0].routeStatus, 'ready');
  assert.deepEqual(restored.trip?.start, ENTRANCE_POINT);
});

test('Found it makes the reached shelf the next leg origin', () => {
  let state = applyPlan(start([milk, bread]));
  const first = state.trip!.stops[0].product;
  state = shoppingReducer(state, { type: 'found' });
  assert.deepEqual(state.trip?.start, { x: first.mapX, y: first.mapY });
  assert.equal(state.trip?.currentIndex, 1);
});