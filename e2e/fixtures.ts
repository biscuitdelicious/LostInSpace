import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test as base, expect, type ConsoleMessage, type Page, type Request, type Response } from '@playwright/test';

/**
 * The bundle is built with `EXPO_PUBLIC_API_URL` pointing at the preview's
 * public API URL. Tests run against the backend started for this run, so the
 * page is told where that backend is before any app code executes. When no
 * override is set, default to the standard local backend on port 3000.
 */
export function resolveTestApiUrl(env: Record<string, string | undefined> = process.env): string {
  return env.TEST_API_URL || 'http://127.0.0.1:3000';
}

export const testApiUrl = resolveTestApiUrl();

function readEnvFiles(): Record<string, string> {
  const root = path.resolve(__dirname, '..');
  const merged: Record<string, string> = {};
  for (const rel of ['.env', path.join('backend', '.env')]) {
    const full = path.join(root, rel);
    if (!existsSync(full)) continue;
    const content = readFileSync(full, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      merged[key] = val;
    }
  }
  return merged;
}

export function readStaffCredentials(): { username: string; password: string } {
  const fromFiles = readEnvFiles();
  const username = (process.env.STAFF_USERNAME ?? fromFiles.STAFF_USERNAME ?? 'staff').trim() || 'staff';
  const password = process.env.STAFF_PASSWORD ?? fromFiles.STAFF_PASSWORD ?? '';
  if (!password) {
    throw new Error('STAFF_PASSWORD must be set in backend/.env or .env to run staff E2E tests.');
  }
  return { username, password };
}

type AllowedHttpError = { status: number; urlEndsWith: string };

const allowedHttpErrors = new WeakMap<Page, AllowedHttpError[]>();

export function allowHttpErrors(page: Page, rule: AllowedHttpError): void {
  const existing = allowedHttpErrors.get(page) ?? [];
  existing.push(rule);
  allowedHttpErrors.set(page, existing);
}

export const test = base.extend<{ browserDiagnostics: void }>({
  browserDiagnostics: [async ({ page }, use, testInfo) => {
    await page.addInitScript(
      (url: string) => {
        (window as unknown as { __LIS_API_URL__: string }).__LIS_API_URL__ = url;
      },
      testApiUrl,
    );
    const logs: string[] = [];
    const errors: string[] = [];
    const onConsole = (message: ConsoleMessage) => {
      const location = message.location();
      const text = message.text();
      const entry = `[console.${message.type()}] ${text} (${location.url}:${location.lineNumber})`;
      logs.push(entry);
      if (message.type() === 'error') {
        const rules = allowedHttpErrors.get(page) ?? [];
        const allowed = rules.some(
          (rule) =>
            location.url.endsWith(rule.urlEndsWith) &&
            text.includes(`status of ${rule.status}`),
        );
        if (!allowed) errors.push(entry);
      }
    };
    const onPageError = (error: Error) => {
      const entry = `[pageerror] ${error.stack || error.message}`;
      logs.push(entry);
      errors.push(entry);
    };
    const onRequestFailed = (request: Request) => {
      const entry = `[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText}`;
      logs.push(entry);
      errors.push(entry);
    };
    const onResponse = (response: Response) => {
      if (response.status() < 400) return;
      const rules = allowedHttpErrors.get(page) ?? [];
      if (rules.some((rule) => response.status() === rule.status && response.url().endsWith(rule.urlEndsWith))) return;
      const entry = `[http] ${response.status()} ${response.url()}`;
      logs.push(entry);
      errors.push(entry);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);
    try {
      await use();
    } finally {
      // Every test starts a fresh browser context, so a staff sign-in would
      // otherwise leave a session row behind on each run. Sign out through
      // the same backend the page used.
      try {
        const saved = await page.evaluate((key) => localStorage.getItem(key), 'lis.staff-session');
        const token = saved ? (JSON.parse(saved) as { token?: unknown }).token : null;
        if (typeof token === 'string' && token) {
          await page.request.post(`${testApiUrl}/auth/logout`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      } catch {
        // The page may already be gone; the backend prunes expired rows anyway.
      }
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
      const logPath = testInfo.outputPath('browser.log');
      await writeFile(logPath, logs.join('\n'), 'utf8');
      await testInfo.attach('browser-log', {
        path: logPath,
        contentType: 'text/plain',
      });
      expect.soft(errors, 'Browser console, runtime, and network errors').toEqual([]);
    }
  }, { auto: true }],
});

export { expect };

export const demoLabels = [
  'HyperMarket_Main, -42 dBm, view details',
  'HyperMarket_Zone_A, -51 dBm, view details',
  'HyperMarket_Zone_B, -58 dBm, view details',
  'HyperMarket_Guest, -64 dBm, view details',
  'HyperMarket_Zone_C, -67 dBm, view details',
  'POS_Network, -72 dBm, view details',
  'Staff_Network, -78 dBm, view details',
  'Warehouse_AP, -85 dBm, view details',
];

export function networkRows(page: Page) {
  return page.getByRole('button', { name: /, -?\d+ dBm, view details$/ });
}

export async function expectNetworks(page: Page, labels: string[]) {
  const rows = networkRows(page);
  await expect(rows).toHaveCount(labels.length);
  for (const [index, label] of labels.entries()) {
    await expect(rows.nth(index)).toHaveAccessibleName(label);
  }
  await expect(page.getByText(`Showing ${labels.length} of 8 networks`, { exact: true })).toBeVisible();
}

export async function signInStaff(page: Page, credentials = readStaffCredentials()) {
  const usernameInput = page.getByRole('textbox', { name: 'Staff username', exact: true });
  await expect(usernameInput).toBeVisible();
  await usernameInput.fill(credentials.username);
  await page.getByLabel('Staff password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // The sign-in screen must be gone; a wrong password keeps it up. What
  // replaces it differs per platform (sidebar lock on desktop, the drawer
  // on the phone), so the open scanner asserts that right after this.
  await expect(usernameInput).toBeHidden();
}

export async function openScanner(page: Page) {
  // The scanner lives in the staff area behind #staff and requires staff sign-in.
  await page.goto('/#staff', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('LIS · Staff');
  const usernameInput = page.getByRole('textbox', { name: 'Staff username', exact: true });
  const scanButton = page.getByRole('button', { name: 'Scan networks', exact: true });
  await expect(usernameInput.or(scanButton)).toBeVisible();
  if (await usernameInput.isVisible()) {
    await signInStaff(page);
  }
  await expect(scanButton).toBeEnabled();
  await expectNetworks(page, demoLabels);
}

export async function runScan(page: Page) {
  await page.getByRole('button', { name: 'Scan networks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scanning…', exact: true })).toBeDisabled();
  await expect(page.getByText('Listening for nearby access points…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan networks', exact: true })).toBeEnabled();
  await expect(page.getByText('8 nearby networks found. Scan complete.', { exact: true })).toBeVisible();
  await expect(networkRows(page)).toHaveCount(8);
}
