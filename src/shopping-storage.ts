import type { StoreProduct } from './products';
import type { MapPoint } from './route';
import type { ProductPlace, ShopperReport, ShoppingState, ShoppingTrip } from './shopping-list';
import { EMPTY_SHOPPING_STATE, pendingShoppingStop } from './shopping-list';

export const SHOPPING_STORAGE_KEY = 'lis.shopping-list';
/** Forget a tapped in-store spot once the app has been closed or idle for over an hour. */
export const SHOPPER_POSITION_MAX_AGE_MS = 60 * 60 * 1000;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type SavedShopping = {
  items: StoreProduct[];
  trip: { products: StoreProduct[]; currentIndex: number; start?: MapPoint; routeStarted?: boolean } | null;
  completedCount: number | null;
  reports?: Record<string, ShopperReport>;
  /** Last manually tapped shopper position; absent means the entrance. */
  shopperPosition?: MapPoint;
  /** Epoch ms when the shopper last had the app open; expires in-store position after an hour. */
  lastActiveAt?: number;
};

export function isShopperPositionFresh(lastActiveAt: unknown, now = Date.now()): boolean {
  return typeof lastActiveAt === 'number'
    && Number.isFinite(lastActiveAt)
    && lastActiveAt <= now + 60_000
    && now - lastActiveAt <= SHOPPER_POSITION_MAX_AGE_MS;
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Browsers answer synchronously through `localStorage`. A phone has no
 * `localStorage`, so a native build keeps the list in AsyncStorage instead,
 * loaded once on startup and written back after every change.
 *
 * This file deliberately does not import `react-native`: plain Node (the
 * unit tests) cannot load it, and the two cases can be told apart by
 * looking at the globals — a browser has `localStorage`, React Native has
 * `window` but no `localStorage`, and Node has neither.
 */
type AsyncStorageLike = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

async function deviceStorage(): Promise<AsyncStorageLike | null> {
  if (browserStorage()) return null; // web already saved through localStorage
  if (typeof window === 'undefined') return null; // plain Node, nothing to read
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    return AsyncStorage;
  } catch {
    return null;
  }
}

function isPlace(value: unknown): value is ProductPlace {
  if (!value || typeof value !== 'object') return false;
  const place = value as ProductPlace;
  return typeof place.aisleLocation === 'string'
    && Number.isFinite(place.aisleNumber)
    && Number.isFinite(place.mapX)
    && Number.isFinite(place.mapY);
}

function isProduct(value: unknown): value is StoreProduct {
  if (!isPlace(value)) return false;
  const item = value as StoreProduct;
  return Number.isInteger(item.id)
    && item.id > 0
    && typeof item.name === 'string'
    && item.name.trim().length > 0
    && typeof item.category === 'string';
}

function readReports(value: unknown): Record<number, ShopperReport> {
  const reports: Record<number, ShopperReport> = {};
  if (!value || typeof value !== 'object') return reports;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const productId = Number(key);
    const report = entry as Partial<ShopperReport> | null;
    if (!Number.isInteger(productId) || productId < 1 || !report) continue;
    if (!Number.isInteger(report.reportId) || !isPlace(report.seenAt)) continue;
    const { aisleLocation, aisleNumber, mapX, mapY } = report.seenAt;
    reports[productId] = { reportId: report.reportId as number, seenAt: { aisleLocation, aisleNumber, mapX, mapY } };
  }
  return reports;
}

function rebuildTrip(products: StoreProduct[], currentIndex: number, start: MapPoint, routeStarted: boolean): ShoppingTrip | null {
  if (!products.length) return null;
  const index = Math.min(Math.max(0, Math.floor(currentIndex)), products.length - 1);
  // Saved routes are never trusted: the app asks the backend for fresh
  // walks as soon as it loads, because staff may have closed a path.
  return { stops: products.map(pendingShoppingStop), currentIndex: index, start, routeStarted };
}

export function shoppingToSaved(state: ShoppingState, shopperPosition?: MapPoint | null, lastActiveAt = Date.now()): SavedShopping {
  const activePosition = state.completedCount !== null ? null : shopperPosition;
  const trackActivity = Boolean(activePosition || state.trip);
  return {
    items: state.items,
    trip: state.trip
      ? {
          products: state.trip.stops.map((stop) => stop.product),
          currentIndex: state.trip.currentIndex,
          start: state.trip.start,
          routeStarted: state.trip.routeStarted,
        }
      : null,
    completedCount: state.completedCount,
    reports: state.reports,
    ...(activePosition ? { shopperPosition: activePosition } : {}),
    ...(trackActivity ? { lastActiveAt } : {}),
  };
}

