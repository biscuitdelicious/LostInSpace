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
import {
  EXAMPLE_FILE_STAFF_PASSWORDS,
  UnsafeConfigurationError,
  staffPasswordProblem,
} from '../config/safe-env';
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
    // A sample password from an example file must never become a real
    // sign-in. main.ts already refuses to start; this covers every other
    // way the module can be booted.
    const problem = staffPasswordProblem({
      STAFF_USERNAME: this.config.get<string>('STAFF_USERNAME'),
      STAFF_PASSWORD: this.config.get<string>('STAFF_PASSWORD'),
    });
    if (problem) throw new UnsafeConfigurationError([problem]);

    const password = this.config.get<string>('STAFF_PASSWORD') ?? '';
    const rawUsername = this.config.get<string>('STAFF_USERNAME') ?? 'staff';
    const username = rawUsername.trim() || 'staff';
    const fork = this.em.fork();
    await this.disableSamplePasswordAccounts(fork);

    if (!password.trim()) {
      const existingCount = await fork.count(StaffUser);
      if (existingCount === 0) {
        this.logger.warn(
          'STAFF_PASSWORD is not set in .env; no initial staff account was created.',
        );
      }
      return;
    }

    const existing = await fork.findOne(StaffUser, { username });
    if (!existing) {
      fork.create(StaffUser, {
        username,
        passwordHash: await hashPassword(password),
        credentialsVersion: 1,
        createdAt: new Date(),
      });
      await fork.flush();
      return;
    }
    const matches = await verifyPassword(password, existing.passwordHash);
    if (!matches) {
      // The password in .env is the source of truth. Anyone who signed in
      // with the old one loses their session — a changed password is how
      // you cut off a leaked password or a lost phone.
      existing.passwordHash = await hashPassword(password);
      existing.credentialsVersion = (existing.credentialsVersion ?? 1) + 1;
      await fork.flush();
      const signedOut = await fork.nativeDelete(StaffSession, {
        user: existing,
      });
      this.logger.log(
        `STAFF_PASSWORD changed for "${username}"; signed out ${signedOut} staff session(s).`,
      );
    }
  }

  /**
   * An earlier start with an unedited example file may have created a staff
   * account whose password is public. Sign such accounts out everywhere and
   * replace the password with a random one nobody knows. The account named
   * by STAFF_USERNAME then gets the configured password just below; any
   * other one stays unusable until it is given a real password that way.
   */
  private async disableSamplePasswordAccounts(
    fork: EntityManager,
  ): Promise<void> {
    const accounts = await fork.find(StaffUser, {});
    for (const account of accounts) {
      let usesSample = false;
      for (const sample of EXAMPLE_FILE_STAFF_PASSWORDS) {
        if (await verifyPassword(sample, account.passwordHash)) {
          usesSample = true;
        }
      }
      if (!usesSample) continue;
      account.passwordHash = await hashPassword(
        randomBytes(32).toString('hex'),
      );
      account.credentialsVersion = (account.credentialsVersion ?? 1) + 1;
      await fork.flush();
      await fork.nativeDelete(StaffSession, { user: account });
      this.logger.warn(
        `Staff account "${account.username}" still had the sample password from .env.example. Its password was disabled and its sessions were signed out.`,
      );
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
      // A session lives only as long as the password it was opened with.
      credentialsVersion: user.credentialsVersion ?? 1,
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
    // Defense in depth: a session opened under an older password is refused
    // even if its row survived the sign-out that followed the password
    // change (e.g. two backends booting the same database).
    if (
      (session.credentialsVersion ?? 1) !==
      (session.user.credentialsVersion ?? 1)
    ) {
      await fork.nativeDelete(StaffSession, { tokenHash: session.tokenHash });
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
