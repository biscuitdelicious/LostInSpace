import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FALLBACK_PRODUCTS } from './products';
import { ENTRANCE_POINT } from './route';
import { EMPTY_SHOPPING_STATE, shoppingReducer, type ShoppingState } from './shopping-list';
import {
  SHOPPER_POSITION_MAX_AGE_MS,
  SHOPPING_STORAGE_KEY,
  isShopperPositionFresh,
  loadShopperPosition,
  loadShoppingState,
  saveShoppingState,
  shoppingFromSaved,
} from './shopping-storage';

const product = (name: string) => {
  const item = FALLBACK_PRODUCTS.find(entry => entry.name === name);
  assert.ok(item);
  return item;
};

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

function ready(state: ShoppingState): ShoppingState {
  assert.ok(state.trip);
  const trip = state.trip;
  return shoppingReducer(state, {
    type: 'applyRoutePlan',
    currentIndex: 0,
    productIds: trip.stops.map(stop => stop.product.id),
    start: trip.start,
    stops: trip.stops.map(stop => ({
      ...stop,
      routeStatus: 'ready',
      route: { points: [trip.start, { x: stop.product.mapX, y: stop.product.mapY }], path: '', distanceMeters: 10 },
    })),
  });
}

test('a saved list and current stop return with fresh routes pending, never stale path data', () => {
  const milk = product('Whole Milk 1L');
  const bread = product('Sourdough Bread');
  const water = product('Sparkling Mineral Water');
  let state = [milk, bread, water].reduce((current, item) => shoppingReducer(current, { type: 'add', product: item }), EMPTY_SHOPPING_STATE);
  state = shoppingReducer(state, { type: 'start', position: ENTRANCE_POINT });
  state = ready(state);
  state = shoppingReducer(state, { type: 'found' });
  const store = memory();
  saveShoppingState(state, store);
  const restored = loadShoppingState(store);
  assert.equal(store.getItem(SHOPPING_STORAGE_KEY)?.includes('"route":'), false);
  assert.deepEqual(restored.items.map(item => item.id), [bread.id, water.id]);
  assert.equal(restored.trip?.currentIndex, 1);
  assert.deepEqual(restored.trip?.stops.map(stop => stop.product.id), [milk.id, bread.id, water.id]);
  // The next leg resumes from the shelf the shopper just reached.
  assert.deepEqual(restored.trip?.start, { x: milk.mapX, y: milk.mapY });
  assert.ok(restored.trip?.stops.every(stop => stop.route === null && stop.routeStatus === 'pending'));
});

test('corrupt storage and a missing store do not invent a list', () => {
  const store = memory();
  store.setItem(SHOPPING_STORAGE_KEY, '{not json');
  assert.deepEqual(loadShoppingState(store), EMPTY_SHOPPING_STATE);
  assert.deepEqual(loadShoppingState(null), EMPTY_SHOPPING_STATE);
  assert.deepEqual(shoppingFromSaved({ items: [{ id: 'nope' }], trip: null, completedCount: 2 }), { ...EMPTY_SHOPPING_STATE, completedCount: 2 });
});

test('a pending Not here report and an older saved route both load safely', () => {
  const coffee = product('Roasted Arabica Coffee');
  const seenAt = { aisleLocation: 'Aisle 3, left, top shelf', aisleNumber: 3, mapX: 219, mapY: 108 };
  let state = shoppingReducer(EMPTY_SHOPPING_STATE, { type: 'add', product: coffee });
  state = shoppingReducer(state, { type: 'start', position: ENTRANCE_POINT });
  state = shoppingReducer(state, { type: 'report', productId: coffee.id, reportId: 12, seenAt });
  const store = memory();
  saveShoppingState(state, store);
  const restored = loadShoppingState(store);
  assert.deepEqual(restored.reports, { [coffee.id]: { reportId: 12, seenAt } });
  assert.equal(restored.trip?.stops[0].product.aisleNumber, 3);
  assert.equal(restored.trip?.stops[0].route, null);

  const legacy = shoppingFromSaved({ items: [coffee], trip: { products: [coffee], currentIndex: 0 }, completedCount: null }, ENTRANCE_POINT);
  assert.deepEqual(legacy.trip?.start, ENTRANCE_POINT);
  assert.equal(legacy.trip?.stops[0].routeStatus, 'pending');
  assert.deepEqual(shoppingFromSaved({ items: [coffee], trip: null, completedCount: null }).reports, {});
  assert.deepEqual(shoppingFromSaved({ items: [coffee], trip: null, completedCount: null, reports: { 7: { reportId: 'x', seenAt }, nope: { reportId: 1, seenAt } } }).reports, {});
});