export function shoppingFromSaved(saved: unknown, start?: MapPoint, now = Date.now()): ShoppingState {
  if (!saved || typeof saved !== 'object') return EMPTY_SHOPPING_STATE;
  const value = saved as Partial<SavedShopping>;
  const items = Array.isArray(value.items) ? value.items.filter(isProduct) : [];
  const tripValue = value.trip;
  const products = tripValue && Array.isArray(tripValue.products) ? tripValue.products.filter(isProduct) : [];
  const currentIndex = tripValue && typeof tripValue.currentIndex === 'number' ? tripValue.currentIndex : 0;
  const hasTrackedSession = value.lastActiveAt !== undefined || value.shopperPosition !== undefined;
  const expired = hasTrackedSession && !isShopperPositionFresh(value.lastActiveAt, now);
  const savedStart = !expired ? tripValue?.start : undefined;
  const tripStart = savedStart && Number.isFinite(savedStart.x) && Number.isFinite(savedStart.y)
    ? savedStart
    : start ?? { x: 0, y: 0 };
  const routeStarted = expired ? false : (tripValue?.routeStarted ?? true);
  const trip = products.length ? rebuildTrip(products, currentIndex, tripStart, routeStarted) : null;
  const completedCount = typeof value.completedCount === 'number' && value.completedCount > 0
    ? value.completedCount
    : null;
  return { items, trip, completedCount, reports: readReports(value.reports) };
}

export function loadShoppingState(storage: StorageLike | null = browserStorage(), now = Date.now()): ShoppingState {
  if (!storage) return EMPTY_SHOPPING_STATE;
  try {
    const raw = storage.getItem(SHOPPING_STORAGE_KEY);
    if (!raw) return EMPTY_SHOPPING_STATE;
    return shoppingFromSaved(JSON.parse(raw), undefined, now);
  } catch {
    return EMPTY_SHOPPING_STATE;
  }
}

export function saveShoppingState(
  state: ShoppingState,
  storage: StorageLike | null = browserStorage(),
  shopperPosition?: MapPoint | null,
  lastActiveAt = Date.now(),
): void {
  if (!storage) return;
  try {
    storage.setItem(SHOPPING_STORAGE_KEY, JSON.stringify(shoppingToSaved(state, shopperPosition, lastActiveAt)));
  } catch {
    // A full store should not interrupt shopping.
  }
}

function savedPosition(raw: string | null, now = Date.now()): MapPoint | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedShopping>;
    if (typeof parsed.completedCount === 'number' && parsed.completedCount > 0) return null;
    if (!isShopperPositionFresh(parsed.lastActiveAt, now)) return null;
    const value = parsed.shopperPosition;
    return value && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: value.x, y: value.y }
      : null;
  } catch {
    return null;
  }
}

/** The manual position survives a reload within an hour while a trip is unfinished. */
export function loadShopperPosition(storage: StorageLike | null = browserStorage(), now = Date.now()): MapPoint | null {
  if (!storage) return null;
  try {
    return savedPosition(storage.getItem(SHOPPING_STORAGE_KEY), now);
  } catch {
    return null;
  }
}

/**
 * The same list on a phone. Reading it is asynchronous, so the app starts
 * empty and fills in from here as soon as the storage answers; writing
 * failures are ignored, just like a full store.
 */
export async function loadShoppingStateAsync(now = Date.now()): Promise<ShoppingState> {
  const storage = await deviceStorage();
  if (!storage) return EMPTY_SHOPPING_STATE;
  try {
    const raw = await storage.getItem(SHOPPING_STORAGE_KEY);
    if (!raw) return EMPTY_SHOPPING_STATE;
    return shoppingFromSaved(JSON.parse(raw), undefined, now);
  } catch {
    return EMPTY_SHOPPING_STATE;
  }
}

export async function saveShoppingStateAsync(
  state: ShoppingState,
  shopperPosition?: MapPoint | null,
  lastActiveAt = Date.now(),
): Promise<void> {
  const storage = await deviceStorage();
  if (!storage) return;
  try {
    await storage.setItem(SHOPPING_STORAGE_KEY, JSON.stringify(shoppingToSaved(state, shopperPosition, lastActiveAt)));
  } catch {
    // A full store should not interrupt shopping.
  }
}

export async function loadShopperPositionAsync(now = Date.now()): Promise<MapPoint | null> {
  const storage = await deviceStorage();
  if (!storage) return null;
  try {
    return savedPosition(await storage.getItem(SHOPPING_STORAGE_KEY), now);
  } catch {
    return null;
  }
}