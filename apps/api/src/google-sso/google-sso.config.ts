import { createPrivateKey, createPublicKey, KeyObject } from "crypto";
import { publicApiUrl } from "../common/helpers/public-api-url";

type ConfigLike = { get: (key: string) => string | undefined };

/** Everything the Google SSO identity provider needs, or null when it is off. */
export interface GoogleSsoConfig {
  issuer: string;
  webUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  allowedDomains: string[];
  privateKey: KeyObject;
  publicKey: KeyObject;
}

/** The OIDC issuer: discovery lives at `${issuer}/.well-known/openid-configuration`. */
export function googleSsoIssuer(config: ConfigLike): string {
  return `${publicApiUrl(config)}/api/sso/google`;
}

/** Splits a comma or whitespace separated env value into trimmed, non-empty entries. */
export function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((v: string) => v.trim())
    .filter((v: string) => v.length > 0);
}

/**
 * GOOGLE_SSO_PRIVATE_KEY may be a PEM (with real or "\n"-escaped newlines) or
 * the PEM base64-encoded on one line, which survives compose files and .env.
 */
export function decodePrivateKey(raw: string): KeyObject {
  let pem: string = raw.trim();
  if (!pem.includes("-----BEGIN")) pem = Buffer.from(pem, "base64").toString("utf8");
  pem = pem.replace(/\\n/g, "\n");
  const key: KeyObject = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "rsa") throw new Error("GOOGLE_SSO_PRIVATE_KEY must be an RSA key");
  return key;
}

/**
 * Reads the GOOGLE_SSO_* settings. The provider is off unless every required
 * value is present, so a half-configured install never issues tokens.
 */
export function loadGoogleSsoConfig(config: ConfigLike): GoogleSsoConfig | null {
  const clientId: string | undefined = config.get("GOOGLE_SSO_CLIENT_ID");
  const clientSecret: string | undefined = config.get("GOOGLE_SSO_CLIENT_SECRET");
  const rawKey: string | undefined = config.get("GOOGLE_SSO_PRIVATE_KEY");
  const allowedDomains: string[] = splitList(config.get("GOOGLE_SSO_ALLOWED_DOMAINS")).map((d: string) =>
    d.toLowerCase().replace(/^@/, ""),
  );
  if (!clientId || !clientSecret || clientSecret.length < 32 || !rawKey || allowedDomains.length === 0) return null;
  const privateKey: KeyObject = decodePrivateKey(rawKey);
  return {
    issuer: googleSsoIssuer(config),
    webUrl: (config.get("WEB_URL") || "http://localhost:3000").replace(/\/+$/, ""),
    clientId,
    clientSecret,
    redirectUris: splitList(config.get("GOOGLE_SSO_REDIRECT_URIS")),
    allowedDomains,
    privateKey,
    publicKey: createPublicKey(privateKey),
  };
}
