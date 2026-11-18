/**
 * Store geometry owned by the backend. Routing, shelf placement, the graph
 * seed, and staff-facing connection names all read these same values.
 * Map coordinates match the 700 × 330 floor plan drawn by the app.
 */
export const STORE_MAP = { width: 700, height: 330 } as const;
export const AISLE_COUNT = 8;
export const AISLE_SPACING = 77;
export const AISLE_FIRST_CENTER_X = 79;
export const AISLE_CENTER_X = Array.from({ length: AISLE_COUNT }, (_, index) =>
  aisleCenterX(index + 1),
);

export const CORRIDOR_Y = 240;
export const TOP_WALKWAY_Y = 55;
export const ENTRANCE_NODE = { x: 345, y: 268 } as const;
export const SPINE_STEPS_Y = [215, 151, 88, TOP_WALKWAY_Y] as const;

export const AISLE_PIN_START_Y = 88;
export const AISLE_PIN_END_Y = 215;
export const AISLE_PIN_MIDDLE_Y = 151;
export const SIDE_OFFSET_X = 14;
export const METERS_PER_MAP_UNIT = 0.1;

export function aisleCenterX(aisleNumber: number): number {
  return AISLE_FIRST_CENTER_X + (aisleNumber - 1) * AISLE_SPACING;
}

export type LayoutPoint = { mapX: number; mapY: number };

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

function aisleAt(x: number): number | null {
  const index = AISLE_CENTER_X.findIndex((centre) => near(centre, x));
  return index < 0 ? null : index + 1;
}

/** A specific junction name, including its position within an aisle. */
export function walkNodeLabel(node: LayoutPoint): string {
  const aisle = aisleAt(node.mapX);
  if (near(node.mapX, ENTRANCE_NODE.x) && near(node.mapY, ENTRANCE_NODE.y)) {
    return 'Entrance · door';
  }
  if (near(node.mapY, CORRIDOR_Y)) {
    if (near(node.mapX, ENTRANCE_NODE.x)) return 'Entrance · corridor';
    return aisle ? `Corridor · aisle ${aisle}` : 'Corridor';
  }
  if (near(node.mapY, TOP_WALKWAY_Y)) {
    return aisle ? `Back walkway · aisle ${aisle}` : 'Back walkway';
  }
  if (aisle && near(node.mapY, 215)) return `Aisle ${aisle} · entrance end`;
  if (aisle && near(node.mapY, 151)) return `Aisle ${aisle} · middle`;
  if (aisle && near(node.mapY, 88)) return `Aisle ${aisle} · back end`;
  return `Walkway · ${node.mapX}, ${node.mapY}`;
}

/** A connection name that identifies the exact section being changed. */
export function walkEdgeLabel(from: LayoutPoint, to: LayoutPoint): string {
  const aisle = aisleAt(from.mapX);
  if (
    aisle &&
    aisle === aisleAt(to.mapX) &&
    !near(from.mapY, CORRIDOR_Y) &&
    !near(to.mapY, CORRIDOR_Y)
  ) {
    const section = (node: LayoutPoint): string => {
      if (near(node.mapY, 215)) return 'entrance end';
      if (near(node.mapY, 151)) return 'middle';
      if (near(node.mapY, 88)) return 'back end';
      return 'back walkway';
    };
    const [first, second] = from.mapY > to.mapY ? [from, to] : [to, from];
    return `Aisle ${aisle} · ${section(first)} to ${section(second)}`;
  }
  if (near(from.mapY, CORRIDOR_Y) && near(to.mapY, CORRIDOR_Y)) {
    const end = (node: LayoutPoint): string => {
      const atAisle = aisleAt(node.mapX);
      if (atAisle) return `aisle ${atAisle}`;
      return near(node.mapX, ENTRANCE_NODE.x) ? 'entrance' : `x ${node.mapX}`;
    };
    return `Corridor · ${end(from)} to ${end(to)}`;
  }
  if (near(from.mapY, TOP_WALKWAY_Y) && near(to.mapY, TOP_WALKWAY_Y)) {
    return `Back walkway · aisle ${aisleAt(from.mapX) ?? from.mapX} to aisle ${aisleAt(to.mapX) ?? to.mapX}`;
  }
  return `${walkNodeLabel(from)} to ${walkNodeLabel(to)}`;
}
