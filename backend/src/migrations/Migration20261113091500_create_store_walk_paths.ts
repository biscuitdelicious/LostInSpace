import { Migration } from '@mikro-orm/migrations';

/**
 * The store's walkable paths: junctions plus the connections between them.
 * Both tables start empty — WalkService lays down the default walkways on
 * first boot — and no existing row is touched.
 */
export class Migration20261113091500_create_store_walk_paths extends Migration {
  override up(): void {
    this.addSql(
      `create table if not exists "walk_node" ("id" serial primary key, "map_x" int not null, "map_y" int not null);`,
    );
    this.addSql(
      `create table if not exists "walk_edge" ("id" serial primary key, "from_node_id" int not null, "to_node_id" int not null, "blocked" boolean not null default false);`,
    );
    this.addSql(
      `do $$
      begin
        if not exists (select 1 from pg_constraint where conname = 'walk_edge_from_node_id_foreign') then
          alter table "walk_edge" add constraint "walk_edge_from_node_id_foreign" foreign key ("from_node_id") references "walk_node" ("id") on update cascade on delete cascade;
        end if;
        if not exists (select 1 from pg_constraint where conname = 'walk_edge_to_node_id_foreign') then
          alter table "walk_edge" add constraint "walk_edge_to_node_id_foreign" foreign key ("to_node_id") references "walk_node" ("id") on update cascade on delete cascade;
        end if;
      end $$;`,
    );
    this.addSql(
      `create index if not exists "walk_edge_from_node_id_index" on "walk_edge" ("from_node_id");`,
    );
    this.addSql(
      `create index if not exists "walk_edge_to_node_id_index" on "walk_edge" ("to_node_id");`,
    );
  }

  override down(): void {
    this.addSql(`drop table if exists "walk_edge";`);
    this.addSql(`drop table if exists "walk_node";`);
  }
}
