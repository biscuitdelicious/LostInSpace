import { defineConfig } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { User } from './entities/users.entities.js';

export default defineConfig({
  entities: [User],
  dbName: 'lis_db',
  driver: PostgreSqlDriver,
  port: 5432,
  user: 'postgres',
  password: 'grencofe',
  host: '127.0.0.1',
});
