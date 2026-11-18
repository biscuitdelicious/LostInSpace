import { aisleCenterX, type MapPoint } from './route';
import type { MapFrame } from './map-frame';

export const STORE_MAP = { width: 700, height: 330 };
export const PORTRAIT_MAP = { width: 330, height: 700 };

export const AISLE_COUNT = 8;
export const SHELF_SIDES = ['left', 'right'] as const;
export const SHELF_LEVELS = ['top', 'middle', 'bottom'] as const;
export type ShelfSide = (typeof SHELF_SIDES)[number];
export type ShelfLevel = (typeof SHELF_LEVELS)[number];

/** The stretch of an aisle a product pin can sit on (map units). */
export const AISLE_PIN_START_Y = 88;
export const AISLE_PIN_END_Y = 215;
/** How far a pin sits from the aisle centre line, towards its side. */
const SIDE_OFFSET_X = 14;

export type ShelfLocation = {
  aisleNumber: number;
  aisleLocation: string;
  mapX: number;
  mapY: number;
};

/** What a tap on the map tells us: the aisle, and how far along it. */
export type AisleTap = { aisleNumber: number; mapY: number };

/**
 * Which aisle a tap belongs to. The whole lane counts, from one aisle's
 * midpoint to the next, plus its name label, so it is an easy target on
 * a phone. Side and shelf height are never read from the tap: a flat map
 * cannot show them, so the shopper picks those with buttons.
 */
export function aisleFromTap(point: MapPoint): AisleTap | null {
  if (point.y < 5 || point.y > 262) return null;
  const aisleNumber = Math.round((point.x - aisleCenterX(1)) / 77) + 1;
  if (aisleNumber < 1 || aisleNumber > AISLE_COUNT) return null;
  if (Math.abs(point.x - aisleCenterX(aisleNumber)) > 38.5) return null;
  return {
    aisleNumber,
    mapY: Math.round(Math.min(Math.max(point.y, AISLE_PIN_START_Y), AISLE_PIN_END_Y)),
  };
}

/** Where the report pin is drawn before a side is picked: on the aisle centre line. */
export function aisleTapPoint(tap: AisleTap, side: ShelfSide | null): MapPoint {
  const offset = side === 'left' ? -SIDE_OFFSET_X : side === 'right' ? SIDE_OFFSET_X : 0;
  return { x: aisleCenterX(tap.aisleNumber) + offset, y: tap.mapY };
}

/** Same rules as the backend: the shopper's explicit aisle, side, and shelf. */
export function shelfLocation(choice: AisleTap & { side: ShelfSide; shelf: ShelfLevel }): ShelfLocation {
  const point = aisleTapPoint(choice, choice.side);
  return {
    aisleNumber: choice.aisleNumber,
    aisleLocation: `Aisle ${choice.aisleNumber}, ${choice.side}, ${choice.shelf} shelf`,
    mapX: point.x,
    mapY: point.y,
  };
}

function placedContent(svgWidth: number, svgHeight: number, portrait: boolean, frame?: MapFrame | null) {
  const viewBox = frame ?? { x: 0, y: 0, ...(portrait ? PORTRAIT_MAP : STORE_MAP) };
  const scale = Math.min(svgWidth / viewBox.width, svgHeight / viewBox.height);
  return {
    viewBox,
    scale,
    offsetX: (svgWidth - viewBox.width * scale) / 2,
    // The full plan hugs the top of the canvas; a close-up is centred.
    offsetY: frame ? (svgHeight - viewBox.height * scale) / 2 : 0,
  };
}

/**
 * Map a tap on the fitted SVG back to landscape store coordinates.
 * Pass the close-up `frame` when the map is zoomed into one aisle.
 */
export function tapToStorePoint(input: {
  localX: number;
  localY: number;
  svgWidth: number;
  svgHeight: number;
  portrait: boolean;
  frame?: MapFrame | null;
}): MapPoint | null {
  if (input.svgWidth <= 0 || input.svgHeight <= 0) return null;
  const plan = input.portrait ? PORTRAIT_MAP : STORE_MAP;
  const { viewBox, scale, offsetX, offsetY } = placedContent(input.svgWidth, input.svgHeight, input.portrait, input.frame);
  const viewX = viewBox.x + (input.localX - offsetX) / scale;
  const viewY = viewBox.y + (input.localY - offsetY) / scale;
  if (viewX < -0.5 || viewY < -0.5 || viewX > plan.width + 0.5 || viewY > plan.height + 0.5) return null;
  return input.portrait ? { x: viewY, y: PORTRAIT_MAP.width - viewX } : { x: viewX, y: viewY };
}

/** Inverse of tapToStorePoint, used to aim a test click at an aisle. */
export function storePointToLocal(point: MapPoint, svgWidth: number, svgHeight: number, portrait: boolean, frame?: MapFrame | null): { x: number; y: number } {
  const { viewBox, scale, offsetX, offsetY } = placedContent(svgWidth, svgHeight, portrait, frame);
  const viewX = portrait ? PORTRAIT_MAP.width - point.y : point.x;
  const viewY = portrait ? point.x : point.y;
  return { x: offsetX + (viewX - viewBox.x) * scale, y: offsetY + (viewY - viewBox.y) * scale };
}
