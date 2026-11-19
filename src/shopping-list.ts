import type { StoreProduct } from './products';
import type { MapPoint, ProductRoute } from './route';

export type ShoppingRouteStatus = 'pending' | 'ready' | 'closed' | 'unavailable';
export type ShoppingStop = {
  product: StoreProduct;
  /** Only a backend-planned, currently walkable route is ever drawn. */
  route: ProductRoute | null;
  routeStatus: ShoppingRouteStatus;
};
export type ShoppingTrip = {
  stops: ShoppingStop[];
  currentIndex: number;
  start: MapPoint;
  /** False only before the initial optimised list answer arrives. */
  routeStarted: boolean;
};

/** Where a product is on the map. */
export type ProductPlace = Pick<StoreProduct, 'aisleLocation' | 'aisleNumber' | 'mapX' | 'mapY'>;

/** This shopper's undecided "Not here" report. */
export type ShopperReport = { reportId: number; seenAt: ProductPlace };

export type ShoppingState = {
  items: StoreProduct[];
  trip: ShoppingTrip | null;
  completedCount: number | null;
  reports: Record<number, ShopperReport>;
};

export const EMPTY_SHOPPING_STATE: ShoppingState = {
  items: [],
  trip: null,
  completedCount: null,
  reports: {},
};

export function pendingShoppingStop(product: StoreProduct): ShoppingStop {
  return { product, route: null, routeStatus: 'pending' };
}

export function remainingTripDistance(trip: ShoppingTrip): number {
  return trip.stops
    .slice(trip.currentIndex)
    .reduce((sum, stop) => sum + (stop.route?.distanceMeters ?? 0), 0);
}

function samePlace(a: ProductPlace, b: ProductPlace): boolean {
  return a.aisleLocation === b.aisleLocation && a.aisleNumber === b.aisleNumber && a.mapX === b.mapX && a.mapY === b.mapY;
}

function sameProduct(a: StoreProduct, b: StoreProduct): boolean {
  return a.id === b.id && a.name === b.name && a.category === b.category && samePlace(a, b);
}

/** Forget only the reports staff decided, by report id. */
export function dropReports(reports: Record<number, ShopperReport>, reportIds: number[]): Record<number, ShopperReport> {
  const decided = Object.entries(reports).filter(([, report]) => reportIds.includes(report.reportId));
  if (!decided.length) return reports;
  const next = { ...reports };
  for (const [productId] of decided) delete next[Number(productId)];
  return next;
}

/**
 * Keep the previous object when a refresh produced the same product data.
 * Route planning reacts to this object's identity, so handing back a fresh
 * object for unchanged data would replan the route over and over.
 */
export function keepStableProduct(
  previous: StoreProduct | null,
  next: StoreProduct | null,
): StoreProduct | null {
  return previous && next && sameProduct(previous, next) ? previous : next;
}

/** Latest store location, with this shopper's undecided report on top. */
export function productForShopper(
  product: StoreProduct,
  catalogue: StoreProduct[],
  reports: Record<number, ShopperReport>,
): StoreProduct {
  const latest = catalogue.find(item => item.id === product.id) ?? product;
  const report = reports[product.id];
  const next = report ? { ...latest, ...report.seenAt } : latest;
  return sameProduct(next, product) ? product : next;
}

function updateItems(items: StoreProduct[], update: (product: StoreProduct) => StoreProduct): StoreProduct[] {
  const next = items.map(update);
  return next.some((item, index) => item !== items[index]) ? next : items;
}

/**
 * Products may move while a trip is running. Keep the current target, apply
 * the new shelf positions, and mark unfinished legs pending until the
 * backend returns fresh Dijkstra routes and a walking order.
 */
function updateTrip(
  trip: ShoppingTrip,
  update: (product: StoreProduct) => StoreProduct,
  force = false,
): ShoppingTrip {
  const { stops, currentIndex } = trip;
  const current = stops[currentIndex];
  const later = stops.slice(currentIndex + 1);
  const nextCurrent = update(current.product);
  const nextLater = later.map(stop => update(stop.product));
  if (
    !force &&
    nextCurrent === current.product &&
    nextLater.every((product, index) => product === later[index].product)
  ) {
    return trip;
  }
  return {
    ...trip,
    stops: [
      ...stops.slice(0, currentIndex),
      pendingShoppingStop(nextCurrent),
      ...nextLater.map(pendingShoppingStop),
    ],
  };
}

function updateProducts(
  state: ShoppingState,
  reports: Record<number, ShopperReport>,
  update: (product: StoreProduct) => StoreProduct,
): ShoppingState {
  const items = updateItems(state.items, update);
  const trip = state.trip ? updateTrip(state.trip, update) : null;
  if (items === state.items && trip === state.trip && reports === state.reports) return state;
  return { ...state, items, trip, reports };
}

