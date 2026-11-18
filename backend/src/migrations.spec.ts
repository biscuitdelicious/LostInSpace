import { Migration20261110120000_initial_schema } from './migrations/Migration20261110120000_initial_schema';
import { Migration20261110120100_backfill_report_snapshot_columns } from './migrations/Migration20261110120100_backfill_report_snapshot_columns';
import { Migration20261112120000_create_staff_auth_tables } from './migrations/Migration20261112120000_create_staff_auth_tables';

function queriesOf(migration: {
  up(): Promise<void> | void;
  getQueries(): unknown[];
}): Promise<string[]> {
  return Promise.resolve(migration.up()).then(() =>
    migration.getQueries().map((query) => String(query)),
  );
}

describe('database migrations', () => {
  it('the baseline adopts an existing database instead of recreating it', async () => {
    const migration = new Migration20261110120000_initial_schema(
      null as never,
      null as never,
    );
    const queries = await queriesOf(migration);
    expect(queries[0]).toContain('create table if not exists "product"');
    expect(queries[1]).toContain('create table if not exists "product_report"');
    expect(queries.join('\n')).toContain('product_report_product_id_foreign');
  });

  it('the snapshot columns are added nullable, backfilled, then made required', async () => {
    const migration =
      new Migration20261110120100_backfill_report_snapshot_columns(
        null as never,
        null as never,
      );
    const sql = (await queriesOf(migration)).join('\n');

    // Added without a NOT NULL constraint, so existing reports cannot
    // fail the way they did under the old schema sync.
    expect(sql).toContain(
      'add column if not exists "product_name" varchar(255);',
    );
    expect(sql).not.toContain(
      'add column if not exists "product_name" varchar(255) not null',
    );
    for (const column of [
      'kind',
      'original_aisle_location',
      'original_aisle_number',
      'original_map_x',
      'original_map_y',
    ]) {
      expect(sql).toContain(`add column if not exists "${column}"`);
    }

    // Existing rows are filled from their product before the columns
    // become required, and the backfill runs before the tightening.
    expect(sql).toContain('set "product_name" = "product"."name"');
    expect(sql).toContain('set "kind" = \'moved\' where "kind" is null');
    expect(sql).toContain('"original_map_y" = "product"."map_y"');
    expect(sql.indexOf('set "product_name"')).toBeLessThan(
      sql.indexOf('alter column "product_name" set not null'),
    );
    for (const column of [
      'product_name',
      'kind',
      'original_aisle_location',
      'original_aisle_number',
      'original_map_x',
      'original_map_y',
    ]) {
      expect(sql).toContain(`alter column "${column}" set not null`);
    }
  });

  it('staff auth tables are added idempotently without altering product or report tables', async () => {
    const migration = new Migration20261112120000_create_staff_auth_tables(
      null as never,
      null as never,
    );
    const sql = (await queriesOf(migration)).join('\n');
    expect(sql).toContain('create table if not exists "staff_user"');
    expect(sql).toContain('create table if not exists "staff_auth_session"');
    expect(sql).toContain('staff_auth_session_user_id_foreign');
    expect(sql).not.toContain('"product"');
    expect(sql).not.toContain('"product_report"');
  });
});
