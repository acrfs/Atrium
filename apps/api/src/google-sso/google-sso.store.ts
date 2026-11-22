import { randomBytes } from "crypto";

/** What an authorization code stands for until it is redeemed. */
export interface AuthCodeGrant {
  userId: string;
  email: string;
  name: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  authTime: number;
}

/** What an access token lets the userinfo endpoint return. */
export interface AccessGrant {
  userId: string;
  email: string;
  name: string;
  scope: string;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * A small in-memory map with expiry. Codes live for minutes and the portal is
 * one container, so nothing here needs to survive a restart: a restart in the
 * middle of a sign-in just means Google shows its error and she tries again.
 */
export class ExpiringStore<T> {
  private entries: Map<string, Entry<T>> = new Map();

  constructor(
    private ttlMs: number,
    private now: () => number = Date.now,
  ) {}

  /** Stores the value under a fresh random key and returns that key. */
  issue(value: T): string {
    this.sweep();
    const key: string = randomBytes(32).toString("base64url");
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    return key;
  }

  /** Returns the value once and forgets it (codes are single use). */
  take(key: string): T | undefined {
    const entry: Entry<T> | undefined = this.entries.get(key);
    this.entries.delete(key);
    if (!entry || entry.expiresAt <= this.now()) return undefined;
    return entry.value;
  }

  /** Returns the value without forgetting it (access tokens are reusable until expiry). */
  peek(key: string): T | undefined {
    const entry: Entry<T> | undefined = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const now: number = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
