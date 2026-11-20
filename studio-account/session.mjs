// A short sign-in session for the account page: an expiry time signed with a
// key that lives only in memory, so a restart signs everyone out.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "sa_session";
export const SESSION_TTL_MS = 30 * 60 * 1000;

export function createSessions(key = randomBytes(32), now = () => Date.now()) {
  const sign = (exp) => createHmac("sha256", key).update(String(exp)).digest("hex");
  return {
    issue() {
      const exp = now() + SESSION_TTL_MS;
      return `${exp}.${sign(exp)}`;
    },
    valid(token) {
      if (typeof token !== "string") return false;
      const [expStr, mac] = token.split(".");
      const exp = Number(expStr);
      if (!Number.isFinite(exp) || exp < now() || !mac) return false;
      const want = Buffer.from(sign(exp));
      const got = Buffer.from(mac);
      return want.length === got.length && timingSafeEqual(want, got);
    },
  };
}

export function readCookie(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export function sessionCookie(value, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}
