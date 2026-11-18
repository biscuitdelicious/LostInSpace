import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TOKEN_PATTERN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const MIN_SECRET_LENGTH = 16;

/**
 * "This device has signed in as <username> before" proof, handed out by
 * the backend after a correct password. It is an HMAC over a random device
 * id and the username, so a script cannot make one up: a made-up device id
 * or token simply does not verify. The sign-in throttle uses it to tell a
 * known staff phone (judged only on its own wrong passwords) apart from an
 * unknown caller (judged together with every other unknown caller trying
 * that account).
 */
@Injectable()
export class DeviceTrust {
  private readonly logger = new Logger(DeviceTrust.name);
  private secret: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  /** A token for this device: keeps the id of a still-valid token, else a new one. */
  issue(username: string, previousToken?: string | null): string {
    const id =
      this.verify(username, previousToken) ??
      randomBytes(16).toString('base64url');
    return `${id}.${this.sign(username, id)}`;
  }

  /** The device id when the token was issued by this backend for this username, else null. */
  verify(username: string, token?: string | null): string | null {
    const match = TOKEN_PATTERN.exec(token?.trim() ?? '');
    if (!match) return null;
    const [, id, signature] = match;
    const expected = Buffer.from(this.sign(username, id));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given)
      ? id
      : null;
  }

  private sign(username: string, id: string): string {
    return createHmac('sha256', this.key())
      .update(`lis-staff-device:v1:${username.trim().toLowerCase()}:${id}`)
      .digest('base64url');
  }

  private key(): Buffer {
    if (this.secret) return this.secret;
    const configured =
      this.config.get<string>('STAFF_DEVICE_SECRET')?.trim() ?? '';
    // The .env.example placeholder is public, so it must never sign anything.
    if (
      configured.length >= MIN_SECRET_LENGTH &&
      !configured.startsWith('replace-with')
    ) {
      this.secret = Buffer.from(configured);
    } else {
      // Still safe, but every restart forgets which devices were trusted
      // (they become trusted again on their next sign-in or session check).
      this.logger.warn(
        `STAFF_DEVICE_SECRET is not set (or is the placeholder or shorter than ${MIN_SECRET_LENGTH} characters) in .env; using a random one until the backend restarts.`,
      );
      this.secret = randomBytes(32);
    }
    return this.secret;
  }
}