test('the manually tapped position persists within an hour and defaults to null when absent or invalid', () => {
  const store = memory();
  const position = { x: 464, y: 240 };
  const t0 = 1_700_000_000_000;
  saveShoppingState(EMPTY_SHOPPING_STATE, store, position, t0);
  assert.deepEqual(loadShopperPosition(store, t0), position);
  assert.deepEqual(loadShopperPosition(store, t0 + SHOPPER_POSITION_MAX_AGE_MS), position);
  assert.equal(loadShopperPosition(store, t0 + SHOPPER_POSITION_MAX_AGE_MS + 1), null);
  assert.deepEqual(loadShoppingState(store, t0), EMPTY_SHOPPING_STATE);

  saveShoppingState(EMPTY_SHOPPING_STATE, store, null, t0);
  assert.equal(loadShopperPosition(store, t0), null);
  store.setItem(SHOPPING_STORAGE_KEY, JSON.stringify({ items: [], trip: null, completedCount: null, shopperPosition: position }));
  assert.equal(loadShopperPosition(store, t0), null);
  store.setItem(SHOPPING_STORAGE_KEY, JSON.stringify({ items: [], trip: null, completedCount: null, shopperPosition: { x: 'bad', y: 20 }, lastActiveAt: t0 }));
  assert.equal(loadShopperPosition(store, t0), null);
  store.setItem(SHOPPING_STORAGE_KEY, '{broken');
  assert.equal(loadShopperPosition(store, t0), null);
  assert.equal(isShopperPositionFresh(t0, t0 + SHOPPER_POSITION_MAX_AGE_MS), true);
  assert.equal(isShopperPositionFresh(t0, t0 + SHOPPER_POSITION_MAX_AGE_MS + 1), false);
  assert.equal(isShopperPositionFresh(undefined, t0), false);
});

test('a finished trip or an hour away forgets the in-store start while keeping saved list items', () => {
  const milk = product('Whole Milk 1L');
  const bread = product('Sourdough Bread');
  const tapped = { x: 156, y: 55 };
  const t0 = 1_700_000_000_000;
  const store = memory();

  // Finishing a trip never saves or restores a tapped spot.
  const finished: ShoppingState = { ...EMPTY_SHOPPING_STATE, completedCount: 2 };
  saveShoppingState(finished, store, tapped, t0);
  assert.equal(loadShopperPosition(store, t0), null);
  assert.equal(store.getItem(SHOPPING_STORAGE_KEY)?.includes('shopperPosition'), false);

  // Coming back after more than an hour keeps the saved list items, forgets
  // the tapped spot, and resets any unfinished trip origin to the entrance.
  let active = shoppingReducer(EMPTY_SHOPPING_STATE, { type: 'add', product: milk });
  active = shoppingReducer(active, { type: 'add', product: bread });
  active = shoppingReducer(active, { type: 'start', position: tapped });
  active = ready(active);
  saveShoppingState(active, store, tapped, t0);

  const withinHour = loadShoppingState(store, t0 + 30 * 60 * 1000);
  assert.deepEqual(loadShopperPosition(store, t0 + 30 * 60 * 1000), tapped);
  assert.deepEqual(withinHour.trip?.start, tapped);

  const nextDay = t0 + SHOPPER_POSITION_MAX_AGE_MS + 1;
  assert.equal(loadShopperPosition(store, nextDay), null);
  const restoredNextDay = loadShoppingState(store, nextDay);
  assert.deepEqual(restoredNextDay.items.map(item => item.id), [milk.id, bread.id]);
  assert.deepEqual(restoredNextDay.trip?.start, { x: 0, y: 0 });
  assert.equal(restoredNextDay.trip?.routeStarted, false);
});