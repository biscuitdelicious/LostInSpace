import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class Product {
  @PrimaryKey()
  id!: number;

  @Property()
  name!: string;

  @Property()
  category!: string;

  @Property()
  aisleLocation!: string;

  @Property()
  aisleNumber!: number;

  @Property()
  mapX!: number;

  @Property()
  mapY!: number;
}
