import type { MapPoint } from './route';
import { aisleCenterX } from './route';

export const PORTRAIT_PLAN = { width: 330, height: 700 };
export const LANDSCAPE_PLAN = { width: 700, height: 330 };

/** Horizontal span of the store walls (15..315) plus a small margin in portrait mode. */
const PORTRAIT_STORE_X = { x: 12, width: 306 };
const PORTRAIT_ENTRANCE_BAR = { y: 235, height: 220 };

export type MapFrame = { x: number; y: number; width: number; height: number };
export type DrawnBox = { x: number; y: number; width: number; height: number };
export type LabelPlacement = {
  x: number;
  y: number;
  fontSize: number;
  anchor: 'start' | 'middle' | 'end';
  width: number;
  height: number;
};

export function drawnPoint(point: MapPoint, portrait: boolean): MapPoint {
  return portrait ? { x: PORTRAIT_PLAN.width - point.y, y: point.x } : { x: point.x, y: point.y };
}

export function fullMapFrame(portrait: boolean): MapFrame {
  const map = portrait ? PORTRAIT_PLAN : LANDSCAPE_PLAN;
  return { x: 0, y: 0, width: map.width, height: map.height };
}

export function viewBoxOf(frame: MapFrame): string {
  return `${frame.x} ${frame.y} ${frame.width} ${frame.height}`;
}

/** How wide the framed plan draws inside a canvas. A full portrait plan letterboxes. */
export function renderedWidth(frame: MapFrame, viewportWidth: number, viewportHeight: number): number {
  if (viewportWidth <= 0 || viewportHeight <= 0 || frame.width <= 0 || frame.height <= 0) return 0;
  return frame.width * Math.min(viewportWidth / frame.width, viewportHeight / frame.height);
}

export function shelfBlock(aisleNumber: number): DrawnBox {
  return { x: 55 + (aisleNumber - 1) * 77, y: 75, width: 48, height: 153 };
}

export function drawnBox(box: DrawnBox, portrait: boolean): DrawnBox {
  if (!portrait) return box;
  return {
    x: PORTRAIT_PLAN.width - (box.y + box.height),
    y: box.x,
    width: box.height,
    height: box.width,
  };
}

export function labelBoxOf(label: LabelPlacement): DrawnBox {
  const x = label.anchor === 'middle'
    ? label.x - label.width / 2
    : label.anchor === 'end'
      ? label.x - label.width
      : label.x;
  return { x, y: label.y - label.height + 4, width: label.width, height: label.height };
}

export function pinLabelBoxOf(label: LabelPlacement): DrawnBox {
  return {
    x: label.x - label.width / 2,
    y: label.y - label.height / 2,
    width: label.width,
    height: label.height,
  };
}

/** What an aisle name has to stay readable next to, in drawn coordinates. */
export type AisleLabelContext = {
  /** The shopper's tapped spot: its dot, halo, and YOU text never cover a name. */
  shopper?: MapPoint;
  /** The drawn route; a name that has to move prefers a spot off the line. */
  routePoints?: MapPoint[];
};

/** Radius of the soft halo drawn around the shopper's tapped spot. */
export const SHOPPER_HALO_RADIUS = 17;
/** Free space kept between an aisle name and the shopper marker. */
const SHOPPER_CLEARANCE = 1.5;
/**
 * Text extents in ems, measured in the browser and rounded up so they also
 * hold for the bold close-up names and the phone system fonts:
 * "AISLE 6" draws 3.6 em wide, a bold "YOU" 2.2 em, both 1.2 em tall.
 */
const AISLE_NAME_EMS = 4.1;
const SHOPPER_NAME_EMS = 2.8;
const TEXT_ABOVE_BASELINE_EMS = 0.92;
const TEXT_HEIGHT_EMS = 1.22;

