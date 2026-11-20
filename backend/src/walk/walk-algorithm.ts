/**
 * Shortest walks over the store's path graph (Dijkstra).
 *
 * Endpoints (a shelf pin, the entrance, a tapped shopper spot) are not
 * graph nodes: each one steps onto the graph at its nearest walkable
 * point — the aisle centre line at the pin's height, or a node it sits
 * on — as long as that step is a short, axis-parallel last mile that
 * never walks along or across a closed section. A blocked connection is
 * simply missing from the graph, so the search flows around it, and an
 * endpoint whose own aisle is closed has no legal step-on and reports no
 * path.
 *
 * The whole module is pure: the database only supplies nodes and edges.
 */

import { METERS_PER_MAP_UNIT } from './store-layout';

/** Map scale used for every reported walking distance. */

export const MAP_BOUNDS = { width: 700, height: 330 };

/**
 * How far an endpoint may walk to reach a walkway (map units). Shelf pins
 * sit 14 units off their aisle centre; anything farther — e.g. jumping to
 * the corridor a hundred units away — is not a legal step onto the graph.
 */
export const MAX_LAST_MILE_UNITS = 25;

export type WalkPoint = { x: number; y: number };
export type WalkNodeData = { id: number; x: number; y: number };
export type WalkEdgeData = {
  id: number;
  fromId: number;
  toId: number;
  blocked: boolean;
};

export type WalkRoute = { points: WalkPoint[]; meters: number };

export type WalkTripPlan = {
  /** Stop indices in visiting order (a permutation of 1..stops.length). */
  order: number[];
  /** One leg per entry in `order`; null when that leg has no walkable path. */
  legs: (WalkRoute | null)[];
  totalMeters: number;
};

type Link = { to: number; weight: number };
type OpenEdge = { id: number; a: WalkNodeData; b: WalkNodeData };
type Graph = {
  nodes: Map<number, WalkNodeData>;
  adjacency: Map<number, Link[]>;
  openEdges: OpenEdge[];
  blockedEdges: OpenEdge[];
};

function distance(a: WalkPoint, b: WalkPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function samePoint(a: WalkPoint, b: WalkPoint): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

export function buildGraph(
  nodes: WalkNodeData[],
  edges: WalkEdgeData[],
): Graph {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<number, Link[]>(nodes.map((node) => [node.id, []]));
  const openEdges: OpenEdge[] = [];
  const blockedEdges: OpenEdge[] = [];
  for (const edge of edges) {
    const a = nodeMap.get(edge.fromId);
    const b = nodeMap.get(edge.toId);
    if (!a || !b || a.id === b.id) continue;
    if (edge.blocked) {
      blockedEdges.push({ id: edge.id, a, b });
      continue;
    }
    const weight = distance(a, b);
    adjacency.get(a.id)!.push({ to: b.id, weight });
    adjacency.get(b.id)!.push({ to: a.id, weight });
    openEdges.push({ id: edge.id, a, b });
  }
  return { nodes: nodeMap, adjacency, openEdges, blockedEdges };
}

function sharesAxis(a: WalkPoint, b: WalkPoint): boolean {
  return Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01;
}

/** Closest point on segment `a`-`b` (clamped to the segment). */
function projectOnSegment(
  point: WalkPoint,
  a: WalkPoint,
  b: WalkPoint,
): WalkPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { ...a };
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

type Candidate = {
  node: number;
  /** Walk from the endpoint to this node, including any last-mile step. */
  cost: number;
  /** Attachment point on an edge when the endpoint is not at a node. */
  via: WalkPoint | null;
};

/**
 * True when the last-mile step p→q walks along or across the inside of a
 * closed section. Meeting a closed section exactly at one of its junction
 * endpoints is allowed: that is standing at (or walking through) the
 * junction, not crossing the closure. Without this check a shopper at the
 * junction below a closed aisle entrance could "step onto" the node just
 * past the closure — a straight walk through the closed walkway.
 */
function stepsThroughBlocked(
  p: WalkPoint,
  q: WalkPoint,
  blockedEdges: OpenEdge[],
): boolean {
  const EPS = 0.01;
  for (const { a, b } of blockedEdges) {
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const lengthSquared = sx * sx + sy * sy;
    if (lengthSquared < 1e-12) continue;
    const slack = EPS / Math.sqrt(lengthSquared);
    const rx = q.x - p.x;
    const ry = q.y - p.y;
    const stepLengthSquared = rx * rx + ry * ry;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) > 1e-9) {
      // Not parallel: at most one crossing point. t runs along the step,
      // u along the closed section; only u strictly inside counts.
      const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom;
      const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / denom;
      if (t >= -1e-9 && t <= 1 + 1e-9 && u > slack && u < 1 - slack) {
        return true;
      }
      continue;
    }
    if (stepLengthSquared < 1e-12) {
      // Zero-length step: only standing inside the closed section counts.
      const u = ((p.x - a.x) * sx + (p.y - a.y) * sy) / lengthSquared;
      if (u > slack && u < 1 - slack) {
        const on = { x: a.x + u * sx, y: a.y + u * sy };
        if (distance(p, on) < EPS) return true;
      }
      continue;
    }
    // Parallel: a shared stretch only counts when the segments are
    // collinear and the overlap has real length inside the closed section.
    const offLine = Math.abs((a.x - p.x) * ry - (a.y - p.y) * rx);
    if (offLine > EPS * Math.sqrt(stepLengthSquared)) continue;
    const t0 = ((p.x - a.x) * sx + (p.y - a.y) * sy) / lengthSquared;
    const t1 = ((q.x - a.x) * sx + (q.y - a.y) * sy) / lengthSquared;
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    if (hi - lo > slack && lo < 1 - slack && hi > slack) return true;
  }
  return false;
}

