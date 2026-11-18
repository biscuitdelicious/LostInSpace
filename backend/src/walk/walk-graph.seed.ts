import {
  AISLE_CENTER_X,
  CORRIDOR_Y,
  ENTRANCE_NODE,
  SPINE_STEPS_Y,
  TOP_WALKWAY_Y,
} from './store-layout';

/**
 * Default walkable paths: the entrance joins the corridor below the aisles,
 * every aisle has a centre line, and a back walkway provides a detour when
 * staff close a connection. Geometry lives in store-layout.ts.
 */
export type SeedWalkNode = { key: string; x: number; y: number };
export type SeedWalkEdge = [string, string];

export function seedWalkGraph(): {
  nodes: SeedWalkNode[];
  edges: SeedWalkEdge[];
} {
  const nodes: SeedWalkNode[] = [];
  const edges: SeedWalkEdge[] = [];
  const addNode = (key: string, x: number, y: number) => {
    nodes.push({ key, x, y });
  };

  addNode('entrance', ENTRANCE_NODE.x, ENTRANCE_NODE.y);

  const corridorXs = [...new Set([...AISLE_CENTER_X, ENTRANCE_NODE.x])].sort(
    (a, b) => a - b,
  );
  for (const x of corridorXs) addNode(`c${x}`, x, CORRIDOR_Y);
  for (let i = 1; i < corridorXs.length; i += 1) {
    edges.push([`c${corridorXs[i - 1]}`, `c${corridorXs[i]}`]);
  }
  edges.push(['entrance', `c${ENTRANCE_NODE.x}`]);

  AISLE_CENTER_X.forEach((x, index) => {
    const aisle = index + 1;
    let previous = `c${x}`;
    for (const y of SPINE_STEPS_Y) {
      const key = `a${aisle}_${y}`;
      addNode(key, x, y);
      edges.push([previous, key]);
      previous = key;
    }
  });

  for (let i = 1; i < AISLE_CENTER_X.length; i += 1) {
    edges.push([`a${i}_${TOP_WALKWAY_Y}`, `a${i + 1}_${TOP_WALKWAY_Y}`]);
  }

  return { nodes, edges };
}
