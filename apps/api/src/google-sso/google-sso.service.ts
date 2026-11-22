import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, JsonWebKey, sign, timingSafeEqual } from "crypto";
import { loadGoogleSsoConfig, type GoogleSsoConfig } from "./google-sso.config";
import { ExpiringStore, type AccessGrant, type AuthCodeGrant } from "./google-sso.store";

const CODE_TTL_MS: number = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_S: number = 300;
const ID_TOKEN_TTL_S: number = 300;

/** Why an authorize request was refused, in OAuth's error vocabulary. */
export type AuthorizeProblem =
  | { kind: "bad_client" }
  | { kind: "bad_redirect" }
  | { kind: "redirect_error"; error: string; description: string };

/** The parts of the authorize query this provider reads. */
export interface AuthorizeQuery {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  nonce?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

/** The parts of the token request body this provider reads. */
export interface TokenRequest {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
}

export type TokenResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string; description: string };

/** The signed-in portal user the authorize step hands over. */
export interface SsoUser {
  id: string;
  email: string;
  name?: string | null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left: Buffer = Buffer.from(a);
  const right: Buffer = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * A minimal OpenID Connect identity provider with exactly one client: Google
 * Workspace's third-party SSO profile. Google sends a Workspace user here to
 * sign in, the portal checks its own session, and Google gets back an RS256
 * id_token whose email must match the user's primary Google address.
 *
 * Deliberately separate from Better Auth's MCP OAuth provider: that one uses
 * opaque HS256-signed tokens and dynamic registration, both wrong for this.
 */
@Injectable()
export class GoogleSsoService {
  private readonly logger: Logger = new Logger(GoogleSsoService.name);
  private readonly settings: GoogleSsoConfig | null;
  private readonly codes: ExpiringStore<AuthCodeGrant> = new ExpiringStore(CODE_TTL_MS);
  private readonly tokens: ExpiringStore<AccessGrant> = new ExpiringStore(ACCESS_TOKEN_TTL_S * 1000);
  private readonly jwk: JsonWebKey | null;
  private readonly kid: string | null;