/** The space the aisle name's letters take up, tighter than its padded label box. */
export function aisleLabelInkBox(label: LabelPlacement): DrawnBox {
  const width = Math.min(label.width, label.fontSize * AISLE_NAME_EMS);
  const x = label.anchor === 'middle'
    ? label.x - width / 2
    : label.anchor === 'end'
      ? label.x - width
      : label.x;
  return {
    x,
    y: label.y - label.fontSize * TEXT_ABOVE_BASELINE_EMS,
    width,
    height: label.fontSize * TEXT_HEIGHT_EMS,
  };
}

/** The space the YOU text next to the shopper's tapped spot takes up. */
export function shopperNameBox(shopper: MapPoint, portrait: boolean): DrawnBox {
  const label = startLabelPlacement(shopper, portrait, true);
  const width = label.fontSize * SHOPPER_NAME_EMS;
  return {
    x: label.x - width / 2,
    y: label.y - label.fontSize * TEXT_ABOVE_BASELINE_EMS,
    width,
    height: label.fontSize * TEXT_HEIGHT_EMS,
  };
}

function gapBetweenBoxes(a: DrawnBox, b: DrawnBox): number {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  return Math.hypot(dx, dy);
}

function gapToCircle(box: DrawnBox, center: MapPoint, radius: number): number {
  const dx = Math.max(box.x - center.x, center.x - (box.x + box.width), 0);
  const dy = Math.max(box.y - center.y, center.y - (box.y + box.height), 0);
  return Math.hypot(dx, dy) - radius;
}

/** Free space between an aisle name and the shopper's dot, halo, and YOU text. */
export function aisleLabelClearance(label: LabelPlacement, shopper: MapPoint, portrait: boolean): number {
  const ink = aisleLabelInkBox(label);
  return Math.min(
    gapToCircle(ink, shopper, SHOPPER_HALO_RADIUS),
    gapBetweenBoxes(ink, shopperNameBox(shopper, portrait)),
  );
}

/**
 * Where an aisle name may step aside to, nearest first. Portrait names
 * slide along the wall, staying beside their own shelf row. Landscape
 * names drop towards the entrance (never up into the corridor), and only
 * shift sideways when dropping is not enough: beside the entrance walkway.
 */
function aisleLabelMoves(portrait: boolean): [number, number][] {
  if (portrait) {
    return [6, 12, 18, 24, 30, 36].flatMap((step): [number, number][] => [[0, step], [0, -step]]);
  }
  const moves: [number, number][] = [[0, 6], [0, 12], [0, 16]];
  for (const dy of [0, 12, 16]) {
    for (const dx of [6, 12, 18]) moves.push([-dx, dy], [dx, dy]);
  }
  return moves;
}

/**
 * Aisle name placement. In portrait mode each name sits at the right end
 * of its own shelf row, aligned with the shelf midline, so it is always
 * clear which name belongs to which shelf and the product chip over the
 * shelf never covers an aisle name.
 *
 * The shopper can tap any walkway, including the corridor right above a
 * landscape name and the back walkway that runs through the portrait ones.
 * A name the YOU marker would cover steps aside by the smallest move that
 * clears the dot, its halo, and the YOU text; every other name stays put.
 */