/**
 * Every legal place an endpoint can step onto the graph: graph nodes and
 * projections onto open edges, kept only when the step is short, walks
 * axis-parallel (or starts exactly on the graph), and stays off every
 * closed section.
 */
function attachCandidates(graph: Graph, point: WalkPoint): Candidate[] {
  // A pin belongs to the nearest physical walkway section. If that section
  // is closed, do not teleport the shopper to a neighbouring open segment
  // just because its endpoint happens to be within the last-mile radius.
  let nearestOpen = Infinity;
  let nearestBlocked = Infinity;
  for (const edge of graph.openEdges) {
    nearestOpen = Math.min(
      nearestOpen,
      distance(point, projectOnSegment(point, edge.a, edge.b)),
    );
  }
  for (const edge of graph.blockedEdges) {
    nearestBlocked = Math.min(
      nearestBlocked,
      distance(point, projectOnSegment(point, edge.a, edge.b)),
    );
  }
  if (nearestBlocked < nearestOpen - 0.01) return [];

  const candidates: Candidate[] = [];
  const accept = (on: WalkPoint): boolean => {
    const d = distance(point, on);
    if (d > MAX_LAST_MILE_UNITS) return false;
    if (!sharesAxis(point, on) && d >= 0.5) return false;
    return !stepsThroughBlocked(point, on, graph.blockedEdges);
  };

  for (const node of graph.nodes.values()) {
    const on = { x: node.x, y: node.y };
    if (accept(on))
      candidates.push({ node: node.id, cost: distance(point, on), via: null });
  }
  for (const edge of graph.openEdges) {
    const q = projectOnSegment(point, edge.a, edge.b);
    if (!accept(q)) continue;
    candidates.push({
      node: edge.a.id,
      cost: distance(point, q) + distance(q, edge.a),
      via: q,
    });
    candidates.push({
      node: edge.b.id,
      cost: distance(point, q) + distance(q, edge.b),
      via: q,
    });
  }
  return candidates;
}

/** Dijkstra from several sources at once; graphs here stay tiny. */
function dijkstra(
  graph: Graph,
  sources: Map<number, number>,
): { dist: Map<number, number>; prev: Map<number, number> } {
  const dist = new Map<number, number>(sources);
  const prev = new Map<number, number>();
  const settled = new Set<number>();
  for (;;) {
    let current: number | null = null;
    let best = Infinity;
    for (const [node, d] of dist) {
      if (!settled.has(node) && d < best - 1e-12) {
        best = d;
        current = node;
      }
    }
    if (current === null) break;
    settled.add(current);
    for (const link of graph.adjacency.get(current) ?? []) {
      const next = best + link.weight;
      if (next < (dist.get(link.to) ?? Infinity) - 1e-12) {
        dist.set(link.to, next);
        prev.set(link.to, current);
      }
    }
  }
  return { dist, prev };
}

