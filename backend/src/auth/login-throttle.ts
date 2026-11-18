import { Injectable } from '@nestjs/common';

/** Wrong passwords allowed before sign-in makes the caller wait. */
export const LOGIN_FREE_FAILURES = 5;
/** First lockout lasts 30 s; every further wrong password doubles it. */
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
/** A quiet period longer than this forgets old failures. */
const FAILURE_WINDOW_MS = 15 * 60_000;
/** Memory bound: a flood of made-up usernames cannot grow the map forever. */
export const LOGIN_THROTTLE_MAX_ENTRIES = 10_000;

type ThrottleEntry = {
  failures: number;
  lockedUntil: number;
};

/**
 * Slows down password guessing against the staff sign-in. Each attempt is
 * judged against one bucket (see `loginThrottleKey`). State is in memory:
 * restarting the backend clears it, which is acceptable for a single-store
 * deployment.
 */
@Injectable()
export class LoginThrottle {
  private readonly entries = new Map<string, ThrottleEntry>();
  /** Overridable in tests; production keeps the default. */
  maxEntries = LOGIN_THROTTLE_MAX_ENTRIES;

  /** Seconds the caller must still wait, or 0 when a try is allowed. */
  retryAfterSeconds(keys: string[], now = Date.now()): number {
    this.sweep(now);
    let waitMs = 0;
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry && entry.lockedUntil > now) {
        waitMs = Math.max(waitMs, entry.lockedUntil - now);
      }
    }
    return Math.ceil(waitMs / 1000);
  }

  recordFailure(keys: string[], now = Date.now()): void {
    for (const key of keys) {
      const previous = this.entries.get(key);
      // The quiet window starts when the last lock ends, so serving a
      // 15-minute lock never resets the counter that produced it.
      const failures =
        previous && now - previous.lockedUntil <= FAILURE_WINDOW_MS
          ? previous.failures + 1
          : 1;
      const lockMs =
        failures >= LOGIN_FREE_FAILURES
          ? Math.min(
              BASE_LOCK_MS * 2 ** (failures - LOGIN_FREE_FAILURES),
              MAX_LOCK_MS,
            )
          : 0;
      this.entries.set(key, {
        failures,
        lockedUntil: now + lockMs,
      });
    }
    this.enforceCap(now);
  }

  /** A correct sign-in clears the counters for that bucket. */
  recordSuccess(keys: string[]): void {
    for (const key of keys) this.entries.delete(key);
  }

  /** Number of buckets currently remembered (for tests and diagnostics). */
  get size(): number {
    return this.entries.size;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.lockedUntil > FAILURE_WINDOW_MS) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Over the cap, drop the oldest buckets that are not currently locked, so
   * spraying throwaway usernames cannot push out a lock that is running.
   * Only if every bucket is locked does the oldest lock go.
   */
  private enforceCap(now: number): void {
    if (this.entries.size <= this.maxEntries) return;
    this.sweep(now);
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries) return;
      if (entry.lockedUntil <= now) this.entries.delete(key);
    }
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) return;
      this.entries.delete(key);
    }
  }
}

/**
 * The single bucket a sign-in attempt is judged against.
 *
 * - A device holding a valid trust token for this username (it signed in
 *   with the right password before) is judged only on its own wrong
 *   passwords: `device:<id>`. Nobody else's guessing can make it wait, so
 *   staff phones on the same store Wi-Fi never lock each other out, and a
 *   script guessing at "staff" cannot lock real staff out of their phones.
 * - Everyone else (no token, a made-up token, or a token for another
 *   username) shares one bucket per account: `user:<username>`. Inventing a
 *   new device id per request therefore changes nothing; all those
 *   requests count against the same escalating wait. Other usernames, and
 *   the IP address, are deliberately not part of it.
 */
export function loginThrottleKey(
  username: string,
  trustedDeviceId?: string | null,
): string {
  if (trustedDeviceId) return `device:${trustedDeviceId}`;
  return `user:${username.trim().toLowerCase()}`;
}