export function aisleLabelPlacement(
  aisleNumber: number,
  portrait: boolean,
  focused: boolean,
  context: AisleLabelContext = {},
): LabelPlacement {
  const blockX = 55 + (aisleNumber - 1) * 77;
  const base: LabelPlacement = portrait
    ? {
        x: focused ? 258 : 260,
        y: blockX + 28,
        fontSize: focused ? 13.5 : 14,
        anchor: 'start',
        width: 54,
        height: 16,
      }
    : {
        x: blockX + 24,
        y: 256,
        fontSize: focused ? 12 : 9.5,
        anchor: 'middle',
        width: focused ? 68 : 56,
        height: focused ? 16 : 14,
      };
  const shopper = context.shopper;
  if (!shopper) return base;
  let widest = aisleLabelClearance(base, shopper, portrait);
  if (widest >= SHOPPER_CLEARANCE) return base;

  const route = context.routePoints ?? [];
  let clear: LabelPlacement | null = null;
  let leastCovered = base;
  for (const [dx, dy] of aisleLabelMoves(portrait)) {
    const candidate = { ...base, x: base.x + dx, y: base.y + dy };
    const clearance = aisleLabelClearance(candidate, shopper, portrait);
    if (clearance < SHOPPER_CLEARANCE) {
      if (clearance > widest) {
        widest = clearance;
        leastCovered = candidate;
      }
      continue;
    }
    clear ??= candidate;
    // Stepping off the dot onto the route line would hide the name again.
    const ink = aisleLabelInkBox(candidate);
    const keepClear: DrawnBox = {
      x: ink.x - ROUTE_HALF_WIDTH,
      y: ink.y - ROUTE_HALF_WIDTH,
      width: ink.width + ROUTE_HALF_WIDTH * 2,
      height: ink.height + ROUTE_HALF_WIDTH * 2,
    };
    if (lengthInside(route, keepClear) < 0.5) return candidate;
  }
  return clear ?? leastCovered;
}

/** What the product chip has to stay clear of, in drawn coordinates. */
export type PinLabelContext = {
  /** The pin's aisle: the route normally arrives along its centre line. */
  aisleNumber?: number;
  /** The route to the pin, already rotated for portrait (see `drawnPoint`). */
  routePoints?: MapPoint[];
  /** Closed walkway segments in drawn coordinates, kept visible when closed. */
  blockedSegments?: [MapPoint, MapPoint][];
};

/** Pin dot radius plus its white outline. */
const PIN_DOT_RADIUS = 10;
/** Half of the route's white casing, plus a hair so the chip never touches it. */
const ROUTE_HALF_WIDTH = 4;
/** How much of the walk into the pin (6 m) must stay visible above all. */
const APPROACH_LENGTH = 60;

/** Length of segment `a`-`b` that lies inside `box` (Liang–Barsky clipping). */
function segmentLengthInside(a: MapPoint, b: MapPoint, box: DrawnBox): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let enter = 0;
  let leave = 1;
  const clips: [number, number][] = [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ];
  for (const [direction, room] of clips) {
    if (direction === 0) {
      // Parallel to this side: running along the edge itself is outside.
      if (room <= 0) return 0;
      continue;
    }
    const t = room / direction;
    if (direction < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return 0;
  }
  return (leave - enter) * Math.hypot(dx, dy);
}

function boxesOverlap(a: DrawnBox, b: DrawnBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function lengthInside(points: MapPoint[], box: DrawnBox): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += segmentLengthInside(points[index - 1], points[index], box);
  }
  return total;
}

/** The last `length` units of a route, walking back from its final point. */
function routeTail(points: MapPoint[], length: number): MapPoint[] {
  if (points.length < 2) return [];
  const tail: MapPoint[] = [points[points.length - 1]];
  let left = length;
  for (let index = points.length - 2; index >= 0 && left > 0; index -= 1) {
    const from = points[index + 1];
    const to = points[index];
    const step = Math.hypot(to.x - from.x, to.y - from.y);
    if (step <= left) {
      tail.push(to);
    } else {
      const part = left / step;
      tail.push({ x: from.x + (to.x - from.x) * part, y: from.y + (to.y - from.y) * part });
    }
    left -= step;
  }
  return tail;
}

/**
 * Product name chip. It sits next to the pin, on whichever side keeps the
 * route visible: the chip is wider than the gap between the pin and its
 * aisle walkway, so on the walkway side it would cover the last part of
 * the line and the turn into the pin.
 *
 * In portrait mode the chip stays over the shelf column (x = 98..254),
 * clear of the corridor and START on the left and clear of the aisle names
 * (x >= 260) on the right, so it goes above or below the pin. In landscape
 * it stays above the aisle names (y <= 244) and can also sit beside the pin.
 */
