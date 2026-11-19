import {
  UnsafeConfigurationError,
  assertSafeSettings,
  loadEnvFiles,
} from './safe-env';

/**
 * Imported first by main.ts, before anything opens a database connection
 * or creates a staff account: stop with a plain explanation (no stack
 * trace) when backend/.env still has sample or missing secrets.
 */
loadEnvFiles();
try {
  assertSafeSettings(process.env);
} catch (error) {
  if (!(error instanceof UnsafeConfigurationError)) throw error;
  console.error(`\n${error.message}\n`);
  process.exit(1);
}
