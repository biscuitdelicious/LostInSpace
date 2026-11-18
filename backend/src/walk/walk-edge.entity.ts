import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { WalkNode } from './walk-node.entity';

/**
 * An undirected walkway connection between two nodes. `blocked` closes the
 * walkway (an aisle closed for restocking) without deleting it, so shopper
 * routes flow around it and staff can reopen the connection later.
 */
@Entity()
export class WalkEdge {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => WalkNode, {
    fieldName: 'from_node_id',
    deleteRule: 'cascade',
  })
  from!: WalkNode;

  @ManyToOne(() => WalkNode, {
    fieldName: 'to_node_id',
    deleteRule: 'cascade',
  })
  to!: WalkNode;

  @Property()
  blocked = false;
}
