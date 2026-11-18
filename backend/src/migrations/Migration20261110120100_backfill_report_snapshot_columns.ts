import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the report snapshot columns (`product_name`, `kind`, and the
 * `original_*` shelf) to databases whose `product_report` table predates
 * them.
 *
 * The old schema sync crashed here: it added `product_name` as NOT NULL
 * with no value for the rows already in the table. This migration instead
 * adds each column as nullable, backfills it from the product the report
 * belongs to, and only then makes it required — so every existing report
 * survives. On a database created by the initial migration the columns
 * already exist and the backfills simply match no incomplete rows.
 */
export class Migration20261110120100_backfill_report_snapshot_columns extends Migration {
  override up(): void {
    this.addSql(
      `alter table "product_report" add column if not exists "product_name" varchar(255);`,
    );
    this.addSql(
      `alter table "product_report" add column if not exists "kind" text check ("kind" in ('moved')) default 'moved';`,
    );
    this.addSql(
      `alter table "product_report" add column if not exists "original_aisle_location" varchar(255);`,
    );
    this.addSql(
      `alter table "product_report" add column if not exists "original_aisle_number" int;`,
    );
    this.addSql(
      `alter table "product_report" add column if not exists "original_map_x" int;`,
    );
    this.addSql(
      `alter table "product_report" add column if not exists "original_map_y" int;`,
    );

    // Fill the new columns from the reported product. The original shelf
    // was the product's shelf when the report was made; the product's
    // current shelf is the best record of it for these pending reports.
    this.addSql(
      `update "product_report" as "report" set "product_name" = "product"."name" from "product" where "product"."id" = "report"."product_id" and ("report"."product_name" is null or "report"."product_name" = '');`,
    );
    this.addSql(
      `update "product_report" set "kind" = 'moved' where "kind" is null;`,
    );
    this.addSql(
      `update "product_report" as "report" set "original_aisle_location" = "product"."aisle_location", "original_aisle_number" = "product"."aisle_number", "original_map_x" = "product"."map_x", "original_map_y" = "product"."map_y" from "product" where "product"."id" = "report"."product_id" and ("report"."original_aisle_location" is null or "report"."original_aisle_number" is null or "report"."original_map_x" is null or "report"."original_map_y" is null);`,
    );

    // Databases created by the initial migration already have this
    // shape; bring a legacy varchar status column in line as well.
    this.addSql(
      `alter table "product_report" alter column "status" type text using "status"::text;`,
    );
    this.addSql(
      `alter table "product_report" alter column "status" set default 'pending';`,
    );
    this.addSql(
      `do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'product_report_status_check') then
          alter table "product_report" add constraint "product_report_status_check" check ("status" in ('pending', 'confirmed', 'rejected'));
        end if;
      end $$;`,
    );

    this.addSql(
      `alter table "product_report" alter column "product_name" set not null;`,
    );
    this.addSql(
      `alter table "product_report" alter column "kind" set default 'moved';`,
    );
    this.addSql(
      `alter table "product_report" alter column "kind" set not null;`,
    );
    this.addSql(
      `alter table "product_report" alter column "original_aisle_location" set not null;`,
    );
    this.addSql(
      `alter table "product_report" alter column "original_aisle_number" set not null;`,
    );
    this.addSql(
      `alter table "product_report" alter column "original_map_x" set not null;`,
    );
    this.addSql(
      `alter table "product_report" alter column "original_map_y" set not null;`,
    );
  }

  override down(): void {
    this.addSql(
      `alter table "product_report" drop column if exists "original_map_y";`,
    );
    this.addSql(
      `alter table "product_report" drop column if exists "original_map_x";`,
    );
    this.addSql(
      `alter table "product_report" drop column if exists "original_aisle_number";`,
    );
    this.addSql(
      `alter table "product_report" drop column if exists "original_aisle_location";`,
    );
    this.addSql(`alter table "product_report" drop column if exists "kind";`);
    this.addSql(
      `alter table "product_report" drop column if exists "product_name";`,
    );
  }
}
