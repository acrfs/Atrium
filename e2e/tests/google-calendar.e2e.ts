import { test, expect } from "@playwright/test";
import { GOOGLE_CALENDAR_CLIENT_ID } from "../playwright.config";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

// The real token exchange needs Google, so these cases cover everything up to
// Google's consent screen and the portal's handling of what comes back.
test.describe("Google Calendar sync", () => {
  test("status says the server is set up and nothing is connected yet", async ({ request }) => {
    const res = await request.get(`${API}/google-calendar/status`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ configured: true, connected: false, googleEmail: null }));
  });

  test("connect sends the owner to Google's consent screen for calendar access", async ({ request }) => {
    const res = await request.post(`${API}/google-calendar/connect`, {
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(res.ok()).toBe(true);
    const url = new URL((await res.json()).url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe(GOOGLE_CALENDAR_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/google-calendar\/callback$/);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  test("calendar page offers to connect Google Calendar", async ({ page }) => {
    // Never leave for the real Google during a test.
    await page.route("https://accounts.google.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Google consent (stub)</h1>" }),
    );
    await page.goto("/dashboard/calendar");
    await page.getByRole("button", { name: /Google Calendar/ }).click();
    const connect = page.getByRole("button", { name: "Connect Google Calendar" });
    await expect(connect).toBeVisible();
    await connect.click();
    await page.waitForURL(/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    await expect(page.getByText("Google consent (stub)")).toBeVisible();
  });

  test("a tampered callback is refused and explained", async ({ page }) => {
    await page.goto(`${API}/google-calendar/callback?code=abc&state=not-a-real-state`);
    await page.waitForURL(/\/dashboard\/calendar/);
    await expect(page.getByText(/took too long/)).toBeVisible({ timeout: 10000 });
    expect(page.url()).not.toContain("google=");
  });

  test("Google event endpoints refuse until an account is connected", async ({ request }) => {
    const res = await request.post(`${API}/google-calendar/events`, {
      headers: { "x-csrf-token": getCsrfToken() },
      data: { title: "Kickoff", date: "2026-12-10" },
    });
    expect(res.status()).toBe(400);
  });

  test("the calendar filter lists Google Calendar events", async ({ page }) => {
    await page.goto("/dashboard/calendar");
    await page.getByRole("button", { name: /^Filter/ }).click();
    await expect(page.getByLabel("Google Calendar")).toBeVisible();
  });
});
