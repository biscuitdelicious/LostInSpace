import { seedWalkGraph } from './walk-graph.seed';
import {
  AISLE_CENTER_X,
  CORRIDOR_Y,
  ENTRANCE_NODE,
  METERS_PER_MAP_UNIT,
} from './store-layout';
import {
  MAP_BOUNDS,
  type WalkEdgeData,
  type WalkNodeData,
  buildGraph,
  planWalkTrip,
  shortestWalk,
} from './walk-algorithm';

/** The seeded graph as the service hands it to the algorithm. */
function seededGraph() {
  const { nodes, edges } = seedWalkGraph();
  const byKey = new Map(nodes.map((node, index) => [node.key, index + 1]));
  const nodeRows: WalkNodeData[] = nodes.map((node, index) => ({
    id: index + 1,
    x: node.x,
    y: node.y,
  }));
  const edgeRows: WalkEdgeData[] = edges.map(([fromKey, toKey], index) => ({
    id: index + 1,
    fromId: byKey.get(fromKey)!,
    toId: byKey.get(toKey)!,
    blocked: false,
  }));
  return { nodes, edges, nodeRows, edgeRows, byKey };
}

/** The seeded graph with one connection closed (blocked for restocking). */
function withBlockedEdge(
  matches: (fromKey: string, toKey: string) => boolean,
): { nodes: WalkNodeData[]; edges: WalkEdgeData[] } {
  const { edges, nodeRows, edgeRows } = seededGraph();
  return {
    nodes: nodeRows,
    edges: edgeRows.map((edge, index) => {
      const [fromKey, toKey] = edges[index];
      return matches(fromKey, toKey) ? { ...edge, blocked: true } : edge;
    }),
  };
}

const closesAisle = (aisleNumber: number) => (fromKey: string, toKey: string) =>
  fromKey.startsWith(`a${aisleNumber}_`) &&
  toKey.startsWith(`a${aisleNumber}_`);

