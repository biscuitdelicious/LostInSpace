import {
  AISLE_COUNT,
  AISLE_PIN_END_Y,
  AISLE_PIN_MIDDLE_Y,
  AISLE_PIN_START_Y,
  SIDE_OFFSET_X,
  aisleCenterX,
} from '../walk/store-layout';

export { AISLE_COUNT };
export const SHELF_SIDES = ['left', 'right'] as const;
export const SHELF_LEVELS = ['top', 'middle', 'bottom'] as const;
export type ShelfSide = (typeof SHELF_SIDES)[number];
export type ShelfLevel = (typeof SHELF_LEVELS)[number];

/** The stretch of an aisle a product pin can sit on (map units). */

export type ShelfChoice = {
  aisleNumber: number;
  side: ShelfSide;
  shelf: ShelfLevel;
  /** How far along the aisle the product was seen. Optional. */
  mapY?: number;
};

export type ShelfLocation = {
  aisleNumber: number;
  aisleLocation: string;
  mapX: number;
  mapY: number;
};

/**
 * Turn a shopper's explicit choice into a product location.
 *
 * Side and shelf height are always chosen by the shopper: a flat map
 * cannot show whether something is on the top or bottom shelf, so neither
 * is ever guessed from where the map was tapped. The tap only says which
 * aisle, and how far along it the pin is drawn.
 */
export function shelfLocation(choice: ShelfChoice): ShelfLocation {
  const along = choice.mapY ?? AISLE_PIN_MIDDLE_Y;
  const offset = choice.side === 'left' ? -SIDE_OFFSET_X : SIDE_OFFSET_X;
  return {
    aisleNumber: choice.aisleNumber,
    aisleLocation: `Aisle ${choice.aisleNumber}, ${choice.side}, ${choice.shelf} shelf`,
    mapX: aisleCenterX(choice.aisleNumber) + offset,
    mapY: Math.round(
      Math.min(Math.max(along, AISLE_PIN_START_Y), AISLE_PIN_END_Y),
    ),
  };
}
