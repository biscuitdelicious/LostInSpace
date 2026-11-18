import { resolveApiBaseUrl } from './products';

export const STAFF_AUTH_STORAGE_KEY = 'lis.staff-session';

export type StaffSessionInfo = {
  token: string;
  username: string;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export class StaffUnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = 'Staff sign-in required.') {
    super(message);
    this.name = 'StaffUnauthorizedError';
  }
}

/** The backend is making this caller wait after repeated wrong passwords. */
export class StaffLoginThrottledError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message?: string) {
    super(message || `Too many failed sign-in attempts. Try again in ${retryAfterSeconds} seconds.`);
    this.name = 'StaffLoginThrottledError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** "45s" under a minute, "2m 05s" above it, for the sign-in countdown. */
export function formatLoginWait(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

async function deviceStorage(): Promise<AsyncStorageLike | null> {
  if (browserStorage()) return null;
  if (typeof window === 'undefined') return null;
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    return AsyncStorage;
  } catch {
    return null;
  }
}

export function parseSavedStaffSession(raw: unknown): StaffSessionInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<StaffSessionInfo>;
  const token = typeof value.token === 'string' ? value.token.trim() : '';
  const username = typeof value.username === 'string' ? value.username.trim() : '';
  if (!token || !username) return null;
  return { token, username };
}

export function loadStaffSession(storage: StorageLike | null = browserStorage()): StaffSessionInfo | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STAFF_AUTH_STORAGE_KEY);
    if (!raw) return null;
    return parseSavedStaffSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveStaffSession(session: StaffSessionInfo, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STAFF_AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage quota errors should not crash sign-in.
  }
}

export function clearStaffSession(storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    if (storage.removeItem) storage.removeItem(STAFF_AUTH_STORAGE_KEY);
    else storage.setItem(STAFF_AUTH_STORAGE_KEY, '');
  } catch {
    // Ignore storage cleanup errors.
  }
}

export async function loadStaffSessionAsync(): Promise<StaffSessionInfo | null> {
  const storage = await deviceStorage();
  if (!storage) return null;
  try {
    const raw = await storage.getItem(STAFF_AUTH_STORAGE_KEY);
    if (!raw) return null;
    return parseSavedStaffSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveStaffSessionAsync(session: StaffSessionInfo): Promise<void> {
  const storage = await deviceStorage();
  if (!storage) return;
  try {
    await storage.setItem(STAFF_AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota errors.
  }
}

export async function clearStaffSessionAsync(): Promise<void> {
  const storage = await deviceStorage();
  if (!storage) return;
  try {
    await storage.removeItem(STAFF_AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup errors.
  }
}

/**
 * Device trust tokens, one per staff username, handed out by the backend
 * after a correct password (and refreshed by the session check). Sending
 * the token back as `X-Device-Token` tells the backend "this phone signed in
 * as this user before", so it is judged only on its own wrong passwords and
 * someone else guessing at the account never makes it wait. The tokens are
 * signed by the backend; a made-up one is simply ignored. They are kept
 * when the staff area is locked: that is the point of them.
 */
export const STAFF_DEVICE_TOKENS_STORAGE_KEY = 'lis.staff-device-tokens';
const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
const MAX_DEVICE_TOKENS = 10;

type DeviceTokens = Record<string, string>;

function deviceTokenKey(username: string): string {
  return username.trim().toLowerCase();
}

export function parseDeviceTokens(raw: string | null | undefined): DeviceTokens {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const tokens: DeviceTokens = {};
    for (const [user, token] of Object.entries(value as Record<string, unknown>)) {
      if (user && typeof token === 'string' && DEVICE_TOKEN_PATTERN.test(token)) tokens[user] = token;
    }
    return tokens;
  } catch {
    return {};
  }
}

function withDeviceToken(tokens: DeviceTokens, username: string, token: string): DeviceTokens {
  const key = deviceTokenKey(username);
  const next = { ...tokens };
  delete next[key];
  next[key] = token;
  // Keep only the most recent accounts used on this device.
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_DEVICE_TOKENS))) delete next[old];
  return next;
}

export function loadDeviceToken(username: string, storage: StorageLike | null = browserStorage()): string | null {
  if (!storage || !username.trim()) return null;
  try {
    return parseDeviceTokens(storage.getItem(STAFF_DEVICE_TOKENS_STORAGE_KEY))[deviceTokenKey(username)] ?? null;
  } catch {
    return null;
  }
}

