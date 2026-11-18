import { Migration } from '@mikro-orm/migrations';

/**
 * Adds staff accounts (with hashed passwords) and server-side staff sessions
 * without touching existing products or shopper reports.
 */
export class Migration20261112120000_create_staff_auth_tables extends Migration {
  override up(): void {
    this.addSql(
      `create table if not exists "staff_user" ("id" serial primary key, "username" varchar(255) not null, "password_hash" varchar(512) not null, "created_at" timestamptz not null default now());`,
    );
    this.addSql(
      `create unique index if not exists "staff_user_username_unique" on "staff_user" ("username");`,
    );
    this.addSql(
      `create table if not exists "staff_auth_session" ("id" serial primary key, "user_id" int not null, "token_hash" varchar(128) not null, "created_at" timestamptz not null default now(), "expires_at" timestamptz not null);`,
    );
    this.addSql(
      `create unique index if not exists "staff_auth_session_token_hash_unique" on "staff_auth_session" ("token_hash");`,
    );
    this.addSql(
      `do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'staff_auth_session_user_id_foreign') then
          alter table "staff_auth_session" add constraint "staff_auth_session_user_id_foreign" foreign key ("user_id") references "staff_user" ("id") on update cascade on delete cascade;
        end if;
      end $$;`,
    );
  }

  override down(): void {
    this.addSql(`drop table if exists "staff_auth_session";`);
    this.addSql(`drop table if exists "staff_user";`);
  }
}
