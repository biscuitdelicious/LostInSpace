// Keep this import first: it refuses to start on sample or missing secrets
// before any other module reads the configuration.
import './config/refuse-unsafe-env';
import { MikroORM } from '@mikro-orm/postgresql';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import mikroOrmConfig from './mikro-orm.config';

/**
 * Apply pending migrations before the app starts, so seeding and request
 * handling never run against a half-updated schema. This replaces the old
 * `schema.updateSchema()` sync: a new column now arrives as a migration
 * that can add it nullable, backfill existing rows, and only then make it
 * required, instead of crashing on the rows already in the table.
 */
async function runMigrations(): Promise<void> {
  const orm = await MikroORM.init({
    ...mikroOrmConfig,
    migrations: { ...mikroOrmConfig.migrations, snapshot: false },
  });
  try {
    await orm.getMigrator().up();
  } finally {
    await orm.close();
  }
}

async function bootstrap() {
  await runMigrations();
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
}
void bootstrap();