describe('walk graph algorithm', () => {
  it('seeds the store: corridor, one centre line per aisle, and a back walkway', () => {
    const { nodes, edges, nodeRows, edgeRows } = seededGraph();
    // entrance + corridor junctions (8 aisle centres + the door's x) +
    // 4 spine steps per aisle; the back walkway only adds connections.
    expect(nodeRows.length).toBe(1 + 9 + 4 * 8);
    expect(edgeRows.length).toBe(8 + 1 + 8 * 4 + 7);
    expect(
      nodeRows.every((node) => node.x >= 0 && node.x <= MAP_BOUNDS.width),
    ).toBe(true);
    expect(
      nodeRows.every((node) => node.y >= 0 && node.y <= MAP_BOUNDS.height),
    ).toBe(true);

    // Every aisle centre line exists on the corridor.
    for (const x of AISLE_CENTER_X) {
      expect(nodes.some((node) => node.x === x && node.y === CORRIDOR_Y)).toBe(
        true,
      );
    }
    // The entrance drop onto the corridor is a real connection.
    expect(
      edges.some(
        ([fromKey, toKey]) =>
          (fromKey === 'entrance' && toKey === `c${ENTRANCE_NODE.x}`) ||
          (toKey === 'entrance' && fromKey === `c${ENTRANCE_NODE.x}`),
      ),
    ).toBe(true);
    expect(buildGraph(nodeRows, edgeRows).adjacency.size).toBe(nodeRows.length);
  });

  it('reproduces the old corridor walk: pin → aisle centre → corridor → entrance', () => {
    const { nodeRows, edgeRows } = seededGraph();
    // Whole Milk 1L: map (525, 138), aisle 7 centre x = 541, corridor 240.
    const route = shortestWalk(nodeRows, edgeRows, ENTRANCE_NODE, {
      x: 525,
      y: 138,
    });
    expect(route).not.toBeNull();
    const points = route!.points;
    expect(points[0]).toEqual(ENTRANCE_NODE);
    expect(points[points.length - 1]).toEqual({ x: 525, y: 138 });
    // Joins the corridor and climbs the aisle 7 centre line on the way.
    expect(points).toContainEqual({ x: 345, y: CORRIDOR_Y });
    expect(points).toContainEqual({ x: 541, y: 138 });

    // Old formula: entrance drop + corridor run + aisle climb + pin step.
    const expectedUnits =
      Math.abs(541 - 345) +
      (CORRIDOR_Y - 138) +
      Math.abs(541 - 525) +
      Math.abs(268 - 240);
    expect(route!.meters).toBeCloseTo(expectedUnits * METERS_PER_MAP_UNIT, 1);
  });

  it('detours from the entrance around the exact corridor closure used by staff', () => {
    const { nodeRows, edgeRows, byKey } = seededGraph();
    const closed = edgeRows.map((edge) => {
      const pair = new Set([edge.fromId, edge.toId]);
      return pair.has(byKey.get('c345')!) && pair.has(byKey.get('c387')!)
        ? { ...edge, blocked: true }
        : edge;
    });
    const route = shortestWalk(nodeRows, closed, ENTRANCE_NODE, {
      x: 525,
      y: 138,
    });
    expect(route?.meters).toBe(57.8);
    expect(route?.points.some((point) => point.y === 55)).toBe(true);
    expect(route?.points).toContainEqual({ x: 310, y: 55 });
    expect(route?.points).toContainEqual({ x: 541, y: 55 });
  });

  it('routes around a walkway blocked for restocking', () => {
    const open = seededGraph();
    const aisle5 = 5;

    // An aisle closed for restocking: its centre line is shut, so a pin
    // inside it can no longer be reached at all — the last mile only
    // touches the closed walkway.
    const aisleClosed = withBlockedEdge(closesAisle(aisle5));
    expect(
      shortestWalk(aisleClosed.nodes, aisleClosed.edges, ENTRANCE_NODE, {
        x: AISLE_CENTER_X[4],
        y: 108,
      }),
    ).toBeNull();

    // A corridor segment closed (pallets between the aisle 5 and 6
    // junctions): the walk still gets through, but around via the back
    // walkway, and it is longer than the open-corridor walk.
    const [left, right] = [`c${AISLE_CENTER_X[4]}`, `c${AISLE_CENTER_X[5]}`];
    const segmentClosed = withBlockedEdge(
      (fromKey, toKey) =>
        [left, right].includes(fromKey) && [left, right].includes(toKey),
    );
    const openRoute = shortestWalk(
      open.nodeRows,
      open.edgeRows,
      ENTRANCE_NODE,
      {
        x: 464,
        y: 108,
      },
    )!;
    const detour = shortestWalk(
      segmentClosed.nodes,
      segmentClosed.edges,
      ENTRANCE_NODE,
      {
        x: 464,
        y: 108,
      },
    )!;
    expect(detour).not.toBeNull();
    expect(detour.meters).toBeGreaterThan(openRoute.meters);
    // The detour climbs to the back walkway instead of walking the
    // blocked corridor strip.
    expect(detour.points.some((point) => point.y < CORRIDOR_Y - 100)).toBe(
      true,
    );
    const crossesStrip = detour.points.some((point, index) => {
      if (index === 0) return false;
      const previous = detour.points[index - 1];
      const [low, high] = [
        Math.min(previous.x, point.x),
        Math.max(previous.x, point.x),
      ];
      return (
        Math.abs(previous.y - CORRIDOR_Y) < 0.01 &&
        Math.abs(point.y - CORRIDOR_Y) < 0.01 &&
        low <= AISLE_CENTER_X[4] &&
        high >= AISLE_CENTER_X[5]
      );
    });
    expect(crossesStrip).toBe(false);
  });

  it('treats a shelf in a single blocked aisle section as unreachable', () => {
    const { nodeRows, edgeRows, byKey } = seededGraph();
    const closed = edgeRows.map((edge) =>
      (edge.fromId === byKey.get('a7_151') &&
        edge.toId === byKey.get('a7_88')) ||
      (edge.toId === byKey.get('a7_151') && edge.fromId === byKey.get('a7_88'))
        ? { ...edge, blocked: true }
        : edge,
    );
    // Whole Milk sits beside this exact middle section (aisle 7, y=138).
    expect(
      shortestWalk(nodeRows, closed, ENTRANCE_NODE, { x: 525, y: 138 }),
    ).toBeNull();
    // The closure does not disconnect an unrelated aisle.
    expect(
      shortestWalk(nodeRows, closed, ENTRANCE_NODE, { x: 464, y: 138 }),
    ).not.toBeNull();
  });

  it('plans a shopping trip in walking order and sums its legs', () => {
    const { nodeRows, edgeRows } = seededGraph();
    const stops = [
      { x: 599, y: 192 }, // Sparkling Mineral Water (aisle 8)
      { x: 525, y: 138 }, // Whole Milk 1L (aisle 7)
      { x: 55, y: 160 }, // Sourdough Bread (aisle 1)
    ];
    const plan = planWalkTrip(nodeRows, edgeRows, ENTRANCE_NODE, stops);
    // `order` indexes the point list (0 = entrance), so these are stops 1..3.
    expect([...plan.order].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(plan.legs).toHaveLength(3);
    expect(plan.legs.every((leg) => leg !== null)).toBe(true);
    expect(plan.totalMeters).toBeGreaterThan(0);
    expect(plan.totalMeters).toBeCloseTo(
      plan.legs.reduce((sum, leg) => sum + (leg?.meters ?? 0), 0),
      5,
    );
    // The two neighbouring aisles (8 then 7) come before the far one.
    const visitOrder = plan.order.map((index) => index - 1);
    expect(visitOrder.indexOf(1)).toBeLessThan(visitOrder.indexOf(2));
  });

  it('reports no walk when the endpoints are off the graph', () => {
    const { nodeRows, edgeRows } = seededGraph();
    expect(
      shortestWalk(nodeRows, edgeRows, { x: 0, y: 0 }, { x: 690, y: 320 }),
    ).toBeNull();
    const closed = edgeRows.map((edge) => ({ ...edge, blocked: true }));
    expect(
      shortestWalk(nodeRows, closed, ENTRANCE_NODE, { x: 55, y: 160 }),
    ).toBeNull();
  });
});
