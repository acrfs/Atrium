import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "crypto";

const ALGORITHM = "aes-256-gcm";

function deriveKey(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "atrium-google-calendar", info, 32));
}

/** AES-256-GCM for the stored Google tokens, keyed off BETTER_AUTH_SECRET via HKDF. */
export class TokenCipher {
  private key: Buffer;

  constructor(secret: string) {
    this.key = deriveKey(secret, "token-encryption");
  }

  encrypt(plaintext: string): string {
    const iv: Buffer = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const data: Buffer = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${data.toString("hex")}`;
  }

  /** Throws when the value was not written by this key. */
  decrypt(value: string): string {
    const [ivHex, tagHex, dataHex] = value.split(":");
    if (!ivHex || !tagHex || dataHex === undefined) throw new Error("Malformed encrypted value");
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
  }
}

export interface OAuthState {
  /** Organization id. */
  o: string;
  /** User id of the owner/admin who started the connection. */
  u: string;
  /** Expiry, epoch milliseconds. */
  e: number;
  /** Nonce. */
  n: string;
}

/** Signs the OAuth `state` so the callback knows which workspace and user started it. */
export class StateSigner {
  private key: Buffer;

  constructor(secret: string) {
    this.key = deriveKey(secret, "oauth-state");
  }

  sign(orgId: string, userId: string, now: number = Date.now(), ttlMs: number = 10 * 60_000): string {
    const state: OAuthState = { o: orgId, u: userId, e: now + ttlMs, n: randomBytes(9).toString("base64url") };
    const body: string = Buffer.from(JSON.stringify(state)).toString("base64url");
    return `${body}.${this.mac(body)}`;
  }

  /** The state when its signature holds and it has not expired, otherwise null. */
  verify(value: string | undefined, now: number = Date.now()): OAuthState | null {
    if (!value) return null;
    const [body, mac] = value.split(".");
    if (!body || !mac) return null;
    const expected: Buffer = Buffer.from(this.mac(body));
    const given: Buffer = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
      if (typeof state.o !== "string" || typeof state.u !== "string" || typeof state.e !== "number") return null;
      if (state.e < now) return null;
      return state;
    } catch {
      return null;
    }
  }

  private mac(body: string): string {
    return createHmac("sha256", this.key).update(body).digest("base64url");
  }
}
