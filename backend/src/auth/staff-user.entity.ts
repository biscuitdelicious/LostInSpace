import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class StaffUser {
  @PrimaryKey()
  id!: number;

  @Property({ unique: true })
  username!: string;

  @Property()
  passwordHash!: string;

  /**
   * Bumped every time the password changes. Sessions remember the version
   * they were opened under, so a password change ends them all even if a
   * session row were somehow missed.
   */
  @Property()
  credentialsVersion: number = 1;

  @Property()
  createdAt: Date = new Date();
}
