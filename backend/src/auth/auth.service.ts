import { randomBytes } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceTrust } from './device-trust';
import { LoginThrottle, loginThrottleKey } from './login-throttle';
import { hashPassword, hashToken, verifyPassword } from './password';
import { StaffSession } from './staff-session.entity';
import { StaffUser } from './staff-user.entity';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;

export type StaffAccountView = {
  id: number;
  username: string;
};

export type StaffLoginView = {
  token: string;
  user: StaffAccountView;
  /** Proof this device signed in as this user; send back as `X-Device-Token`. */
  deviceToken: string;
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly config: ConfigService,
    private readonly throttle: LoginThrottle,
    private readonly deviceTrust: DeviceTrust,
  ) {}

  async onModuleInit(): Promise<void> {
    const password = this.config.get<string>('STAFF_PASSWORD') ?? '';
    if (!password.trim()) {
      const fork = this.em.fork();
      const existingCount = await fork.count(StaffUser);
      if (existingCount === 0) {
        this.logger.warn(
          'STAFF_PASSWORD is not set in .env; no initial staff account was created.',
        );
      }
      return;
    }

    const rawUsername = this.config.get<string>('STAFF_USERNAME') ?? 'staff';
    const username = rawUsername.trim() || 'staff';
    const fork = this.em.fork();
    const existing = await fork.findOne(StaffUser, { username });
    if (!existing) {
      fork.create(StaffUser, {
        username,
        passwordHash: await hashPassword(password),
        createdAt: new Date(),
      });
      await fork.flush();
      return;
    }
    const matches = await verifyPassword(password, existing.passwordHash);
    if (!matches) {
      existing.passwordHash = await hashPassword(password);
      await fork.flush();
    }
  }

  async login(
    body: unknown,
    deviceToken?: string | null,
  ): Promise<StaffLoginView> {
    const { username, password } = readCredentials(body);
    // A device that proved itself for this account before waits only for
    // its own mistakes; everyone else shares the account's wait, so faking
    // a fresh device id per request does not reset it. While locked, even
    // the correct password is refused so guessing cannot outrun the wait.
    const trustedDeviceId = this.deviceTrust.verify(username, deviceToken);
    const throttleKeys = [loginThrottleKey(username, trustedDeviceId)];
    const waitSeconds = this.throttle.retryAfterSeconds(throttleKeys);
    if (waitSeconds > 0) {
      throw new HttpException(
        {
          statusCode: 429,
          message: `Too many failed sign-in attempts. Try again in ${waitSeconds} seconds.`,
          retryAfterSeconds: waitSeconds,
        },
        429,
      );
    }
    const fork = this.em.fork();
    const user = await fork.findOne(StaffUser, { username });
    if (!user) {
      await verifyPassword(password, DUMMY_HASH);
      this.throttle.recordFailure(throttleKeys);
      throw new UnauthorizedException('Invalid username or password');
    }
    const matches = await verifyPassword(password, user.passwordHash);
    if (!matches) {
      this.throttle.recordFailure(throttleKeys);
      throw new UnauthorizedException('Invalid username or password');
    }
    this.throttle.recordSuccess(throttleKeys);

    const now = new Date();
    // Housekeeping: sign-ins are the only writer of sessions, so sweep
    // expired rows here instead of letting them pile up forever.
    await fork.nativeDelete(StaffSession, { expiresAt: { $lt: now } });
    const token = randomBytes(32).toString('hex');
    fork.create(StaffSession, {
      user,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });
    await fork.flush();

    return {
      token,
      user: { id: user.id, username: user.username },
      deviceToken: this.deviceTrust.issue(user.username, deviceToken),
    };
  }

  /** Trust token for a device that already holds a valid session. */
  deviceTokenFor(username: string, previousToken?: string | null): string {
    return this.deviceTrust.issue(username, previousToken);
  }

  async authenticate(token: string): Promise<StaffAccountView> {
    if (!token.trim()) {
      throw new UnauthorizedException('Staff sign-in required');
    }
    const fork = this.em.fork();
    const session = await fork.findOne(
      StaffSession,
      { tokenHash: hashToken(token.trim()) },
      { populate: ['user'] },
    );
    if (!session) {
      throw new UnauthorizedException('Staff sign-in required');
    }
    const expiresAt =
      session.expiresAt instanceof Date
        ? session.expiresAt
        : new Date(session.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Staff sign-in required');
    }
    return { id: session.user.id, username: session.user.username };
  }

  async logout(token?: string | null): Promise<{ ok: true }> {
    const trimmed = token?.trim();
    if (!trimmed) return { ok: true };
    const fork = this.em.fork();
    await fork.nativeDelete(StaffSession, { tokenHash: hashToken(trimmed) });
    return { ok: true };
  }
}

function readCredentials(body: unknown): {
  username: string;
  password: string;
} {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Username and password are required');
  }
  const value = body as Record<string, unknown>;
  const username =
    typeof value.username === 'string' ? value.username.trim() : '';
  const password = typeof value.password === 'string' ? value.password : '';
  if (!username || !password) {
    throw new BadRequestException('Username and password are required');
  }
  return { username, password };
}
