import type { StoreProduct } from './products';

export type MapPoint = {
  x: number;
  y: number;
};

/**
 * Default route origin until the shopper taps the map, or an ESP32 board
 * supplies an automatic position. Backend routing uses its own layout.
 */
export const ENTRANCE_POINT: MapPoint = { x: 345, y: 268 };

/** Aisle centre used only for map drawing and report placement, not routing. */
export function aisleCenterX(aisleNumber: number): number {
  return 79 + (aisleNumber - 1) * 77;
}

export type RouteDetour = {
  /** Plain shopper name of the closed section avoided, e.g. "aisle 1 entrance". */
  closedSection: string;
  /** First intermediate aisle the detoured path enters, or null when leaving the current aisle directly onto a walkway. */
  firstAisle: number | null;
  /** Connecting walkway taken around the closure, when applicable. */
  via: 'back walkway' | 'front corridor' | null;
  /** Direction of the first turn along the detour. */
  firstTurn: 'left' | 'right' | 'straight';
};

export type ProductRoute = {
  /** Ordered waypoints from `start` to the product pin, supplied by the backend. */
  points: MapPoint[];
  /** SVG path data (`M … L …`) for the waypoints. */
  path: string;
  distanceMeters: number;
  /** Present when a closed walkway forced a longer route around it. */
  detour?: RouteDetour;
};

export function formatDistance(distanceMeters: number): string {
  return `${distanceMeters.toFixed(1)} m`;
}

/**
 * Turn-by-turn wording for the map banner.
 *
 * For an open direct route this reads the product's shelf location, e.g.
 * "Turn into aisle 7, left side, middle shelf". When a closed walkway forces
 * a detour, it names the first aisle or walkway the shopper actually takes
 * instead of sending them towards the closed entrance.
 */
export function routeInstruction(
  product: StoreProduct,
  route?: Pick<ProductRoute, 'detour'> | null,
): string {
  const detour = route?.detour;
  if (detour) {
    const target = `aisle ${product.aisleNumber}`;
    if (detour.firstAisle !== null) {
      const verb = detour.firstTurn === 'straight' ? 'Take' : 'Turn into';
      return detour.via
        ? `${verb} aisle ${detour.firstAisle}, via ${detour.via} to ${target}`
        : `${verb} aisle ${detour.firstAisle}, then to ${target}`;
    }
    if (detour.via) {
      return `Take the ${detour.via} to ${target}`;
    }
    return `Detour to ${target}`;
  }

  const parts = product.aisleLocation
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const aisle = parts.find((part) => /^aisle\s+\d+/i.test(part)) ?? `Aisle ${product.aisleNumber}`;
  const side = parts.find((part) => /^(left|right|center|centre)\b/i.test(part));
  const shelf = parts.find((part) => /shelf/i.test(part));

  const sideText = side
    ? /^(center|centre)$/i.test(side)
      ? 'centre'
      : `${side.toLowerCase()} side`
    : null;

  return [`Turn into ${aisle.toLowerCase()}`, sideText, shelf]
    .filter(Boolean)
    .join(', ');
}

/** Short banner reason when a route is a detour, e.g. "Aisle 1 entrance closed". */
export function routeDetourNotice(
  route?: Pick<ProductRoute, 'detour'> | null,
): string | null {
  const section = route?.detour?.closedSection?.trim();
  if (!section) return null;
  return `${section[0].toUpperCase()}${section.slice(1)} closed`;
}

/**
 * Which direction the banner turn icon should point towards: the real first
 * turn on a detour, or the product's side of the aisle on a direct route.
 */
export function routeTurnDirection(
  product: Pick<StoreProduct, 'aisleLocation' | 'aisleNumber' | 'mapX'>,
  route?: Pick<ProductRoute, 'detour'> | null,
): 'left' | 'right' | 'straight' {
  if (route?.detour) return route.detour.firstTurn;
  const parts = product.aisleLocation
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const side = parts.find((part) => /^(left|right|center|centre)\b/i.test(part));
  if (side) {
    if (/^left\b/i.test(side)) return 'left';
    if (/^right\b/i.test(side)) return 'right';
    return 'straight';
  }
  const centerX = aisleCenterX(product.aisleNumber);
  if (product.mapX < centerX) return 'left';
  if (product.mapX > centerX) return 'right';
  return 'straight';
}
