import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";

// Load the monorepo root .env so NEXT_PUBLIC_* vars are present when
// Playwright spawns `next dev` (Next.js only auto-loads envs from its own
// package directory, which is `apps/web`).
const rootEnvPath = join(__dirname, "..", ".env");
if (existsSync(rootEnvPath)) {
  for (const line of readFileSync(rootEnvPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

// Shared by the test runner and the web server it starts, so assertions read
// the same value the server renders. The web app reads it per request, so it
// only needs to be in the server's runtime environment, not the build's.
const TRACKERS: string =
  process.env.ATRIUM_TRACKERS ??
  '[{"src":"http://localhost:3000/__e2e-tracker.js","data-website-id":"e2e"}]';
process.env.ATRIUM_TRACKERS = TRACKERS;

/**
 * The demo workspace these tests drive. Shared with global-setup.ts, which
 * seeds it.
 *
 * It follows the configured slug when there is one, because a database holds
 * at most one demo workspace: the demo accounts' addresses are fixed, and a
 * User row is unique by email, so seeding a second workspace under a different
 * slug fails on that constraint. Pinning a separate slug here also disagreed
 * with the server — `reuseExistingServer` means a local run talks to a dev API
 * already configured for its own slug, so the suite would have been driving a
 * workspace the server knew nothing about.
 *
 * Locally that means a run reseeds the developer's demo workspace. That is
 * demo data: it is disposable by definition and resets itself twice an hour.
 * In CI nothing is configured, so this value is what Playwright starts the
 * API with.
 */
/**
 * google-sso.e2e.ts drives the portal as Google Workspace's OIDC identity
 * provider. A throwaway RSA key per run; the callback is never served, the
 * test intercepts the redirect to it.
 */
export const GOOGLE_SSO_CLIENT_ID: string = "google-workspace-e2e";
/** studio-sync.e2e.ts calls the account page's internal endpoints with this token. */
export const STUDIO_SYNC_TOKEN: string = "e2e-studio-sync-token-0123456789abcdef";
export const GOOGLE_SSO_CLIENT_SECRET: string = "e2e-google-sso-secret-0123456789abcdef";
export const GOOGLE_SSO_REDIRECT_URI: string = "https://accounts.google.test/sso/oidc/callback";
const GOOGLE_SSO_PRIVATE_KEY: string = Buffer.from(
  generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
).toString("base64");

/** google-calendar.e2e.ts: a fake OAuth client, so the connect flow is on. Google itself is never reached. */
export const GOOGLE_CALENDAR_CLIENT_ID: string = "google-calendar-e2e.apps.googleusercontent.com";
const GOOGLE_CALENDAR_CLIENT_SECRET: string = "e2e-google-calendar-secret";

export const DEMO_SLUG: string = process.env.DEMO_ORG_SLUG ?? "demo-e2e";

// Set on the runner process too, not only in the webServer child envs: global
// setup reads it to decide whether to seed the demo workspace, and without the
// seed every demo case signs in as a user that does not exist and times out.
process.env.DEMO_MODE = "true";
process.env.DEMO_ORG_SLUG = DEMO_SLUG;

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.e2e.ts",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    storageState: "e2e/.auth/user.json",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: process.env.CI
        ? "bun run apps/api/dist/main"
        : "bun run --filter @atrium/api dev",
      url: "http://localhost:3001/api/health",
      reuseExistingServer: !process.env.CI,
      cwd: "../",
      // integrations.e2e.ts points a webhook at a capture server on 127.0.0.1.
      // Blank STRIPE_CONNECT_CLIENT_ID so a developer's root .env can't flip the
      // payments tests into Connect mode.
      env: {
        INTEGRATIONS_ALLOW_PRIVATE_URLS: "true",
        STRIPE_CONNECT_CLIENT_ID: "",
        // billcom-payments.e2e.ts runs a stand-in for BILL's API on this port.
        BILLCOM_API_BASE_URL: "http://127.0.0.1:4599",
        // demo.e2e.ts needs demo mode on, against the same workspace global
        // setup seeds — see DEMO_SLUG for why the two must agree.
        DEMO_MODE: "true",
        DEMO_ORG_SLUG: DEMO_SLUG,
        DEMO_OWNER_EMAIL: "owner@demo.invalid",
        DEMO_CLIENT_EMAIL: "client@demo.invalid",
        GOOGLE_SSO_CLIENT_ID,
        GOOGLE_SSO_CLIENT_SECRET,
        GOOGLE_SSO_PRIVATE_KEY,
        GOOGLE_SSO_REDIRECT_URIS: GOOGLE_SSO_REDIRECT_URI,
        // Every e2e owner signs up at test.local.
        GOOGLE_SSO_ALLOWED_DOMAINS: "test.local",
        GOOGLE_CALENDAR_CLIENT_ID,
        GOOGLE_CALENDAR_CLIENT_SECRET,
        STUDIO_SYNC_TOKEN,
      },
    },
    {
      command: process.env.CI
        ? "bun run --filter @atrium/web start"
        : "bun run --filter @atrium/web dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      cwd: "../",
      env: {
        ATRIUM_TRACKERS: TRACKERS,
        // DEMO_MODE is deliberately NOT set for the web server. Whether a page
        // shows the demo banner now comes from /api/organization/current, which
        // is organization-scoped, so every other test's workspace is unaffected
        // and only demo.e2e.ts sees the banner.
        DEMO_APP_URL: "http://localhost:3000",
      },
    },
  ],
});
