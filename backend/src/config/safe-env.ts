import path from 'node:path';
import dotenv from 'dotenv';

export type Env = Record<string, string | undefined>;

/**
 * Where settings are read from, first match wins: backend/.env, then the
 * repo-root .env. Real environment variables always win over both.
 */
export const ENV_FILE_PATHS = [
  '.env',
  '../.env',
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env'),
];

export function loadEnvFiles(): void {
  dotenv.config({ path: ENV_FILE_PATHS, quiet: true });
}

/**
 * Staff passwords that an example file in this repo has ever shipped.
 * They are public, so an account that still has one is disabled at startup
 * (see AuthService) even if .env no longer mentions it.
 */
export const EXAMPLE_FILE_STAFF_PASSWORDS = ['replace-with-staff-password'];

/** Well-known defaults that are never acceptable as a real secret. */
const DEFAULT_VALUES = new Set([
  'postgres',
  'password',
  'passwd',
  'secret',
  'admin',
  'default',
  'example',
  'changeme',
  '123456',
  '12345678',
  ...EXAMPLE_FILE_STAFF_PASSWORDS,
  'replace-with-a-long-random-string',
]);

/** Fill-in-the-blank text such as "replace-with-…", "change-me", "<password>". */
const PLACEHOLDER_PATTERNS = [
  /^replace[-_ ]?(with|me|this)/i,
  /^change[-_ ]?(me|this|it)/i,
  /^your[-_ ]/i,
  /^<.*>$/,
  /^todo\b/i,
];

/** True for a sample, placeholder or well-known default value. */
export function isSampleValue(value: string | undefined): boolean {
  const text = value?.trim() ?? '';
  if (!text) return false;
  return (
    DEFAULT_VALUES.has(text.toLowerCase()) ||
    PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))
  );
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  const left = a?.trim().toLowerCase() ?? '';
  return left !== '' && left === (b?.trim().toLowerCase() ?? '');
}

/** Why DB_PASSWORD cannot be used, or null when it is fine. */
export function databasePasswordProblem(env: Env): string | null {
  const password = env.DB_PASSWORD ?? '';
  if (!password.trim()) {
    return 'DB_PASSWORD is not set. There is no default database password any more.';
  }
  if (isSampleValue(password)) {
    return 'DB_PASSWORD is still a sample or default value (for example "postgres").';
  }
  if (sameText(password, env.DB_USER ?? 'postgres')) {
    return 'DB_PASSWORD is the same as the database user name.';
  }
  return null;
}

/** Why STAFF_PASSWORD cannot be used, or null. Unset is allowed: no account is created. */
export function staffPasswordProblem(env: Env): string | null {
  const password = env.STAFF_PASSWORD ?? '';
  if (!password.trim()) return null;
  if (isSampleValue(password)) {
    return 'STAFF_PASSWORD is still a sample value from an example file. It would become a real staff sign-in.';
  }
  if (sameText(password, env.STAFF_USERNAME ?? 'staff')) {
    return 'STAFF_PASSWORD is the same as STAFF_USERNAME.';
  }
  return null;
}

/** Every reason this configuration must not be started with. */
export function unsafeSettings(env: Env): string[] {
  const problems = [
    databasePasswordProblem(env),
    staffPasswordProblem(env),
    isSampleValue(env.STAFF_DEVICE_SECRET)
      ? 'STAFF_DEVICE_SECRET is still a sample value. Set a long random string, or leave it empty.'
      : null,
  ];
  return problems.filter((problem): problem is string => problem !== null);
}

export class UnsafeConfigurationError extends Error {
  constructor(readonly problems: string[]) {
    super(
      [
        'Refusing to start: backend/.env still has sample or missing secrets.',
        ...problems.map((problem) => `  - ${problem}`),
        'Set your own values in backend/.env (e.g. `openssl rand -hex 24`).',
        'See "Secrets and database access" in backend/README.md.',
      ].join('\n'),
    );
    this.name = 'UnsafeConfigurationError';
  }
}

export function assertSafeSettings(env: Env): void {
  const problems = unsafeSettings(env);
  if (problems.length) throw new UnsafeConfigurationError(problems);
}

/** The database password, or an UnsafeConfigurationError if it is missing or a sample. */
export function databasePassword(env: Env): string {
  const problem = databasePasswordProblem(env);
  if (problem) throw new UnsafeConfigurationError([problem]);
  return env.DB_PASSWORD as string;
}
