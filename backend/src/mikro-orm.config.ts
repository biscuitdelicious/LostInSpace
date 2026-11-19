import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';
import { StaffSession } from './auth/staff-session.entity';
import { StaffUser } from './auth/staff-user.entity';
import { databasePassword, loadEnvFiles } from './config/safe-env';
import { Product } from './products/product.entity';
import { ProductReport } from './reports/product-report.entity';
import { WalkEdge } from './walk/walk-edge.entity';
import { WalkNode } from './walk/walk-node.entity';

loadEnvFiles();

export default defineConfig({
  entities: [
    Product,
    ProductReport,
    StaffUser,
    StaffSession,
    WalkNode,
    WalkEdge,
  ],
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'postgres',
  // No default password: a missing or sample DB_PASSWORD stops the app,
  // the migration CLI and the tests alike, instead of quietly trying
  // "postgres".
  password: databasePassword(process.env),
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
