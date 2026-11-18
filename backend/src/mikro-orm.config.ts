import path from 'node:path';
import dotenv from 'dotenv';
import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';
import { StaffSession } from './auth/staff-session.entity';
import { StaffUser } from './auth/staff-user.entity';
import { Product } from './products/product.entity';
import { ProductReport } from './reports/product-report.entity';
import { WalkEdge } from './walk/walk-edge.entity';
import { WalkNode } from './walk/walk-node.entity';

dotenv.config({
  path: [
    '.env',
    '../.env',
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
  ],
});

export default defineConfig({
  entities: [
    Product,
    ProductReport,
    StaffUser,
    StaffSession,
    WalkNode,
    WalkEdge,
  ],
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  dbName: process.env.DB_NAME ?? 'lis',
  extensions: [Migrator],
  // Schema changes only ever happen through the versioned files in
  // src/migrations — never through a schema sync at startup. Run them
  // with `npm run migration:up` (the app also applies pending ones
  // before it starts listening), and create new ones with
  // `npm run migration:create -- --name <change>`.
  migrations: {
    path: './dist/migrations',
    pathTs: './src/migrations',
    glob: '!(*.d).{js,ts}',
    transactional: true,
    allOrNothing: true,
  },
});
