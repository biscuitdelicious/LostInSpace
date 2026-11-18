import type { MapPoint } from './route';
import { STORE_MAP } from './shelf-location';
import { resolveWalkEdges, type WalkGraph } from './walk-graph';

/**
 * Shopper positioning is deliberately separate from routing. A future ESP32
 * board can provide the same MapPoint while it is in range; this manual tap is
 * the fallback for iPhones and for times when no board can locate the shopper.
 * Nothing in this module finds a route or reorders shopping stops.
 */

const STORE_WALL_INSET = 15;

function projection(point: MapPoint, from: MapPoint, to: MapPoint): { point: MapPoint; distance: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  const projected = { x: from.x + t * dx, y: from.y + t * dy };
  return { point: projected, distance: Math.hypot(point.x - projected.x, point.y - projected.y) };
}

export function insideStoreWalls(point: MapPoint): boolean {
  return point.x >= STORE_WALL_INSET
    && point.y >= STORE_WALL_INSET
    && point.x <= STORE_MAP.width - STORE_WALL_INSET
    && point.y <= STORE_MAP.height - STORE_WALL_INSET;
}

/**
 * Put a tapped position on the closest open walkway. Shoppers never see the
 * open paths, so every tap inside the store has an answer: no "near a
 * walkway" error to guess at. A closed section is never a landing point —
 * the shopper is placed on the nearest open one instead. Returns null only
 * outside the store walls or when the store has no open walkway at all.
 * The returned point is sent unchanged to the backend, which remains
 * responsible for attachment and Dijkstra routing.
 */
export function tappedWalkwayPosition(point: MapPoint, graph: WalkGraph | null): MapPoint | null {
  if (!graph || !insideStoreWalls(point)) return null;
  let nearest: { point: MapPoint; distance: number } | null = null;
  for (const edge of resolveWalkEdges(graph)) {
    if (edge.blocked) continue;
    const candidate = projection(point, edge.from, edge.to);
    if (!nearest || candidate.distance < nearest.distance - 0.01) {
      nearest = candidate;
    }
  }
  if (!nearest) return null;
  return {
    x: Math.round(nearest.point.x * 100) / 100,
    y: Math.round(nearest.point.y * 100) / 100,
  };
}
