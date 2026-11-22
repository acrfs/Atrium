import { test, expect } from "@playwright/test";
import { STUDIO_SYNC_TOKEN } from "../playwright.config";
import { createOwner } from "./helpers";

const API = "http://localhost:3001/api";
const headers = { "x-studio-sync-token": STUDIO_SYNC_TOKEN };

// account.shanastudios.co checks the current password and sets a new one
// through these internal endpoints. The portal password is also the Google
// Workspace sign-in, so this is the one password change Shana makes.

test.describe("Studio account page endpoints", () => {
  test("refuse calls without the sync token", async ({ request }) => {
    const verify = await request.post(`${API}/internal/studio-sync/verify`, {
      data: { loginEmail: "nobody@test.local", password: "whatever1" },
    });
    expect(verify.status()).toBe(403);
    const set = await request.post(`${API}/internal/studio-sync/password`, {
      headers: { "x-studio-sync-token": "x".repeat(STUDIO_SYNC_TOKEN.length) },
      data: { loginEmail: "nobody@test.local", password: "whatever1" },
    });
    expect(set.status()).toBe(403);
  });

  test("check the current password, then set a new one that signs in", async ({ browser, request }) => {
    const owner = await createOwner(browser, "studio-sync");
    try {
      const check = (password: string) =>
        request.post(`${API}/internal/studio-sync/verify`, { headers, data: { loginEmail: owner.email, password } });

      expect(await (await check("not-the-password")).json()).toEqual({ ok: false });
      expect(await (await check(owner.password)).json()).toEqual({ ok: true });

      const newPassword = "Brand new studio phrase 7";
      const set = await request.post(`${API}/internal/studio-sync/password`, {
        headers,
        data: { loginEmail: owner.email, password: newPassword },
      });
      expect(set.status()).toBe(200);
      expect((await set.json()).login).toBe("updated");

      expect(await (await check(owner.password)).json()).toEqual({ ok: false });
      expect(await (await check(newPassword)).json()).toEqual({ ok: true });

      const fresh = await browser.newContext({ storageState: undefined });
      const signIn = await fresh.request.post(`${API}/auth/sign-in/email`, {
        headers: { origin: "http://localhost:3000" },
        data: { email: owner.email, password: newPassword },
      });
      expect(signIn.ok()).toBe(true);
      await fresh.close();
    } finally {
      await owner.context.close();
    }
  });

  test("an unknown user is a wrong password, not an error", async ({ request }) => {
    const res = await request.post(`${API}/internal/studio-sync/verify`, {
      headers,
      data: { loginEmail: `nobody-${Date.now()}@test.local`, password: "whatever1" },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });
});