export function pinLabelPlacement(
  pin: MapPoint,
  portrait: boolean,
  focused: boolean,
  context: PinLabelContext = {},
): LabelPlacement {
  const width = portrait ? 152 : 136;
  const height = 24;
  const gap = portrait ? 26 : 28;
  const fontSize = portrait ? (focused ? 12.5 : 12) : (focused ? 11 : 9.5);
  const range = portrait
    ? { minX: 98 + width / 2, maxX: 254 - width / 2, minY: 28, maxY: 672 }
    : { minX: 85, maxX: 615, minY: 34, maxY: 232 };
  const at = (x: number, y: number): LabelPlacement => ({
    x: Math.min(Math.max(x, range.minX), range.maxX),
    y: Math.min(Math.max(y, range.minY), range.maxY),
    fontSize,
    anchor: 'middle',
    width,
    height,
  });

  const above = at(pin.x, pin.y - gap);
  const below = at(pin.x, pin.y + gap);
  const beside = width / 2 + PIN_DOT_RADIUS + 6;
  // Portrait aisles run across the screen, so a pin past its aisle centre
  // line has the walkway above it: start below, before any route arrives.
  const walkwayAbove = portrait
    && context.aisleNumber !== undefined
    && pin.y > aisleCenterX(context.aisleNumber) + 0.5;
  const candidates = walkwayAbove ? [below, above] : [above, below];
  // Beside the pin, stepping outwards until the chip is past the walkway.
  for (const extra of [0, 12, 24, 36]) {
    candidates.push(at(pin.x + beside + extra, pin.y), at(pin.x - beside - extra, pin.y));
  }

  const pinDot: DrawnBox = {
    x: pin.x - PIN_DOT_RADIUS,
    y: pin.y - PIN_DOT_RADIUS,
    width: PIN_DOT_RADIUS * 2,
    height: PIN_DOT_RADIUS * 2,
  };
  const route = context.routePoints ?? [];
  const approach = routeTail(route, APPROACH_LENGTH);
  let best = candidates[0];
  let bestCovered = Infinity;
  for (const candidate of candidates) {
    const chip = pinLabelBoxOf(candidate);
    // Clamping a candidate back into range may push it onto the pin itself.
    if (boxesOverlap(chip, pinDot)) continue;
    const keepClear: DrawnBox = {
      x: chip.x - ROUTE_HALF_WIDTH,
      y: chip.y - ROUTE_HALF_WIDTH,
      width: chip.width + ROUTE_HALF_WIDTH * 2,
      height: chip.height + ROUTE_HALF_WIDTH * 2,
    };
    // Hiding the walk into the pin is far worse than touching the line
    // somewhere else, so the last stretch counts many times over. Closed
    // walkway markers also stay uncovered when a clear side is available.
    let blockedCovered = 0;
    for (const [segFrom, segTo] of context.blockedSegments ?? []) {
      blockedCovered += segmentLengthInside(segFrom, segTo, keepClear);
    }
    const covered =
      lengthInside(route, keepClear)
      + 10 * lengthInside(approach, keepClear)
      + 0.25 * blockedCovered;
    // Earlier candidates win ties, so the chip only moves for a reason.
    if (covered < bestCovered - 0.5) {
      best = candidate;
      bestCovered = covered;
    }
  }
  return best;
}

/**
 * START label placement (in drawn coordinates). In portrait mode it stays
 * to the right of the entrance bar (x >= 52) so it is never clipped or
 * drawn over ENTRANCE / CHECKOUT.
 */
export function startLabelPlacement(start: MapPoint, portrait: boolean, manual = false): LabelPlacement {
  if (manual) {
    const plan = portrait ? PORTRAIT_PLAN : LANDSCAPE_PLAN;
    return {
      x: Math.min(Math.max(start.x, 42), plan.width - 42),
      y: start.y < 48 ? start.y + 19 : start.y - 12,
      fontSize: portrait ? 10 : 9,
      anchor: 'middle',
      width: 36,
      height: 12,
    };
  }
  if (portrait) {
    return {
      x: Math.max(start.x, 70),
      y: start.y - 12,
      fontSize: 10,
      anchor: 'middle',
      width: 36,
      height: 12,
    };
  }
  return {
    x: start.x - 16,
    y: start.y + 3,
    fontSize: 9,
    anchor: 'end',
    width: 36,
    height: 12,
  };
}

