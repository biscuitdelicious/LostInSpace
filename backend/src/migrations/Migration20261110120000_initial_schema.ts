import { Migration } from '@mikro-orm/migrations';

/**
 * Baseline schema for products and "moved product" reports.
 *
 * Written with `if not exists` throughout so it can be adopted by a
 * database that was created by the old schema sync: on such a database
 * this migration is a no-op and the follow-up migration adds the columns
 * that are missing there. On an empty database it creates everything.
 */
export class Migration20261110120000_initial_schema extends Migration {
  override up(): void {
    this.addSql(
      `create table if not exists "product" ("id" serial primary key, "name" varchar(255) not null, "category" varchar(255) not null, "aisle_location" varchar(255) not null, "aisle_number" int not null, "map_x" int not null, "map_y" int not null);`,
    );
    this.addSql(
      `create table if not exists "product_report" ("id" serial primary key, "product_id" int not null, "product_name" varchar(255) not null, "kind" text check ("kind" in ('moved')) not null default 'moved', "status" text check ("status" in ('pending', 'confirmed', 'rejected')) not null default 'pending', "original_aisle_location" varchar(255) not null, "original_aisle_number" int not null, "original_map_x" int not null, "original_map_y" int not null, "reported_aisle_location" varchar(255) not null, "reported_aisle_number" int not null, "reported_map_x" int not null, "reported_map_y" int not null, "created_at" timestamptz not null);`,
    );
    this.addSql(
      `do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'product_report_product_id_foreign') then
          alter table "product_report" add constraint "product_report_product_id_foreign" foreign key ("product_id") references "product" ("id") on update cascade;
        end if;
      end $$;`,
    );
  }

  override down(): void {
    this.addSql(`drop table if exists "product_report";`);
    this.addSql(`drop table if exists "product";`);
  }
}
