import {
  Entity,
  PrimaryKey,
  Property,
  SerializedPrimaryKey,
} from '@mikro-orm/core';

@Entity()
export class User {
  @PrimaryKey()
  _id!: string;

  @SerializedPrimaryKey()
  id!: string;

  @Property({ length: 35, fieldName: 'username' })
  username!: string;

  @Property({ fieldName: 'password' })
  password!: string;

  @Property({ fieldName: 'created_at' })
  createdAt = new Date();

  @Property({ onUpdate: () => new Date(), fieldName: 'updated_at' })
  updatedAt = new Date();

  @Property({ fieldName: 'email ' })
  email?: string; // Optional for now
}
