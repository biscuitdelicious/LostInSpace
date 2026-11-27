import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { StaffUser } from './staff-user.entity';

@Entity({ tableName: 'staff_auth_session' })
export class StaffSession {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => StaffUser, { deleteRule: 'cascade' })
  user!: StaffUser;

  @Property({ unique: true })
  tokenHash!: string;

  /** The account's password version at sign-in; older sessions are refused. */
  @Property()
  credentialsVersion: number = 1;

  @Property()
  createdAt: Date = new Date();

  @Property()
  expiresAt!: Date;
}