export function startMarkerBox(start: MapPoint, portrait: boolean, manual = false): DrawnBox {
  const label = labelBoxOf(startLabelPlacement(start, portrait, manual));
  const dot: DrawnBox = { x: start.x - 10, y: start.y - 10, width: 20, height: 20 };
  return union([label, dot]);
}

export function entranceTextBox(portrait: boolean): DrawnBox {
  return portrait
    ? { x: 26, y: 275, width: 16, height: 140 }
    : { x: 280, y: 288, width: 130, height: 16 };
}

/**
 * Hit box for tapping a walkway segment on the staff Walk paths map, in drawn
 * plan coordinates. Inset from both junctions so neighbouring aisle and
 * corridor segments never overlap each other.
 */
export function walkEdgeTapBox(
  from: MapPoint,
  to: MapPoint,
  portrait: boolean,
): DrawnBox {
  const p1 = drawnPoint(from, portrait);
  const p2 = drawnPoint(to, portrait);
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const dx = Math.abs(p2.x - p1.x);
  const dy = Math.abs(p2.y - p1.y);
  const length = Math.hypot(dx, dy);
  const span = Math.min(56, Math.max(12, length - 23));
  const thickness = 22;
  const width = dy < 1 ? span : dx < 1 ? thickness : 24;
  const height = dy < 1 ? thickness : dx < 1 ? span : 24;
  return {
    x: midX - width / 2,
    y: midY - height / 2,
    width,
    height,
  };
}

export function frameContains(frame: MapFrame, box: DrawnBox, slack = 2): boolean {
  return box.x >= frame.x - slack
    && box.y >= frame.y - slack
    && box.x + box.width <= frame.x + frame.width + slack
    && box.y + box.height <= frame.y + frame.height + slack;
}

/** The turn into the destination aisle, not the long walk from the other side of the store. */
export function approachPoints(points: MapPoint[], aisleNumber: number): MapPoint[] {
  if (points.length <= 1) return points;
  const center = aisleCenterX(aisleNumber);
  const nearAisle = points.filter((point) => Math.abs(point.x - center) <= 52);
  const tail = points.slice(-3);
  const merged = [...nearAisle, ...tail];
  return merged.filter((point, index) => merged.findIndex((other) => other.x === point.x && other.y === point.y) === index);
}

function union(boxes: DrawnBox[]): DrawnBox {
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function fitFrame(content: DrawnBox, map: { width: number; height: number }, aspect: number): MapFrame {
  const pad = 20;
  const x = content.x - pad;
  const y = content.y - pad;
  const width = content.width + pad * 2;
  const height = content.height + pad * 2;
  let frameWidth = width;
  let frameHeight = height;
  if (frameWidth / frameHeight < aspect) frameWidth = frameHeight * aspect;
  else frameHeight = frameWidth / aspect;

  if (frameWidth > map.width) {
    frameWidth = map.width;
    frameHeight = frameWidth / aspect;
  }
  if (frameHeight > map.height) {
    frameHeight = map.height;
    frameWidth = frameHeight * aspect;
  }
  if (frameWidth > map.width) frameWidth = map.width;
  if (frameWidth >= map.width - 1 && frameHeight >= map.height - 1) {
    return { x: 0, y: 0, width: map.width, height: map.height };
  }

  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const left = Math.min(Math.max(centerX - frameWidth / 2, 0), map.width - frameWidth);
  const top = Math.min(Math.max(centerY - frameHeight / 2, 0), map.height - frameHeight);
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(frameWidth),
    height: Math.round(frameHeight),
  };
}

/**
 * Close-up of the aisle the shopper is walking into. In portrait mode it
 * keeps the full store width (so ENTRANCE / CHECKOUT, START, and the right-hand
 * aisle names are never clipped at the sides) while zooming vertically into
 * the current part of the route so the map fills the phone width.
 */
