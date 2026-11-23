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

  /**
   * True when the axis-parallel segment p→q walks along or across the
   * inside of the closed axis-parallel section a→b (touching only at an
   * endpoint of a→b does not count).
   */
  function sharesClosedInterior(
    p: { x: number; y: number },
    q: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): boolean {
    const EPS = 0.02;
    const vertical = (u: typeof p, v: typeof p) => Math.abs(u.x - v.x) < EPS;
    const horizontal = (u: typeof p, v: typeof p) => Math.abs(u.y - v.y) < EPS;
    const overlap = (
      lo1: number,
      hi1: number,
      lo2: number,
      hi2: number,
    ): boolean => {
      const lo = Math.max(Math.min(lo1, hi1), Math.min(lo2, hi2));
      const hi = Math.min(Math.max(lo1, hi1), Math.max(lo2, hi2));
      return (
        hi - lo > EPS &&
        lo < Math.max(lo2, hi2) - EPS &&
        hi > Math.min(lo2, hi2) + EPS
      );
    };
    const between = (v: number, lo: number, hi: number, strict: boolean) =>
      strict
        ? v > Math.min(lo, hi) + EPS && v < Math.max(lo, hi) - EPS
        : v >= Math.min(lo, hi) - EPS && v <= Math.max(lo, hi) + EPS;
    if (vertical(p, q) && vertical(a, b) && Math.abs(p.x - a.x) < EPS) {
      return overlap(p.y, q.y, a.y, b.y);
    }
    if (horizontal(p, q) && horizontal(a, b) && Math.abs(p.y - a.y) < EPS) {
      return overlap(p.x, q.x, a.x, b.x);
    }
    if (vertical(p, q) && horizontal(a, b)) {
      return between(p.x, a.x, b.x, true) && between(a.y, p.y, q.y, false);
    }
    if (horizontal(p, q) && vertical(a, b)) {
      return between(p.y, a.y, b.y, true) && between(a.x, p.x, q.x, false);
    }
    return false;
  }

  it('never steps onto or off the graph through a closed section, even from its own junction', () => {
    // The walkway between the corridor junction below aisle 1 and the
    // aisle entrance is closed (c79 -> a1_215).
    const closesEntrance = (fromKey: string, toKey: string) =>
      [fromKey, toKey].includes('c79') && [fromKey, toKey].includes('a1_215');
    const closed = withBlockedEdge(closesEntrance);
    const junction = { x: AISLE_CENTER_X[0], y: CORRIDOR_Y };
    const aisleMouth = { x: AISLE_CENTER_X[0], y: 215 };
    const pin = { x: AISLE_CENTER_X[0] - 14, y: 88 };
    const crossesClosure = (route: { points: { x: number; y: number }[] }) =>
      route.points.some(
        (point, index) =>
          index > 0 &&
          sharesClosedInterior(
            route.points[index - 1],
            point,
            junction,
            aisleMouth,
          ),
      );

    // A shopper standing right at the junction used to get a straight
    // 2.5 m "step onto the graph" through the closed walkway. Now the
    // route detours via the next aisle and the back walkway.
    const steppedOn = shortestWalk(closed.nodes, closed.edges, junction, pin);
    expect(steppedOn).not.toBeNull();
    expect(crossesClosure(steppedOn!)).toBe(false);
    expect(steppedOn!.points.some((point) => point.y === 55)).toBe(true);
    expect(steppedOn!.meters).toBeGreaterThan(2.5);
    expect(steppedOn!.detour).toEqual({
      closedSection: 'aisle 1 entrance',
      firstAisle: 2,
      via: 'back walkway',
      firstTurn: 'left',
    });

    // Stepping off at the junction follows the same rule.
    const steppedOff = shortestWalk(closed.nodes, closed.edges, pin, junction);
    expect(steppedOff).not.toBeNull();
    expect(crossesClosure(steppedOff!)).toBe(false);

    // The far end of the closure too: standing at the aisle mouth, the
    // walk to the entrance goes around, not down the closed strip.
    const fromMouth = shortestWalk(
      closed.nodes,
      closed.edges,
      aisleMouth,
      ENTRANCE_NODE,
    );
    expect(fromMouth).not.toBeNull();
    expect(crossesClosure(fromMouth!)).toBe(false);

    // Walking the corridor THROUGH the junction is still legal: the
    // closure is only met at its endpoint, never crossed.
    const alongCorridor = shortestWalk(
      closed.nodes,
      closed.edges,
      { x: AISLE_CENTER_X[1], y: CORRIDOR_Y },
      junction,
    );
    expect(alongCorridor?.meters).toBe(7.7);

    // With aisle 1's back-walkway link closed as well there is no open
    // detour left, so the route is unavailable rather than closed-strip.
    const sealed = withBlockedEdge(
      (fromKey, toKey) =>
        closesEntrance(fromKey, toKey) ||
        ([fromKey, toKey].includes('a1_55') &&
          [fromKey, toKey].includes('a2_55')),
    );
    expect(shortestWalk(sealed.nodes, sealed.edges, junction, pin)).toBeNull();
    expect(
      shortestWalk(sealed.nodes, sealed.edges, ENTRANCE_NODE, pin),
    ).toBeNull();
  });

  it('reports detour guidance only when a closure actually forces a longer walk', () => {
    const open = seededGraph();
    // Open graph: no detour metadata on a direct route.
    const direct = shortestWalk(open.nodeRows, open.edgeRows, ENTRANCE_NODE, {
      x: 525,
      y: 138,
    });
    expect(direct?.detour).toBeUndefined();

    // An unrelated closure (aisle 1 entrance) does not mark a walk to aisle 7 as a detour.
    const closesAisle1Entrance = (fromKey: string, toKey: string) =>
      [fromKey, toKey].includes('c79') && [fromKey, toKey].includes('a1_215');
    const aisle1Closed = withBlockedEdge(closesAisle1Entrance);
    const unaffected = shortestWalk(
      aisle1Closed.nodes,
      aisle1Closed.edges,
      ENTRANCE_NODE,
      { x: 525, y: 138 },
    );
    expect(unaffected?.detour).toBeUndefined();

    // Closing the corridor beside the entrance forces a walk to aisle 7 up aisle 4 first.
    const corridorClosed = withBlockedEdge(
      (fromKey, toKey) =>
        [fromKey, toKey].includes('c345') && [fromKey, toKey].includes('c387'),
    );
    const viaAisle4 = shortestWalk(
      corridorClosed.nodes,
      corridorClosed.edges,
      ENTRANCE_NODE,
      { x: 525, y: 138 },
    );
    expect(viaAisle4?.detour).toEqual({
      closedSection: 'front corridor',
      firstAisle: 4,
      via: 'back walkway',
      firstTurn: 'right',
    });

    // Standing right below aisle 2 with aisle 1 entrance closed goes straight up aisle 2.
    const fromAisle2Junction = shortestWalk(
      aisle1Closed.nodes,
      aisle1Closed.edges,
      { x: AISLE_CENTER_X[1], y: CORRIDOR_Y },
      { x: AISLE_CENTER_X[0] + 14, y: 105 },
    );
    expect(fromAisle2Junction?.detour).toEqual({
      closedSection: 'aisle 1 entrance',
      firstAisle: 2,
      via: 'back walkway',
      firstTurn: 'straight',
    });

    // Already inside aisle 1 near the closed entrance, walking to aisle 2 leaves via the back walkway.
    const leavingAisle1 = shortestWalk(
      aisle1Closed.nodes,
      aisle1Closed.edges,
      { x: AISLE_CENTER_X[0], y: 200 },
      { x: AISLE_CENTER_X[1] - 14, y: 180 },
    );
    expect(leavingAisle1?.detour).toEqual({
      closedSection: 'aisle 1 entrance',
      firstAisle: null,
      via: 'back walkway',
      firstTurn: 'right',
    });

    // Starting on the back walkway with the back of aisle 1 closed detours down aisle 2 and the front corridor.
    const backClosed = withBlockedEdge(
      (fromKey, toKey) =>
        [fromKey, toKey].includes('a1_55') &&
        [fromKey, toKey].includes('a1_88'),
    );
    const viaFront = shortestWalk(
      backClosed.nodes,
      backClosed.edges,
      { x: AISLE_CENTER_X[0], y: 55 },
      { x: AISLE_CENTER_X[0] + 14, y: 105 },
    );
    expect(viaFront?.detour).toEqual({
      closedSection: 'back of aisle 1',
      firstAisle: 2,
      via: 'front corridor',
      firstTurn: 'right',
    });
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
