import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class StaffUser {
  @PrimaryKey()
  id!: number;

  @Property({ unique: true })
  username!: string;

  @Property()
  passwordHash!: string;

  @Property()
  createdAt: Date = new Date();
}
