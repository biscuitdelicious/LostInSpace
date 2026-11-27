import { Migration } from '@mikro-orm/migrations';

/**
 * Ties every staff session to the password version it was opened under.
 *
 * Existing rows all start at version 1, so upgrading does not sign anyone
 * out; from then on a password change bumps the account's version, and
 * sessions carrying an older one are refused (and swept) even if the
 * delete in the same startup missed them.
 */
export class Migration20261123120000_staff_credentials_version extends Migration {
  override up(): void {
    this.addSql(
      `alter table "staff_user" add column if not exists "credentials_version" int not null default 1;`,
    );
    this.addSql(
      `alter table "staff_auth_session" add column if not exists "credentials_version" int not null default 1;`,
    );
  }

  override down(): void {
    this.addSql(
      `alter table "staff_auth_session" drop column if exists "credentials_version";`,
    );
    this.addSql(
      `alter table "staff_user" drop column if exists "credentials_version";`,
    );
  }
}
