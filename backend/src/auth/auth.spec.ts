import { randomBytes } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  BadRequestException,
  ExecutionContext,
  HttpException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DeviceTrust } from './device-trust';
import {
  LOGIN_FREE_FAILURES,
  LoginThrottle,
  loginThrottleKey,
} from './login-throttle';
import { hashPassword, hashToken, verifyPassword } from './password';
import {
  StaffAuthGuard,
  type StaffAuthenticatedRequest,
} from './staff-auth.guard';
import { StaffSession } from './staff-session.entity';
import { StaffUser } from './staff-user.entity';

const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;

describe('Staff authentication', () => {
  const users: StaffUser[] = [];
  const sessions: StaffSession[] = [];
  let nextUserId = 1;
  let nextSessionId = 1;
  let envVars: Record<string, string | undefined> = {};

  const fork = {
    count: jest.fn((entity: unknown) =>
      Promise.resolve(entity === StaffUser ? users.length : sessions.length),
    ),
    findOne: jest.fn((entity: unknown, where: Record<string, unknown>) => {
      if (entity === StaffUser) {
        return Promise.resolve(
          users.find(
            (user) =>
              (where.id === undefined || user.id === where.id) &&
              (where.username === undefined ||
                user.username === where.username),
          ) ?? null,
        );
      }
      if (entity === StaffSession) {
        return Promise.resolve(
          sessions.find(
            (session) =>
              where.tokenHash === undefined ||
              session.tokenHash === where.tokenHash,
          ) ?? null,
        );
      }
      return Promise.resolve(null);
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity === StaffUser) {
        const created = { id: nextUserId, ...data } as StaffUser;
        nextUserId += 1;
        users.push(created);
        return created;
      }
      const created = { id: nextSessionId, ...data } as StaffSession;
      nextSessionId += 1;
      sessions.push(created);
      return created;
    }),
    nativeDelete: jest.fn(
      (
        entity: unknown,
        where: { tokenHash?: string; expiresAt?: { $lt: Date } },
      ) => {
        if (entity !== StaffSession) return Promise.resolve(0);
        const before = sessions.length;
        for (let i = sessions.length - 1; i >= 0; i -= 1) {
          const session = sessions[i];
          if (where.tokenHash && session.tokenHash === where.tokenHash)
            sessions.splice(i, 1);
          else if (
            where.expiresAt &&
            session.expiresAt.getTime() <= where.expiresAt.$lt.getTime()
          )
            sessions.splice(i, 1);
        }
        return Promise.resolve(before - sessions.length);
      },
    ),
    flush: jest.fn(() => Promise.resolve()),
  };

  let authService: AuthService;
  let authController: AuthController;
  let guard: StaffAuthGuard;

  function httpContext(request: StaffAuthenticatedRequest): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    users.length = 0;
    sessions.length = 0;
    nextUserId = 1;
    nextSessionId = 1;
    envVars = {};
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        LoginThrottle,
        DeviceTrust,
        StaffAuthGuard,
        { provide: EntityManager, useValue: { fork: () => fork } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => envVars[key],
          },
        },
      ],
    }).compile();

    authService = module.get(AuthService);
    authController = module.get(AuthController);
    guard = module.get(StaffAuthGuard);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hashes passwords with unique salts and never stores plaintext', async () => {
    const secret = 'test-only-phrase-91';
    const first = await hashPassword(secret);
    const second = await hashPassword(secret);

    expect(first).not.toContain(secret);
    expect(first).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(second).not.toBe(first);
    expect(await verifyPassword(secret, first)).toBe(true);
    expect(await verifyPassword(secret, second)).toBe(true);
    expect(await verifyPassword('wrong-secret', first)).toBe(false);
    expect(await verifyPassword(secret, 'plaintext')).toBe(false);
  });

  it('seeds the first staff account from env with a hashed password and skips seeding when STAFF_PASSWORD is unset', async () => {
    await authService.onModuleInit();
    expect(users).toHaveLength(0);

    envVars = {
      STAFF_USERNAME: 'manager',
      STAFF_PASSWORD: 'env-configured-secret',
    };
    await authService.onModuleInit();
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('manager');
    expect(users[0].passwordHash).not.toBe('env-configured-secret');
    expect(
      await verifyPassword('env-configured-secret', users[0].passwordHash),
    ).toBe(true);

    // Updating STAFF_PASSWORD in .env rotates that account's hash while preserving other staff accounts.
    const originalHash = users[0].passwordHash;
    await authService.onModuleInit();
    expect(users[0].passwordHash).toBe(originalHash);

    envVars = {
      STAFF_USERNAME: 'manager',
      STAFF_PASSWORD: 'rotated-env-secret',
    };
    await authService.onModuleInit();
    expect(users).toHaveLength(1);
    expect(users[0].passwordHash).not.toBe(originalHash);
    expect(
      await verifyPassword('rotated-env-secret', users[0].passwordHash),
    ).toBe(true);

    envVars = {
      STAFF_USERNAME: 'other',
      STAFF_PASSWORD: 'different-secret',
    };
    await authService.onModuleInit();
    expect(users).toHaveLength(2);
    expect(users[0].username).toBe('manager');
    expect(users[1].username).toBe('other');
  });

  it('issues hashed session tokens on login, validates them via StaffAuthGuard, and revokes them on logout', async () => {
    envVars = {
      STAFF_USERNAME: 'staff',
      STAFF_PASSWORD: 'env-configured-secret',
    };
    await authService.onModuleInit();

    await expect(authController.login({})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      authController.login({ username: 'staff', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      authController.login({
        username: 'unknown',
        password: 'env-configured-secret',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const loginResult = await authController.login({
      username: 'staff',
      password: 'env-configured-secret',
    });
    expect(loginResult.user).toEqual({ id: 1, username: 'staff' });
    expect(loginResult.token).toMatch(/^[0-9a-f]{64}$/);
    expect(loginResult.deviceToken).toMatch(DEVICE_TOKEN_PATTERN);
    expect(sessions[0].tokenHash).toBe(hashToken(loginResult.token));
    expect(sessions[0].tokenHash).not.toBe(loginResult.token);

    const authedReq: StaffAuthenticatedRequest = {
      headers: { authorization: `Bearer ${loginResult.token}` },
    };
    expect(await guard.canActivate(httpContext(authedReq))).toBe(true);
    // The session check also confirms (keeps) this device's trust token.
    expect(authController.me(authedReq, loginResult.deviceToken)).toEqual({
      user: { id: 1, username: 'staff' },
      deviceToken: loginResult.deviceToken,
    });
    expect(authController.me(authedReq).deviceToken).toMatch(
      DEVICE_TOKEN_PATTERN,
    );

    await expect(
      guard.canActivate(httpContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(
        httpContext({ headers: { authorization: 'Bearer invalid-token' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await authController.logout(`Bearer ${loginResult.token}`);
    await expect(
      guard.canActivate(httpContext(authedReq)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('signing in sweeps expired sessions so old rows never pile up', async () => {
    envVars = {
      STAFF_USERNAME: 'staff',
      STAFF_PASSWORD: 'env-configured-secret',
    };
    await authService.onModuleInit();

    const first = await authController.login({
      username: 'staff',
      password: 'env-configured-secret',
    });
    expect(sessions).toHaveLength(1);

    // Simulate the first session ageing past its TTL.
    sessions[0].expiresAt = new Date(Date.now() - 1000);

    const second = await authController.login({
      username: 'staff',
      password: 'env-configured-secret',
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).toBe(hashToken(second.token));

    // The fresh session works; the expired one is gone from storage.
    const authedReq: StaffAuthenticatedRequest = {
      headers: { authorization: `Bearer ${second.token}` },
    };
    expect(await guard.canActivate(httpContext(authedReq))).toBe(true);
    await expect(
      guard.canActivate(
        httpContext({
          headers: { authorization: `Bearer ${first.token}` },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  function fakeDeviceToken(): string {
    return `${randomBytes(16).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
  }

  async function seedStaff() {
    envVars = {
      STAFF_USERNAME: 'staff',
      STAFF_PASSWORD: 'env-configured-secret',
      STAFF_DEVICE_SECRET: 'unit-test-device-secret-0123456789',
    };
    await authService.onModuleInit();
  }

  const wrong = { username: 'staff', password: 'wrong' };
  const right = { username: 'staff', password: 'env-configured-secret' };

  it('a script inventing a new device id on every request still has to wait, and the wait escalates', async () => {
    await seedStaff();
    const realNow = Date.now;
    let offset = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);

    // Twenty wrong passwords, each with a different made-up device token
    // (or none, or garbage): only the first few are plain 401s.
    const statuses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const forged =
        i % 3 === 0 ? undefined : i % 3 === 1 ? fakeDeviceToken() : `junk-${i}`;
      try {
        await authController.login(wrong, forged);
        statuses.push(200);
      } catch (error) {
        statuses.push((error as HttpException).getStatus());
      }
    }
    expect(statuses.slice(0, LOGIN_FREE_FAILURES)).toEqual(
      Array(LOGIN_FREE_FAILURES).fill(401),
    );
    expect(statuses.slice(LOGIN_FREE_FAILURES)).toEqual(
      Array(20 - LOGIN_FREE_FAILURES).fill(429),
    );

    // Even the correct password waits for an unknown device, and the reply
    // says how long is left.
    const setHeader = jest.fn();
    try {
      await authController.login(right, fakeDeviceToken(), { setHeader });
      throw new Error('expected the lockout to refuse the correct password');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const http = error as HttpException;
      expect(http.getStatus()).toBe(429);
      const payload = http.getResponse() as {
        message: string;
        retryAfterSeconds: number;
      };
      expect(payload.retryAfterSeconds).toBeGreaterThan(0);
      expect(payload.retryAfterSeconds).toBeLessThanOrEqual(30);
      expect(payload.message).toContain(
        `Try again in ${payload.retryAfterSeconds} seconds`,
      );
      expect(setHeader).toHaveBeenCalledWith(
        'Retry-After',
        String(payload.retryAfterSeconds),
      );
    }

    // Guessing at "staff" does not touch other accounts.
    await expect(
      authController.login({ username: 'other', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // Guessing during the lock does not extend it; after it, one more wrong
    // password doubles the next lock to 60 s, whatever id is sent.
    offset += 31_000;
    await expect(
      authController.login(wrong, fakeDeviceToken()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    try {
      await authController.login(wrong, fakeDeviceToken());
      throw new Error('expected the second lockout');
    } catch (error) {
      const payload = (error as HttpException).getResponse() as {
        retryAfterSeconds: number;
      };
      expect(payload.retryAfterSeconds).toBeGreaterThan(30);
      expect(payload.retryAfterSeconds).toBeLessThanOrEqual(60);
    }

    // Once that wait passes, the correct password signs in and clears it.
    offset += 61_000;
    const login = await authController.login(right);
    expect(login.user.username).toBe('staff');
    await expect(authController.login(wrong)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('staff phones that signed in before are never locked by someone else guessing, even on the same Wi-Fi', async () => {
    await seedStaff();
    // Two staff phones signed in earlier and hold trust tokens.
    const phoneA = (await authController.login(right)).deviceToken;
    const phoneB = (await authController.login(right)).deviceToken;
    expect(phoneA).not.toBe(phoneB);

    // A script hammers "staff" with forged ids until the account is locked
    // for unknown devices.
    for (let i = 0; i < 12; i += 1) {
      await authController.login(wrong, fakeDeviceToken()).catch(() => null);
    }
    await expect(
      authController.login(right, fakeDeviceToken()),
    ).rejects.toMatchObject({ status: 429 });

    // Phone A still gets a plain "wrong password" and signs straight in.
    await expect(authController.login(wrong, phoneA)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const signedIn = await authController.login(right, phoneA);
    expect(signedIn.user.username).toBe('staff');
    // It keeps the same device identity.
    expect(signedIn.deviceToken).toBe(phoneA);

    // Phone A now guesses wrong itself: only phone A waits.
    for (let i = 0; i < LOGIN_FREE_FAILURES; i += 1) {
      await expect(authController.login(wrong, phoneA)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    await expect(authController.login(right, phoneA)).rejects.toMatchObject({
      status: 429,
    });
    expect((await authController.login(right, phoneB)).user.username).toBe(
      'staff',
    );
    // Phone B signing in does not clear phone A's own wait.
    await expect(authController.login(right, phoneA)).rejects.toMatchObject({
      status: 429,
    });

    // A token only counts for the account it was earned on: using phone B's
    // "staff" token to guess at another account is treated as unknown.
    for (let i = 0; i < LOGIN_FREE_FAILURES; i += 1) {
      await expect(
        authController.login({ username: 'other', password: 'x' }, phoneB),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(
      authController.login(
        { username: 'other', password: 'x' },
        fakeDeviceToken(),
      ),
    ).rejects.toMatchObject({ status: 429 });
    await expect(authController.login(wrong, phoneB)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('device trust tokens cannot be forged, moved to another account, or reused under another secret', () => {
    const config = (secret?: string) =>
      ({ get: () => secret }) as unknown as ConfigService;
    const trust = new DeviceTrust(config('unit-test-device-secret-0123456789'));
    const token = trust.issue('Staff');
    expect(token).toMatch(DEVICE_TOKEN_PATTERN);
    const id = trust.verify('staff', token);
    expect(id).toBe(token.split('.')[0]);
    // Re-issuing for a valid token keeps the same device id.
    expect(trust.issue('staff', token)).toBe(token);

    expect(trust.verify('other', token)).toBeNull();
    const [tokenId, signature] = token.split('.');
    const flipped = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    expect(trust.verify('staff', `${tokenId}.${flipped}`)).toBeNull();
    expect(
      trust.verify(
        'staff',
        `${randomBytes(16).toString('base64url')}.${signature}`,
      ),
    ).toBeNull();
    expect(trust.verify('staff', 'not-a-token')).toBeNull();
    expect(trust.verify('staff', undefined)).toBeNull();
    // A forged token gets a brand-new id rather than the claimed one.
    expect(
      trust.issue('staff', `${tokenId}.${flipped}`).startsWith(tokenId),
    ).toBe(false);

    const otherSecret = new DeviceTrust(
      config('a-different-device-secret-987654'),
    );
    expect(otherSecret.verify('staff', token)).toBeNull();

    // Without a configured secret (or with the public placeholder) a random
    // one is used, with a warning.
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const placeholder = 'replace-with-a-long-random-string';
    const placeholderToken = new DeviceTrust(config(placeholder)).issue(
      'staff',
    );
    expect(
      new DeviceTrust(config(placeholder)).verify('staff', placeholderToken),
    ).toBeNull();
    const unconfigured = new DeviceTrust(config(undefined));
    const randomToken = unconfigured.issue('staff');
    expect(unconfigured.verify('staff', randomToken)).not.toBeNull();
    expect(trust.verify('staff', randomToken)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('STAFF_DEVICE_SECRET'),
    );
  });

  it('LoginThrottle forgets failures after a quiet window and caps the lock', () => {
    const throttle = new LoginThrottle();
    const keys = ['user:staff'];
    const t0 = 1_700_000_000_000;

    for (let i = 0; i < LOGIN_FREE_FAILURES - 1; i += 1) {
      throttle.recordFailure(keys, t0 + i);
    }
    expect(throttle.retryAfterSeconds(keys, t0 + 10)).toBe(0);

    // 15 quiet minutes reset the counter, so an occasional typo never locks.
    const later = t0 + 16 * 60_000;
    throttle.recordFailure(keys, later);
    expect(throttle.retryAfterSeconds(keys, later)).toBe(0);

    // Escalation is capped at 15 minutes however many failures pile up.
    let at = later;
    let wait = 0;
    for (let i = 0; i < 20; i += 1) {
      throttle.recordFailure(keys, at);
      wait = throttle.retryAfterSeconds(keys, at);
      expect(wait).toBeLessThanOrEqual(15 * 60);
      at += Math.max(wait, 1) * 1000 + 1;
    }
    expect(wait).toBe(15 * 60);

    throttle.recordSuccess(keys);
    expect(throttle.retryAfterSeconds(keys, at)).toBe(0);
  });

  it('LoginThrottle stays bounded and spraying throwaway usernames cannot push out a running lock', () => {
    const throttle = new LoginThrottle();
    throttle.maxEntries = 50;
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < LOGIN_FREE_FAILURES; i += 1) {
      throttle.recordFailure([loginThrottleKey('staff')], t0);
    }
    expect(throttle.retryAfterSeconds([loginThrottleKey('Staff')], t0)).toBe(
      30,
    );

    for (let i = 0; i < 500; i += 1) {
      throttle.recordFailure([loginThrottleKey(`spray-${i}`)], t0 + 1);
    }
    expect(throttle.size).toBeLessThanOrEqual(50);
    expect(
      throttle.retryAfterSeconds([loginThrottleKey('staff')], t0 + 2),
    ).toBe(30);
    // A trusted device has its own bucket, separate from the account's.
    expect(loginThrottleKey('staff', 'abc')).toBe('device:abc');
    expect(
      throttle.retryAfterSeconds([loginThrottleKey('staff', 'abc')], t0 + 2),
    ).toBe(0);
  });
});
