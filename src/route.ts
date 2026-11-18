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

export type ProductRoute = {
  /** Ordered waypoints from `start` to the product pin, supplied by the backend. */
  points: MapPoint[];
  /** SVG path data (`M … L …`) for the waypoints. */
  path: string;
  distanceMeters: number;
};

export function formatDistance(distanceMeters: number): string {
  return `${distanceMeters.toFixed(1)} m`;
}

/**
 * Turn-by-turn wording for the map banner, built from the aisle location
 * string, e.g. "Aisle 7, left, middle shelf" becomes
 * "Turn into aisle 7, left side, middle shelf".
 */
export function routeInstruction(product: StoreProduct): string {
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

/**
 * Which side of the aisle the banner turn icon should point towards.
 */
export function routeTurnDirection(
  product: Pick<StoreProduct, 'aisleLocation' | 'aisleNumber' | 'mapX'>,
): 'left' | 'right' | 'straight' {
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