function pushPoint(points: WalkPoint[], point: WalkPoint): void {
  const last = points[points.length - 1];
  if (!last || !samePoint(last, point)) {
    points.push({ x: point.x, y: point.y });
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function metersOf(points: WalkPoint[]): number {
  let units = 0;
  for (let i = 1; i < points.length; i += 1) {
    units += distance(points[i - 1], points[i]);
  }
  return Math.round(units * METERS_PER_MAP_UNIT * 10) / 10;
}

/** The shortest walk between two points, or null when none is walkable. */
export function shortestWalk(
  nodes: WalkNodeData[],
  edges: WalkEdgeData[],
  from: WalkPoint,
  to: WalkPoint,
): WalkRoute | null {
  const graph = buildGraph(nodes, edges);
  const sources = attachCandidates(graph, from);
  const targets = attachCandidates(graph, to);
  if (!sources.length || !targets.length) return null;

  // Multi-source Dijkstra: every legal step-on seeds its node with the
  // walk it takes to get there from the endpoint.
  const sourceSeeds = new Map<number, number>();
  const sourceCandidate = new Map<number, Candidate>();
  for (const candidate of sources) {
    const existing = sourceSeeds.get(candidate.node);
    if (existing === undefined || candidate.cost < existing - 1e-12) {
      sourceSeeds.set(candidate.node, candidate.cost);
      sourceCandidate.set(candidate.node, candidate);
    }
  }
  const { dist, prev } = dijkstra(graph, sourceSeeds);

  let chosen: { candidate: Candidate; total: number } | null = null;
  for (const candidate of targets) {
    const d = dist.get(candidate.node);
    if (d === undefined) continue;
    const total = d + candidate.cost;
    if (!chosen || total < chosen.total - 1e-12) {
      chosen = { candidate, total };
    }
  }
  if (!chosen) return null;

  const sequence: number[] = [];
  for (
    let current: number | undefined = chosen.candidate.node;
    current !== undefined;
    current = prev.get(current)
  ) {
    sequence.push(current);
  }
  sequence.reverse();

  const points: WalkPoint[] = [{ x: from.x, y: from.y }];
  const first = sequence[0];
  const source = sourceCandidate.get(first);
  if (source?.via) pushPoint(points, source.via);
  for (const nodeId of sequence) {
    const node = graph.nodes.get(nodeId);
    if (node) pushPoint(points, { x: node.x, y: node.y });
  }
  if (chosen.candidate.via) pushPoint(points, chosen.candidate.via);
  pushPoint(points, { x: to.x, y: to.y });

  return {
    points: points.map((point) => ({ x: round(point.x), y: round(point.y) })),
    meters: metersOf(points),
  };
}

/**
 * Order a list of stops by real walking distance: nearest neighbour from
 * the start over all-pairs shortest walks, then a 2-opt pass when every
 * pair is reachable. Unreachable stops keep their relative order at the
 * end with a null leg, so the shopper UI can show that section as closed
 * instead of drawing a route through it.
 */
export function planWalkTrip(
  nodes: WalkNodeData[],
  edges: WalkEdgeData[],
  from: WalkPoint,
  stops: WalkPoint[],
): WalkTripPlan {
  const points = [from, ...stops];
  const size = points.length;
  const matrix: (number | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  );
  for (let i = 0; i < size; i += 1) {
    matrix[i][i] = 0;
    for (let j = i + 1; j < size; j += 1) {
      const route = shortestWalk(nodes, edges, points[i], points[j]);
      const meters = route ? route.meters : null;
      matrix[i][j] = meters;
      matrix[j][i] = meters;
    }
  }

  const order: number[] = [];
  const remaining = stops.map((_, index) => index + 1);
  let current = 0;
  let reachable = true;
  while (remaining.length > 0) {
    let pick = -1;
    let best = Infinity;
    for (const index of remaining) {
      const meters = matrix[current][index];
      if (meters === null) continue;
      if (meters < best - 1e-9) {
        best = meters;
        pick = index;
      }
    }
    if (pick === -1) {
      order.push(...remaining);
      remaining.length = 0;
      reachable = false;
      break;
    }
    order.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
    current = pick;
  }

  // 2-opt only when the whole tour can actually be walked.
  if (reachable && order.length > 2) {
    for (let pass = 0; pass < 50; pass += 1) {
      let improved = false;
      for (let i = 0; i < order.length - 1 && !improved; i += 1) {
        for (let j = i + 1; j < order.length; j += 1) {
          const before = i === 0 ? 0 : order[i - 1];
          const after = j === order.length - 1 ? null : order[j + 1];
          const first = order[i];
          const last = order[j];
          const currentCost =
            (matrix[before][first] ?? 0) +
            (after === null ? 0 : (matrix[last][after] ?? 0));
          const swappedCost =
            (matrix[before][last] ?? 0) +
            (after === null ? 0 : (matrix[first][after] ?? 0));
          if (swappedCost < currentCost - 1e-9) {
            const reversed = order.slice(i, j + 1).reverse();
            order.splice(i, reversed.length, ...reversed);
            improved = true;
            break;
          }
        }
      }
      if (!improved) break;
    }
  }

  const legs: (WalkRoute | null)[] = [];
  let totalMeters = 0;
  let previous = 0;
  for (const index of order) {
    const leg = shortestWalk(nodes, edges, points[previous], points[index]);
    legs.push(leg);
    if (leg) totalMeters += leg.meters;
    previous = index;
  }

  return {
    order,
    legs,
    totalMeters: Math.round(totalMeters * 10) / 10,
  };
}
