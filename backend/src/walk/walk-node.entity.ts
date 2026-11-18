import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * A junction in the store's walkable path graph, in the same 700x330 map
 * units the FloorPlan draws. Shelves are never nodes; nodes sit on the
 * corridor, the aisle centre lines, and the walkways around them.
 */
@Entity()
export class WalkNode {
  @PrimaryKey()
  id!: number;

  @Property()
  mapX!: number;

  @Property()
  mapY!: number;
}
