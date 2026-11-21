import { test, expect, type Browser, type Page } from "@playwright/test";
import { createOwner } from "./helpers";

const API = "http://localhost:3001/api";
const WEB_URL = "http://localhost:3000";

// A Developer runs the portal's technical side (settings, email, branding,
// integrations) and never sees the studio's projects, clients or invoices.

async function inviteDeveloperThroughTeamPage(ownerPage: Page, email: string): Promise<string> {
  await ownerPage.goto(`${WEB_URL}/dashboard/settings/team`, { waitUntil: "networkidle" });
  await ownerPage.getByLabel("Team member email").fill(email);
  await ownerPage.getByLabel("Role", { exact: true }).selectOption("developer");
  await ownerPage.getByRole("button", { name: /^invite$/i }).click();
  await expect(ownerPage.getByText("Invitation sent")).toBeVisible({ timeout: 10000 });

  const res = await ownerPage.request.get(`${API}/clients/invitations`);
  expect(res.ok()).toBe(true);
  const invitations: { id: string; email: string; role: string }[] = await res.json();
  const invite = invitations.find((i) => i.email === email.toLowerCase());
  expect(invite?.role).toBe("developer");
  return invite!.id;
}

async function acceptAsDeveloper(browser: Browser, invitationId: string, email: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: undefined });
  const page: Page = await ctx.newPage();
  await page.goto(`${WEB_URL}/accept-invite?id=${invitationId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Staff invitations go straight to the password form (no sign-in link option).
  await page.waitForSelector("#name", { state: "visible", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 });
  await page.locator("#name").fill("Dev Person");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("Developer123!");
  await page.getByRole("button", { name: /create account & join/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings\/workspace/, { timeout: 20000 });
  return page;
}

test.describe("Developer role", () => {
  test("an owner invites a developer who gets settings but none of the studio's work", async ({ browser }) => {
    test.setTimeout(120000);
    const { context: ownerCtx, page: ownerPage } = await createOwner(browser, "dev-role-owner");
    const devEmail = `dev-role-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;

    const invitationId: string = await inviteDeveloperThroughTeamPage(ownerPage, devEmail);
    const dev: Page = await acceptAsDeveloper(browser, invitationId, devEmail);

    // Sidebar offers Settings only.
    await expect(dev.getByRole("link", { name: /^settings$/i }).first()).toBeVisible();
    await expect(dev.getByRole("link", { name: /^projects$/i })).toHaveCount(0);
    await expect(dev.getByRole("link", { name: /^contacts$/i })).toHaveCount(0);

    // Settings tabs leave out billing and payments.
    const tabs = dev.getByRole("navigation", { name: "Settings" });
    await expect(tabs.getByRole("link", { name: "Team", exact: true })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Integrations", exact: true })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Billing & Payments" })).toHaveCount(0);

    // Studio pages send the developer back to Settings.
    for (const path of ["/dashboard", "/dashboard/projects", "/dashboard/contacts", "/portal"]) {
      await dev.goto(`${WEB_URL}${path}`);
      await expect(dev).toHaveURL(/\/dashboard\/settings\/workspace/, { timeout: 15000 });
    }

    // The API refuses the studio's data and allows the technical settings.
    for (const path of ["/projects", "/contacts", "/invoices", "/clients?role=client", "/search?q=a"]) {
      const res = await dev.request.get(`${API}${path}`);
      expect(res.status(), path).toBe(403);
    }
    expect((await dev.request.get(`${API}/settings`)).ok()).toBe(true);
    expect((await dev.request.get(`${API}/integrations`)).ok()).toBe(true);
    const staff = await dev.request.get(`${API}/clients?role=staff`);
    expect(staff.ok()).toBe(true);
    const body: { data: { role: string; hourlyRateCents: number | null }[] } = await staff.json();
    expect(body.data.map((m) => m.role).sort()).toEqual(["developer", "owner"]);
    expect(body.data.every((m) => m.hourlyRateCents === null)).toBe(true);

    // The owner sees the new teammate as a developer.
    await ownerPage.goto(`${WEB_URL}/dashboard/settings/team`, { waitUntil: "networkidle" });
    await expect(ownerPage.getByLabel("Role of Dev Person")).toHaveValue("developer");

    await dev.context().close();
    await ownerCtx.close();
  });
});