export function saveDeviceToken(username: string, token: unknown, storage: StorageLike | null = browserStorage()): void {
  if (!storage || !username.trim() || typeof token !== 'string' || !DEVICE_TOKEN_PATTERN.test(token)) return;
  try {
    const current = parseDeviceTokens(storage.getItem(STAFF_DEVICE_TOKENS_STORAGE_KEY));
    storage.setItem(STAFF_DEVICE_TOKENS_STORAGE_KEY, JSON.stringify(withDeviceToken(current, username, token)));
  } catch {
    // Without storage the device is simply treated as new next time.
  }
}

async function loadDeviceTokenAsync(username: string): Promise<string | null> {
  const storage = await deviceStorage();
  if (!storage) return loadDeviceToken(username);
  if (!username.trim()) return null;
  try {
    return parseDeviceTokens(await storage.getItem(STAFF_DEVICE_TOKENS_STORAGE_KEY))[deviceTokenKey(username)] ?? null;
  } catch {
    return null;
  }
}

async function saveDeviceTokenAsync(username: string, token: unknown): Promise<void> {
  const storage = await deviceStorage();
  if (!storage) {
    saveDeviceToken(username, token);
    return;
  }
  if (!username.trim() || typeof token !== 'string' || !DEVICE_TOKEN_PATTERN.test(token)) return;
  try {
    const current = parseDeviceTokens(await storage.getItem(STAFF_DEVICE_TOKENS_STORAGE_KEY));
    await storage.setItem(STAFF_DEVICE_TOKENS_STORAGE_KEY, JSON.stringify(withDeviceToken(current, username, token)));
  } catch {
    // Ignore storage errors.
  }
}

export async function loginStaff(
  username: string,
  password: string,
  baseUrl = resolveApiBaseUrl(),
): Promise<StaffSessionInfo> {
  const deviceToken = await loadDeviceTokenAsync(username);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (deviceToken) headers['X-Device-Token'] = deviceToken;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: username.trim(), password }),
    });
  } catch {
    throw new Error('Could not reach the store backend. Start it and try again.');
  }
  const body = (await response.json().catch(() => null)) as {
    token?: unknown;
    user?: { username?: unknown };
    deviceToken?: unknown;
    message?: string | string[];
    retryAfterSeconds?: unknown;
  } | null;
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message;
    if (response.status === 429) {
      const fromBody = typeof body?.retryAfterSeconds === 'number' && Number.isFinite(body.retryAfterSeconds) && body.retryAfterSeconds > 0
        ? body.retryAfterSeconds
        : null;
      const fromHeader = Number(response.headers.get('Retry-After'));
      const wait = fromBody ?? (Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : 30);
      throw new StaffLoginThrottledError(Math.ceil(wait), message);
    }
    if (response.status === 401) {
      throw new StaffUnauthorizedError(message || 'Invalid username or password.');
    }
    throw new Error(message || `The store backend returned HTTP ${response.status}.`);
  }
  const parsed = parseSavedStaffSession({
    token: body?.token,
    username: body?.user?.username,
  });
  if (!parsed) {
    throw new Error('The store backend returned an invalid login response.');
  }
  await saveDeviceTokenAsync(parsed.username, body?.deviceToken);
  return parsed;
}

export async function verifyStaffSession(
  token: string,
  baseUrl = resolveApiBaseUrl(),
  username?: string,
): Promise<{ status: 'valid'; username: string } | { status: 'unauthorized' } | { status: 'unreachable' }> {
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const deviceToken = username ? await loadDeviceTokenAsync(username) : null;
    if (deviceToken) headers['X-Device-Token'] = deviceToken;
    const response = await fetch(`${baseUrl}/auth/me`, { headers });
    if (response.status === 401 || response.status === 403) {
      return { status: 'unauthorized' };
    }
    if (!response.ok) return { status: 'unreachable' };
    const body = (await response.json().catch(() => null)) as { user?: { username?: unknown }; deviceToken?: unknown } | null;
    const verified = typeof body?.user?.username === 'string' ? body.user.username.trim() : '';
    if (!verified) return { status: 'unreachable' };
    // A signed-in device stays (or becomes) a trusted device for this account.
    await saveDeviceTokenAsync(verified, body?.deviceToken);
    return { status: 'valid', username: verified };
  } catch {
    return { status: 'unreachable' };
  }
}

export async function logoutStaff(token: string, baseUrl = resolveApiBaseUrl()): Promise<void> {
  try {
    await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Local sign-out completes even if the backend is offline.
  }
}