export function frameCurrentStop(input: {
  portrait: boolean;
  aisleNumber: number;
  pin: MapPoint;
  routePoints: MapPoint[];
  blockedSegments?: [MapPoint, MapPoint][];
  manualStart?: boolean;
  /** Where the shopper marker is drawn; defaults to the first route point. */
  start?: MapPoint;
  viewportWidth: number;
  viewportHeight: number;
}): MapFrame {
  const map = input.portrait ? PORTRAIT_PLAN : LANDSCAPE_PLAN;
  if (input.viewportWidth <= 0 || input.viewportHeight <= 0) return fullMapFrame(input.portrait);
  const aspect = input.viewportWidth / input.viewportHeight;
  const pin = drawnPoint(input.pin, input.portrait);
  const routePoints = input.routePoints.map((point) => drawnPoint(point, input.portrait));
  const pinLabel = pinLabelPlacement(pin, input.portrait, true, {
    aisleNumber: input.aisleNumber,
    routePoints,
    blockedSegments: input.blockedSegments?.map(([a, b]) => [
      drawnPoint(a, input.portrait),
      drawnPoint(b, input.portrait),
    ]),
  });
  // Frame the aisle name where it is drawn: beside the YOU marker it steps aside.
  const shopperPoint = input.manualStart ? input.start ?? input.routePoints[0] : undefined;
  const aisleLabel = aisleLabelPlacement(input.aisleNumber, input.portrait, true, shopperPoint
    ? { shopper: drawnPoint(shopperPoint, input.portrait), routePoints }
    : {});
  const boxes: DrawnBox[] = [
    drawnBox(shelfBlock(input.aisleNumber), input.portrait),
    labelBoxOf(aisleLabel),
    pinLabelBoxOf(pinLabel),
    { x: pin.x - 14, y: pin.y - 14, width: 28, height: 28 },
  ];
  for (const point of approachPoints(input.routePoints, input.aisleNumber)) {
    const drawn = drawnPoint(point, input.portrait);
    boxes.push({ x: drawn.x - 10, y: drawn.y - 10, width: 20, height: 20 });
  }
  const stopBox = union(boxes);
  if (!input.portrait) {
    return fitFrame(stopBox, map, aspect);
  }

  let frameWidth = PORTRAIT_STORE_X.width;
  let frameHeight = Math.round(frameWidth / aspect);
  if (stopBox.height + 24 > frameHeight) {
    frameHeight = Math.min(map.height, stopBox.height + 24);
    frameWidth = Math.min(map.width, Math.round(frameHeight * aspect));
  }
  if (frameHeight >= map.height - 1) {
    return fullMapFrame(true);
  }

  let minY = stopBox.y;
  let maxY = stopBox.y + stopBox.height;
  const includeRange = (top: number, bottom: number) => {
    const nextMin = Math.min(minY, top);
    const nextMax = Math.max(maxY, bottom);
    if (nextMax - nextMin + 16 <= frameHeight) {
      minY = nextMin;
      maxY = nextMax;
    }
  };
  if (input.routePoints.length > 0) {
    const startBox = startMarkerBox(drawnPoint(input.routePoints[0], true), true, input.manualStart);
    includeRange(startBox.y, startBox.y + startBox.height);
  }
  const entranceText = entranceTextBox(true);
  includeRange(entranceText.y, entranceText.y + entranceText.height);
  includeRange(PORTRAIT_ENTRANCE_BAR.y, PORTRAIT_ENTRANCE_BAR.y + PORTRAIT_ENTRANCE_BAR.height);

  const left = Math.round((map.width - frameWidth) / 2);
  const centerY = (minY + maxY) / 2;
  const top = Math.min(Math.max(Math.round(centerY - frameHeight / 2), 0), map.height - frameHeight);
  return {
    x: left,
    y: top,
    width: frameWidth,
    height: frameHeight,
  };
}
