/**
 * Client for the backend-owned walk graph and Dijkstra route planner.
 * No path finding or store-layout rules run in the app: it sends the
 * shopper's position and product pins, then draws the returned points.
 *
 * Keep this module free of react-native imports so plain Node tests run.
 */
import type { StoreProduct } from './products';
import { resolveApiBaseUrl } from './products';
import type { MapPoint, ProductRoute } from './route';
import { StaffUnauthorizedError } from './staff-auth';

export type WalkNode = { id: number; mapX: number; mapY: number; label: string };
export type WalkEdge = {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  blocked: boolean;
  /** Exact section name, e.g. "Aisle 7 · entrance end to middle". */
  name: string;
};
export type WalkGraph = { nodes: WalkNode[]; edges: WalkEdge[] };

export type ResolvedWalkEdge = WalkEdge & {
  from: MapPoint;
  to: MapPoint;
};

/** Pair each walkway connection with the map coordinates of its two junctions. */
export function resolveWalkEdges(
  graph: WalkGraph | null | undefined,
): ResolvedWalkEdge[] {
  if (!graph) return [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges: ResolvedWalkEdge[] = [];
  for (const edge of graph.edges) {
    const from = nodesById.get(edge.fromNodeId);
    const to = nodesById.get(edge.toNodeId);
    if (!from || !to) continue;
    edges.push({
      ...edge,
      from: { x: from.mapX, y: from.mapY },
      to: { x: to.mapX, y: to.mapY },
    });
  }
  return edges;
}

/** Closed walkways to draw on the shopper map. */
export function closedWalkEdges(
  graph: WalkGraph | null | undefined,
): ResolvedWalkEdge[] {
  return resolveWalkEdges(graph).filter((edge) => edge.blocked);
}

/**
 * Nearest walkway connection to a store-coordinate tap on the staff map, or
 * null when the tap is too far from any walkway. Near-ties at junctions or
 * overlapping cut-throughs prefer the segment whose midpoint is closer.
 */
export function findWalkEdgeAtPoint(
  point: MapPoint,
  graph: WalkGraph | null | undefined,
  maxDistance = 24,
): ResolvedWalkEdge | null {
  const edges = resolveWalkEdges(graph);
  let best: ResolvedWalkEdge | null = null;
  let bestDistance = Infinity;
  let bestMidpointDistance = Infinity;
  for (const edge of edges) {
    const dx = edge.to.x - edge.from.x;
    const dy = edge.to.y - edge.from.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - edge.from.x) * dx + (point.y - edge.from.y) * dy) /
                lengthSquared,
            ),
          );
    const projX = edge.from.x + t * dx;
    const projY = edge.from.y + t * dy;
    const distance = Math.hypot(point.x - projX, point.y - projY);
    if (distance > maxDistance) continue;
    const midX = (edge.from.x + edge.to.x) / 2;
    const midY = (edge.from.y + edge.to.y) / 2;
    const midpointDistance = Math.hypot(point.x - midX, point.y - midY);
    if (
      distance < bestDistance - 0.5 ||
      (Math.abs(distance - bestDistance) <= 0.5 &&
        midpointDistance < bestMidpointDistance)
    ) {
      best = edge;
      bestDistance = distance;
      bestMidpointDistance = midpointDistance;
    }
  }
  return best;
}

export type WalkRouteStop = {
  productId: number;
  route: { points: MapPoint[]; meters: number } | null;
};
export type WalkRouteResponse = { stops: WalkRouteStop[]; totalMeters: number };

/** Loads the current graph for change detection and the staff editor. */
export async function fetchWalkGraph(
  apiUrl = resolveApiBaseUrl(),
): Promise<WalkGraph | null> {
  try {
    const response = await fetch(`${apiUrl}/walk-graph`);
    if (!response.ok) return null;
    const data = (await response.json()) as { nodes?: unknown; edges?: unknown };
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
    if (data.nodes.length === 0) return null;
    return { nodes: data.nodes as WalkNode[], edges: data.edges as WalkEdge[] };
  } catch {
    return null;
  }
}

/**
 * Ask the backend for the shortest walk to each product. The response stops
 * are in visiting order. `keepFirst` keeps a running route's current target
 * fixed while the remaining list is optimised from that shelf.
 */
export async function requestWalkRoute(
  start: MapPoint,
  products: Pick<StoreProduct, 'id' | 'mapX' | 'mapY'>[],
  keepFirst = false,
  apiUrl = resolveApiBaseUrl(),
): Promise<WalkRouteResponse> {
  if (!products.length) return { stops: [], totalMeters: 0 };
  const response = await fetch(`${apiUrl}/walk/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start,
      products: products.map(({ id, mapX, mapY }) => ({ id, mapX, mapY })),
      keepFirst,
    }),
  });
  if (!response.ok) throw new Error(`Could not plan the route (${response.status}).`);
  const data = (await response.json()) as Partial<WalkRouteResponse>;
  if (!Array.isArray(data.stops) || data.stops.length !== products.length) {
    throw new Error('The store returned an incomplete route.');
  }
  const stops = data.stops.map((stop) => {
    if (!stop || !Number.isInteger(stop.productId)) {
      throw new Error('The store returned an invalid route stop.');
    }
    if (stop.route === null) return { productId: stop.productId, route: null };
    if (
      !stop.route ||
      !Array.isArray(stop.route.points) ||
      stop.route.points.length < 2 ||
      typeof stop.route.meters !== 'number'
    ) {
      throw new Error('The store returned an invalid route.');
    }
    return stop;
  });
  return { stops, totalMeters: typeof data.totalMeters === 'number' ? data.totalMeters : 0 };
}

/** Convert backend route points into the polyline the floor plan draws. */
export function toProductRoute(route: { points: MapPoint[]; meters: number }): ProductRoute {
  return {
    points: route.points,
    path: route.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '),
    distanceMeters: route.meters,
  };
}

/** Staff-only graph mutations; 401 means the staff session expired. */
export async function callWalkApi(
  token: string,
  path: string,
  init: { method: 'POST' | 'DELETE'; body?: unknown },
  apiUrl = resolveApiBaseUrl(),
): Promise<void> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: init.method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401) throw new StaffUnauthorizedError(text || 'Staff sign-in required.');
    throw new Error(text || `Walk request failed (${response.status})`);
  }
}