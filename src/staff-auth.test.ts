import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STAFF_AUTH_STORAGE_KEY,
  STAFF_DEVICE_TOKENS_STORAGE_KEY,
  StaffLoginThrottledError,
  StaffUnauthorizedError,
  clearStaffSession,
  formatLoginWait,
  loadDeviceToken,
  loadStaffSession,
  loginStaff,
  parseDeviceTokens,
  parseSavedStaffSession,
  saveDeviceToken,
  saveStaffSession,
  verifyStaffSession,
} from './staff-auth';

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

test('staff session round-trips through storage and clears cleanly', () => {
  const storage = memoryStorage();
  assert.equal(loadStaffSession(storage), null);

  saveStaffSession({ token: 'tok_abc123', username: 'staff' }, storage);
  assert.deepEqual(loadStaffSession(storage), {
    token: 'tok_abc123',
    username: 'staff',
  });

  clearStaffSession(storage);
  assert.equal(loadStaffSession(storage), null);
});

test('corrupt or incomplete saved staff sessions are rejected', () => {
  const storage = memoryStorage();
  storage.setItem(STAFF_AUTH_STORAGE_KEY, '{bad json');
  assert.equal(loadStaffSession(storage), null);
  assert.equal(parseSavedStaffSession(null), null);
  assert.equal(parseSavedStaffSession({ token: '   ', username: 'staff' }), null);
  assert.equal(parseSavedStaffSession({ token: 'abc', username: '' }), null);
  const error = new StaffUnauthorizedError('Invalid credentials');
  assert.equal(error.status, 401);
});

test('a throttled sign-in surfaces the wait from the body or the Retry-After header', async () => {
  const realFetch = globalThis.fetch;
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }))) as typeof fetch;
  };
  try {
    respond(429, { message: 'Too many failed sign-in attempts. Try again in 42 seconds.', retryAfterSeconds: 42 });
    await assert.rejects(loginStaff('staff', 'wrong', 'http://store.test'), (err: unknown) => {
      assert.ok(err instanceof StaffLoginThrottledError);
      assert.equal(err.status, 429);
      assert.equal(err.retryAfterSeconds, 42);
      assert.match(err.message, /Try again in 42 seconds/);
      return true;
    });

    respond(429, { message: 'Slow down' }, { 'Retry-After': '61' });
    await assert.rejects(loginStaff('staff', 'wrong', 'http://store.test'), (err: unknown) => {
      assert.ok(err instanceof StaffLoginThrottledError);
      assert.equal(err.retryAfterSeconds, 61);
      return true;
    });

    // A malformed 429 still makes the caller wait rather than retry instantly.
    respond(429, {});
    await assert.rejects(loginStaff('staff', 'wrong', 'http://store.test'), (err: unknown) => {
      assert.ok(err instanceof StaffLoginThrottledError);
      assert.equal(err.retryAfterSeconds, 30);
      return true;
    });

    respond(401, { message: 'Invalid username or password' });
    await assert.rejects(loginStaff('staff', 'wrong', 'http://store.test'), StaffUnauthorizedError);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the sign-in countdown reads as seconds under a minute and minutes above it', () => {
  assert.equal(formatLoginWait(0), '0s');
  assert.equal(formatLoginWait(9.2), '10s');
  assert.equal(formatLoginWait(45), '45s');
  assert.equal(formatLoginWait(60), '1m');
  assert.equal(formatLoginWait(125), '2m 05s');
  assert.equal(formatLoginWait(900), '15m');
});

const realToken = `${'a'.repeat(22)}.${'b'.repeat(43)}`;
const renewedToken = `${'c'.repeat(22)}.${'d'.repeat(43)}`;

test('device trust tokens are stored per staff username and survive locking the staff area', () => {
  const storage = memoryStorage();
  assert.equal(loadDeviceToken('staff', storage), null);
  saveDeviceToken('Staff', realToken, storage);
  assert.equal(loadDeviceToken('staff', storage), realToken);
  assert.equal(loadDeviceToken(' STAFF ', storage), realToken);
  assert.equal(loadDeviceToken('manager', storage), null);
  // Locking the staff area clears the session, not the device's trust.
  saveStaffSession({ token: 'tok', username: 'staff' }, storage);
  clearStaffSession(storage);
  assert.equal(loadDeviceToken('staff', storage), realToken);
  // Anything that is not a backend-issued token shape is never stored.
  saveDeviceToken('staff', 'made-up', storage);
  saveDeviceToken('staff', undefined, storage);
  assert.equal(loadDeviceToken('staff', storage), realToken);
  // Corrupt storage reads as "new device" instead of crashing.
  storage.setItem(STAFF_DEVICE_TOKENS_STORAGE_KEY, '{not json');
  assert.equal(loadDeviceToken('staff', storage), null);
  assert.deepEqual(parseDeviceTokens(JSON.stringify({ staff: 'bad', other: realToken })), { other: realToken });
});

test('sign-in and the session check send this device\'s trust token and keep the one the backend returns', async () => {
  const realFetch = globalThis.fetch;
  const globals = globalThis as { localStorage?: unknown };
  const storage = memoryStorage();
  globals.localStorage = storage;
  const seen: (string | undefined)[] = [];
  let reply: { status: number; body: unknown } = { status: 401, body: { message: 'Invalid username or password' } };
  globalThis.fetch = ((_url: string, init?: { headers?: Record<string, string> }) => {
    seen.push(init?.headers?.['X-Device-Token']);
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;
  try {
    // A device that never signed in sends no token.
    await assert.rejects(loginStaff('staff', 'wrong', 'http://store.test'), StaffUnauthorizedError);
    assert.equal(seen[0], undefined);

    reply = { status: 200, body: { token: 'session-1', user: { username: 'staff' }, deviceToken: realToken } };
    assert.deepEqual(await loginStaff('staff', 'right', 'http://store.test'), { token: 'session-1', username: 'staff' });
    assert.equal(loadDeviceToken('staff', storage), realToken);

    // Next time (even after a wrong password) it proves it signed in before.
    reply = { status: 401, body: { message: 'Invalid username or password' } };
    await assert.rejects(loginStaff('staff', 'wrong', 'http://store.test'), StaffUnauthorizedError);
    assert.equal(seen[2], realToken);
    // Other accounts typed on this device get no token.
    await assert.rejects(loginStaff('manager', 'wrong', 'http://store.test'), StaffUnauthorizedError);
    assert.equal(seen[3], undefined);

    // The session check sends the token and stores a renewed one.
    reply = { status: 200, body: { user: { username: 'staff' }, deviceToken: renewedToken } };
    assert.deepEqual(await verifyStaffSession('session-1', 'http://store.test', 'staff'), { status: 'valid', username: 'staff' });
    assert.equal(seen[4], realToken);
    assert.equal(loadDeviceToken('staff', storage), renewedToken);
  } finally {
    globalThis.fetch = realFetch;
    delete globals.localStorage;
  }
});