  constructor(config: ConfigService) {
    let settings: GoogleSsoConfig | null = null;
    try {
      settings = loadGoogleSsoConfig(config);
    } catch (err) {
      this.logger.error(`Google SSO is off: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.settings = settings;
    if (settings) {
      const jwk: JsonWebKey = settings.publicKey.export({ format: "jwk" }) as JsonWebKey;
      // RFC 7638 thumbprint, so the kid changes whenever the key does.
      const thumb: string = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
      this.kid = base64url(createHash("sha256").update(thumb).digest());
      this.jwk = { kty: jwk.kty, n: jwk.n, e: jwk.e, kid: this.kid, use: "sig", alg: "RS256" } as JsonWebKey;
      this.logger.log(`Google SSO is on for ${settings.allowedDomains.join(", ")}`);
    } else {
      this.jwk = null;
      this.kid = null;
    }
  }

  get enabled(): boolean {
    return this.settings !== null;
  }

  get webUrl(): string {
    return this.settings?.webUrl ?? "";
  }

  discovery(): Record<string, unknown> {
    const s: GoogleSsoConfig = this.require();
    return {
      issuer: s.issuer,
      authorization_endpoint: `${s.issuer}/authorize`,
      token_endpoint: `${s.issuer}/token`,
      userinfo_endpoint: `${s.issuer}/userinfo`,
      jwks_uri: `${s.issuer}/jwks`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "email", "profile"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      claims_supported: ["iss", "sub", "aud", "exp", "iat", "auth_time", "nonce", "email", "email_verified", "name"],
      code_challenge_methods_supported: ["S256"],
    };
  }

  jwks(): { keys: JsonWebKey[] } {
    this.require();
    return { keys: [this.jwk as JsonWebKey] };
  }

  /**
   * Checks the authorize query. Client and redirect problems must not redirect
   * (the redirect target is untrusted until both match), everything else goes
   * back to Google as an OAuth error.
   */
  checkAuthorize(q: AuthorizeQuery): AuthorizeProblem | null {
    const s: GoogleSsoConfig = this.require();
    if (!q.client_id || !safeEqual(q.client_id, s.clientId)) return { kind: "bad_client" };
    if (!q.redirect_uri || !s.redirectUris.includes(q.redirect_uri)) return { kind: "bad_redirect" };
    if (q.response_type !== "code") {
      return { kind: "redirect_error", error: "unsupported_response_type", description: "Only the code flow is supported" };
    }
    const scopes: string[] = (q.scope ?? "").split(" ");
    if (!scopes.includes("openid")) {
      return { kind: "redirect_error", error: "invalid_scope", description: "The openid scope is required" };
    }
    if (q.code_challenge && (q.code_challenge_method ?? "plain") !== "S256") {
      return { kind: "redirect_error", error: "invalid_request", description: "Only S256 code challenges are supported" };
    }
    return null;
  }

  /** Whether this portal user may sign in to Google through the portal. */
  isAllowed(email: string): boolean {
    const s: GoogleSsoConfig = this.require();
    const domain: string = email.toLowerCase().split("@").pop() ?? "";
    return s.allowedDomains.includes(domain);
  }

  /** Issues a code for an already-checked request and returns the redirect back to Google. */
  issueCode(q: AuthorizeQuery, user: SsoUser, authTime: number): string {
    this.require();
    const code: string = this.codes.issue({
      userId: user.id,
      email: user.email.toLowerCase(),
      name: user.name ?? "",
      clientId: q.client_id as string,
      redirectUri: q.redirect_uri as string,
      scope: q.scope ?? "openid",
      nonce: q.nonce,
      codeChallenge: q.code_challenge,
      codeChallengeMethod: q.code_challenge_method,
      authTime,
    });
    return this.redirectTo(q.redirect_uri as string, { code, state: q.state });
  }

  /** Builds `redirect_uri?params`, keeping any query the URI already had. */
  redirectTo(redirectUri: string, params: Record<string, string | undefined>): string {
    const url: URL = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /** The token endpoint: redeems a code for an id_token and access token. */
  exchange(body: TokenRequest, authorization: string | undefined): TokenResult {
    const s: GoogleSsoConfig = this.require();
    const creds: { id: string; secret: string } | null = this.clientCredentials(body, authorization);
    if (!creds || !safeEqual(creds.id, s.clientId) || !safeEqual(creds.secret, s.clientSecret)) {
      return { ok: false, status: 401, error: "invalid_client", description: "Client authentication failed" };
    }
    if (body.grant_type !== "authorization_code") {
      return { ok: false, status: 400, error: "unsupported_grant_type", description: "Only authorization_code is supported" };
    }
    const grant: AuthCodeGrant | undefined = body.code ? this.codes.take(body.code) : undefined;
    if (!grant || grant.clientId !== creds.id || grant.redirectUri !== body.redirect_uri) {
      return { ok: false, status: 400, error: "invalid_grant", description: "The code is invalid, expired or already used" };
    }
    if (grant.codeChallenge) {
      const verifier: string = body.code_verifier ?? "";
      const expected: string = base64url(createHash("sha256").update(verifier).digest());
      if (!verifier || !safeEqual(expected, grant.codeChallenge)) {
        return { ok: false, status: 400, error: "invalid_grant", description: "The code verifier does not match" };
      }
    }
    const now: number = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: s.issuer,
      sub: grant.userId,
      aud: s.clientId,
      iat: now,
      exp: now + ID_TOKEN_TTL_S,
      auth_time: grant.authTime,
      email: grant.email,
      email_verified: true,
      ...(grant.name ? { name: grant.name } : {}),
      ...(grant.nonce ? { nonce: grant.nonce } : {}),
    };
    const accessToken: string = this.tokens.issue({
      userId: grant.userId,
      email: grant.email,
      name: grant.name,
      scope: grant.scope,
    });
    this.logger.log(`Issued Google SSO tokens for ${grant.email}`);
    return {
      ok: true,
      body: {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_S,
        scope: grant.scope,
        id_token: this.signIdToken(claims),
      },
    };
  }

  /** The userinfo endpoint's claims for a bearer access token, or null. */
  userinfo(authorization: string | undefined): Record<string, unknown> | null {
    this.require();
    const match: RegExpMatchArray | null = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
    const grant: AccessGrant | undefined = match ? this.tokens.peek(match[1]) : undefined;
    if (!grant) return null;
    return {
      sub: grant.userId,
      email: grant.email,
      email_verified: true,
      ...(grant.name ? { name: grant.name } : {}),
    };
  }

  signIdToken(claims: Record<string, unknown>): string {
    const s: GoogleSsoConfig = this.require();
    const header: string = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: this.kid }));
    const payload: string = base64url(JSON.stringify(claims));
    const signature: Buffer = sign("sha256", Buffer.from(`${header}.${payload}`), s.privateKey);
    return `${header}.${payload}.${base64url(signature)}`;
  }

  /** client_secret_basic (Authorization header) or client_secret_post (body). */
  private clientCredentials(body: TokenRequest, authorization: string | undefined): { id: string; secret: string } | null {
    const basic: RegExpMatchArray | null = /^Basic\s+(\S+)$/i.exec(authorization ?? "");
    if (basic) {
      const decoded: string = Buffer.from(basic[1], "base64").toString("utf8");
      const colon: number = decoded.indexOf(":");
      if (colon === -1) return null;
      // RFC 6749 2.3.1: both parts are form-urlencoded before base64.
      try {
        return {
          id: decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, " ")),
          secret: decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, " ")),
        };
      } catch {
        return null;
      }
    }
    if (body.client_id && body.client_secret) return { id: body.client_id, secret: body.client_secret };
    return null;
  }

  private require(): GoogleSsoConfig {
    if (!this.settings) throw new Error("Google SSO is not configured");
    return this.settings;
  }
}