function planMatches(trip: ShoppingTrip, action: { currentIndex: number; productIds: number[]; start?: MapPoint }): boolean {
  if (trip.currentIndex !== action.currentIndex) return false;
  // Older saved trips used (0,0) as "use the current route origin". Their
  // first fresh backend answer supplies that origin and must not be rejected.
  const hasSavedOrigin = trip.start.x !== 0 || trip.start.y !== 0;
  if (action.start && hasSavedOrigin && (Math.abs(trip.start.x - action.start.x) > 0.01 || Math.abs(trip.start.y - action.start.y) > 0.01)) return false;
  const remaining = trip.stops.slice(trip.currentIndex);
  return remaining.length === action.productIds.length
    && remaining.every((stop, index) => stop.product.id === action.productIds[index]);
}

export type ShoppingAction =
  | { type: 'add'; product: StoreProduct }
  | { type: 'remove'; id: number }
  | { type: 'start'; position: MapPoint }
  | { type: 'relocate'; position: MapPoint }
  | { type: 'found' }
  | { type: 'end' }
  | { type: 'dismissCompletion' }
  | { type: 'report'; productId: number; reportId: number; seenAt: ProductPlace }
  | { type: 'replan' }
  | { type: 'hydrate'; state: ShoppingState }
  | { type: 'sync'; catalogue: StoreProduct[]; decidedReportIds?: number[] }
  /** Apply one fresh backend response; stale responses cannot overwrite a newer trip. */
  | {
      type: 'applyRoutePlan';
      currentIndex: number;
      productIds: number[];
      stops: ShoppingStop[];
      start: MapPoint;
    }
  /** A route request failed: never leave a stale path drawn through a closure. */
  | { type: 'routePlanFailed'; currentIndex: number; productIds: number[]; start?: MapPoint };

export function shoppingReducer(state: ShoppingState, action: ShoppingAction): ShoppingState {
  switch (action.type) {
    case 'add':
      if (state.trip || state.items.some(item => item.id === action.product.id)) return state;
      return { ...state, items: [...state.items, productForShopper(action.product, [], state.reports)], completedCount: null };
    case 'remove':
      if (state.trip) return state;
      return { ...state, items: state.items.filter(item => item.id !== action.id), completedCount: null };
    case 'start': {
      if (state.trip || !state.items.length) return state;
      const unique = [...new Map(state.items.map(item => [item.id, item])).values()];
      return {
        ...state,
        trip: { stops: unique.map(pendingShoppingStop), currentIndex: 0, start: action.position, routeStarted: false },
        completedCount: null,
      };
    }
    case 'found': {
      if (!state.trip || state.trip.stops[state.trip.currentIndex].routeStatus !== 'ready') return state;
      const { stops, currentIndex } = state.trip;
      const items = state.items.filter(item => item.id !== stops[currentIndex].product.id);
      const finished = currentIndex + 1 === stops.length;
      const reached = stops[currentIndex].product;
      return {
        ...state,
        items,
        trip: finished ? null : {
          ...state.trip,
          currentIndex: currentIndex + 1,
          start: { x: reached.mapX, y: reached.mapY },
        },
        completedCount: finished ? stops.length : null,
      };
    }
    case 'relocate': {
      if (!state.trip) return state;
      const moved = { ...state.trip, start: action.position };
      return { ...state, trip: updateTrip(moved, product => product, true) };
    }
    case 'end':
      return { ...state, trip: null, completedCount: null };
    case 'dismissCompletion':
      return { ...state, completedCount: null };
    case 'report': {
      const reports = {
        ...state.reports,
        [action.productId]: { reportId: action.reportId, seenAt: action.seenAt },
      };
      return updateProducts(state, reports, product => productForShopper(product, [], reports));
    }
    case 'sync': {
      const reports = dropReports(state.reports, action.decidedReportIds ?? []);
      return updateProducts(state, reports, product => productForShopper(product, action.catalogue, reports));
    }
    case 'replan': {
      if (!state.trip) return state;
      return { ...state, trip: updateTrip(state.trip, product => product, true) };
    }
    case 'applyRoutePlan': {
      if (!state.trip || !planMatches(state.trip, action)) return state;
      return {
        ...state,
        trip: {
          ...state.trip,
          start: action.start,
          routeStarted: true,
          stops: [...state.trip.stops.slice(0, state.trip.currentIndex), ...action.stops],
        },
      };
    }
    case 'routePlanFailed': {
      if (!state.trip || !planMatches(state.trip, action)) return state;
      const stops = state.trip.stops.map((stop, index) =>
        index < state.trip!.currentIndex
          ? stop
          : { ...stop, route: null, routeStatus: 'unavailable' as const },
      );
      return { ...state, trip: { ...state.trip, stops } };
    }
    case 'hydrate': {
      const touched = state.items.length > 0 || state.trip !== null
        || state.completedCount !== null
        || Object.keys(state.reports).length > 0;
      return touched ? state : action.state;
    }
  }
}