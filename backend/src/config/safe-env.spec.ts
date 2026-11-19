import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  EXAMPLE_FILE_STAFF_PASSWORDS,
  UnsafeConfigurationError,
  assertSafeSettings,
  databasePassword,
  isSampleValue,
  unsafeSettings,
} from './safe-env';

const backendRoot = path.resolve(__dirname, '../..');

function parseEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return values;
}

const real = {
  DB_USER: 'postgres',
  DB_PASSWORD: 'k3-own-database-password-71',
  STAFF_USERNAME: 'staff',
  STAFF_PASSWORD: 'own-staff-password-58',
  STAFF_DEVICE_SECRET: 'own-device-secret-0123456789abcdef',
};

describe('Startup secret checks', () => {
  it('accepts real values, and an unset staff password or device secret', () => {
    expect(unsafeSettings(real)).toEqual([]);
    expect(() => assertSafeSettings(real)).not.toThrow();
    expect(databasePassword(real)).toBe(real.DB_PASSWORD);
    expect(
      unsafeSettings({ DB_PASSWORD: real.DB_PASSWORD, STAFF_PASSWORD: '' }),
    ).toEqual([]);
  });

  it('refuses a missing, default or sample database password', () => {
    for (const bad of [
      undefined,
      '',
      '   ',
      'postgres',
      'Postgres',
      'password',
      'change-me',
      'replace-with-db-password',
      '<password>',
    ]) {
      const env = { ...real, DB_PASSWORD: bad };
      expect(unsafeSettings(env)).toHaveLength(1);
      expect(unsafeSettings(env)[0]).toContain('DB_PASSWORD');
      expect(() => databasePassword(env)).toThrow(UnsafeConfigurationError);
    }
    // The old built-in defaults (user and password both "postgres") are gone.
    expect(() => databasePassword({})).toThrow(/DB_PASSWORD is not set/);
    expect(
      unsafeSettings({ ...real, DB_USER: 'lis', DB_PASSWORD: 'LIS' })[0],
    ).toContain('same as the database user');
  });

  it('refuses sample staff passwords and device secrets, naming every problem at once', () => {
    for (const sample of EXAMPLE_FILE_STAFF_PASSWORDS) {
      expect(unsafeSettings({ ...real, STAFF_PASSWORD: sample })[0]).toContain(
        'STAFF_PASSWORD',
      );
    }
    expect(unsafeSettings({ ...real, STAFF_PASSWORD: 'staff' })[0]).toContain(
      'same as STAFF_USERNAME',
    );

    const everything = {
      DB_PASSWORD: 'postgres',
      STAFF_PASSWORD: 'replace-with-staff-password',
      STAFF_DEVICE_SECRET: 'replace-with-a-long-random-string',
    };
    expect(unsafeSettings(everything)).toHaveLength(3);
    try {
      assertSafeSettings(everything);
      throw new Error('expected the check to refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeConfigurationError);
      const message = (error as Error).message;
      expect(message).toContain('Refusing to start');
      for (const name of [
        'DB_PASSWORD',
        'STAFF_PASSWORD',
        'STAFF_DEVICE_SECRET',
      ]) {
        expect(message).toContain(name);
      }
      // The message explains what is wrong without echoing any value.
      expect(message).not.toContain('replace-with-staff-password');
    }
  });

  it('does not mistake ordinary strong values for samples', () => {
    for (const fine of [
      'mictest',
      'k3-own-database-password-71',
      'postgres-9f2c1e7ab4',
      'u09D1+f0X3K0yHeTSyxxjUKSSw00DVbcR81UPG0/7G8=',
    ]) {
      expect(isSampleValue(fine)).toBe(false);
    }
  });

  it('ships example files with no usable secret, and they cannot start the backend unchanged', () => {
    const secretNames = [
      'DB_PASSWORD',
      'STAFF_PASSWORD',
      'STAFF_DEVICE_SECRET',
    ];
    for (const file of [
      path.join(backendRoot, '.env.example'),
      path.join(backendRoot, '..', '.env.example'),
    ]) {
      const values = parseEnvFile(file);
      for (const name of secretNames) {
        if (name in values) expect(values[name]).toBe('');
      }
    }
    const copied = parseEnvFile(path.join(backendRoot, '.env.example'));
    expect(() => assertSafeSettings(copied)).toThrow(UnsafeConfigurationError);
  });

  it('the ORM configuration has no fallback password of its own', () => {
    const source = readFileSync(
      path.join(backendRoot, 'src', 'mikro-orm.config.ts'),
      'utf8',
    );
    expect(source).toContain('password: databasePassword(process.env)');
    expect(source).not.toMatch(/DB_PASSWORD\s*(\?\?|\|\|)/);
  });

  it('keeps docker compose free of a default password and off the network', () => {
    const compose = readFileSync(
      path.join(backendRoot, 'docker-compose.yml'),
      'utf8',
    );
    // No fallback password, and compose itself stops when it is missing.
    expect(compose).not.toMatch(/DB_PASSWORD:-/);
    expect(compose).toMatch(/POSTGRES_PASSWORD: \$\{DB_PASSWORD:\?/);
    // Every published port is bound to this machine only.
    const ports = compose
      .split('\n')
      .filter((line) =>
        /^\s*-\s*['"]?[\d.$:{}A-Z_a-z-]*:5432['"]?\s*$/.test(line),
      );
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatch(/['"]127\.0\.0\.1:/);
  });
});
