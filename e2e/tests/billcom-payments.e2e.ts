import { test, expect } from "@playwright/test";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { createHmac } from "node:crypto";
import { createPortalClientProject, getCsrfTokenFromContext, getPlanFeatures } from "./helpers";
import type { PortalClientProject } from "./helpers";

const API = "http://localhost:3001/api";
// playwright.config.ts starts the API with BILLCOM_API_BASE_URL pointing here.
const BILL_PORT = 4599;
const BILL = `http://127.0.0.1:${BILL_PORT}`;
const SECURITY_KEY = "e2e-bill-security-key";

interface BillInvoice {
  id: string;
  customerId: string;
  invoiceNumber: string;
  status: string;
  totalAmount: number;
  body: Record<string, unknown>;
}

/** A small stand-in for BILL's v3 API: just the calls the portal makes. */
class FakeBill {
  server!: Server;
  invoices = new Map<string, BillInvoice>();
  logins: Array<Record<string, unknown>> = [];
  subscriptions: Array<Record<string, unknown>> = [];
  deletedSubscriptions: string[] = [];
  paymentLinks: Array<Record<string, unknown>> = [];
  private seq = 0;

  start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      const body = await readJson(req);
      const url = new URL(req.url ?? "/", BILL);
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      const p = url.pathname;

      if (p.startsWith("/pay/")) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body><h1>Fake BILL payment page</h1></body></html>");
        return;
      }
      if (req.method === "POST" && p === "/connect/v3/login") {
        this.logins.push(body);
        if (body.password !== "right-password") {
          return send(400, [{ code: "BDC_1102", message: "Incorrect username or password." }]);
        }
        return send(200, { sessionId: "sess-1", organizationId: body.organizationId, userId: "006u", trusted: true });
      }
      if (req.headers.sessionid !== "sess-1" || req.headers.devkey !== "e2e-dev-key") {
        return send(400, [{ code: "BDC_1109", message: "Session is invalid.  Please log in." }]);
      }
      if (req.method === "POST" && p === "/connect-events/v3/subscriptions") {
        this.subscriptions.push(body);
        return send(201, { id: "sub-e2e", securityKey: SECURITY_KEY });
      }
      if (req.method === "DELETE" && p.startsWith("/connect-events/v3/subscriptions/")) {
        this.deletedSubscriptions.push(p.split("/").pop() ?? "");
        return send(200, {});
      }
      if (req.method === "POST" && p === "/connect/v3/invoices") {
        const id = `00e${++this.seq}`;
        const lines = (body.invoiceLineItems as Array<{ quantity: number; price: number }>) ?? [];
        const inv: BillInvoice = {
          id,
          customerId: "0cu-e2e",
          invoiceNumber: String(body.invoiceNumber),
          status: "OPEN",
          totalAmount: lines.reduce((t, l) => t + l.quantity * l.price, 0),
          body,
        };
        this.invoices.set(id, inv);
        return send(201, { id, customerId: inv.customerId, status: inv.status, totalAmount: inv.totalAmount });
      }
      const linkMatch = p.match(/^\/connect\/v3\/invoices\/([^/]+)\/payment-link$/);
      if (req.method === "POST" && linkMatch) {
        this.paymentLinks.push({ invoiceId: linkMatch[1], ...body });
        return send(200, { paymentLink: `${BILL}/pay/${linkMatch[1]}` });
      }
      const getMatch = p.match(/^\/connect\/v3\/invoices\/([^/]+)$/);
      if (req.method === "GET" && getMatch) {
        const inv = this.invoices.get(getMatch[1]);
        if (!inv) return send(404, [{ code: "BDC_1000", message: "Not found" }]);
        const { body: _b, ...rest } = inv;
        return send(200, { ...rest, dueAmount: inv.status === "PAID_IN_FULL" ? 0 : inv.totalAmount });
      }
      send(404, [{ code: "BDC_404", message: `No fake for ${req.method} ${p}` }]);
    });
    return new Promise((resolve) => this.server.listen(BILL_PORT, "127.0.0.1", () => resolve()));
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

test.describe("Bill.com invoice payments", () => {
  const bill = new FakeBill();
  let portal: PortalClientProject;
  let orgId: string;

  test.beforeAll(async ({ browser, request }) => {
    test.setTimeout(180000);
    const features = await getPlanFeatures(request);
    test.skip(!features.online_payments, "Online payments need a paid plan");
    await bill.start();
    portal = await createPortalClientProject(browser, "billcom", "Bill.com E2E");
    const org = await (await portal.owner.request.get(`${API}/organization/current`)).json();
    orgId = org.id;
  });

  test.afterAll(async () => {
    await portal?.close();
    if (bill.server) await bill.stop();
  });

  test("owner connects Bill.com, client pays through BILL, invoice turns paid", async () => {
    test.setTimeout(180000);
    const { owner, client, ownerHeaders } = portal;

    // ── A wrong password is refused and nothing is saved ──
    const bad = await owner.request.post(`${API}/payments/billcom/connect`, {
      data: { username: "shana@example.com", password: "nope", organizationId: "00801E2E", devKey: "e2e-dev-key", sandbox: true },
      headers: ownerHeaders,
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).message).toContain("Could not sign in to Bill.com");

    // ── Connect from the settings page ──
    await owner.goto("/dashboard/settings/billing");
    const form = owner.getByTestId("billcom-connect");
    await expect(form).toBeVisible({ timeout: 15000 });
    await form.getByLabel(/bill\.com email/i).fill("shana@example.com");
    await form.getByLabel(/bill\.com password/i).fill("right-password");
    await form.getByLabel(/organization id/i).fill("00801E2E");
    await form.getByLabel(/developer key/i).fill("e2e-dev-key");
    await form.getByLabel(/sandbox/i).check();
    await form.getByRole("button", { name: /connect bill\.com/i }).click();
    await expect(owner.getByTestId("billcom-connected")).toBeVisible({ timeout: 15000 });
    await expect(owner.getByText("Sandbox", { exact: true })).toBeVisible();

    expect(bill.subscriptions).toHaveLength(1);
    expect(bill.subscriptions[0].notificationUrl).toContain(`/api/payments/billcom/webhook/${orgId}`);
    expect(bill.subscriptions[0].events).toEqual([{ type: "invoice.updated", version: "1" }]);

    // Saved secrets never come back from the settings API.
    const settings = await (await owner.request.get(`${API}/settings`)).json();
    expect(settings.billcomPassword).toBe("••••••••");
    expect(settings.billcomDevKey).toBe("••••••••");
    expect(JSON.stringify(settings)).not.toContain("right-password");

    // ── Owner sends an invoice ──
    const created = await owner.request.post(`${API}/invoices`, {
      data: {
        projectId: portal.projectId,
        lineItems: [
          { description: "Logo design", quantity: 1, unitPrice: 50000 },
          { description: "Business cards", quantity: 2, unitPrice: 7550 },
        ],
      },
      headers: ownerHeaders,
    });
    expect(created.status()).toBe(201);
    const invoice: { id: string; invoiceNumber: string } = await created.json();
    const sent = await owner.request.put(`${API}/invoices/${invoice.id}`, {
      data: { status: "sent" },
      headers: ownerHeaders,
    });
    expect(sent.ok()).toBeTruthy();

    // ── Client sees Pay and is sent to BILL's page ──
    const enabled = await (await client.request.get(`${API}/payments/enabled`)).json();
    expect(enabled.enabled).toBe(true);

    await client.goto(`/portal/projects/${portal.projectId}?tab=invoices`);
    await expect(client.getByText(invoice.invoiceNumber).first()).toBeVisible({ timeout: 15000 });
    await client.getByRole("button", { name: /^pay$/i }).first().click();
    await client.waitForURL(/127\.0\.0\.1:4599\/pay\//, { timeout: 15000 });
    await expect(client.getByText("Fake BILL payment page")).toBeVisible();

    expect(bill.invoices.size).toBe(1);
    const billInvoice = [...bill.invoices.values()][0];
    expect(billInvoice.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(billInvoice.totalAmount).toBeCloseTo(651, 2);
    expect(billInvoice.body.customer).toEqual({
      name: expect.any(String),
      email: portal.clientEmail.toLowerCase(),
    });
    const link = bill.paymentLinks[0];
    expect(link.customerId).toBe("0cu-e2e");
    expect(String(link.returnUrl)).toContain("payment=submitted");

    // Asking again reuses the same BILL invoice.
    const again = await client.request.post(`${API}/payments/checkout/${invoice.id}`, {
      data: {
        successUrl: `http://localhost:3000/portal/projects/${portal.projectId}?payment=success`,
        cancelUrl: `http://localhost:3000/portal/projects/${portal.projectId}?payment=cancelled`,
      },
      headers: { "x-csrf-token": await csrfFor(client) },
    });
    expect(again.ok()).toBeTruthy();
    expect((await again.json()).url).toBe(`${BILL}/pay/${billInvoice.id}`);
    expect(bill.invoices.size).toBe(1);

    // ── A notice that claims "paid" is ignored while BILL still says open ──
    const forged = JSON.stringify({ metadata: { eventType: "invoice.updated" }, invoice: { id: billInvoice.id, status: "PAID_IN_FULL" } });
    const forgedRes = await owner.request.post(`${API}/payments/billcom/webhook/${orgId}`, {
      data: forged,
      headers: { "content-type": "application/json", "x-bill-sha-signature": "forged" },
    });
    expect(forgedRes.ok()).toBeTruthy();
    expect((await (await owner.request.get(`${API}/invoices/${invoice.id}`)).json()).status).toBe("sent");

    // ── BILL marks it paid and notifies the portal ──
    billInvoice.status = "PAID_IN_FULL";
    const real = JSON.stringify({ metadata: { eventType: "invoice.updated" }, invoice: { id: billInvoice.id, status: "PAID_IN_FULL" } });
    const sig = createHmac("sha256", SECURITY_KEY).update(real).digest("base64");
    const hook = await owner.request.post(`${API}/payments/billcom/webhook/${orgId}`, {
      data: real,
      headers: { "content-type": "application/json", "x-bill-sha-signature": sig },
    });
    expect(hook.ok()).toBeTruthy();
    const paid = await (await owner.request.get(`${API}/invoices/${invoice.id}`)).json();
    expect(paid.status).toBe("paid");
    expect(paid.paidAmount).toBe(65100);

    // Portal shows the return message and the paid invoice has no Pay button.
    await client.goto(`/portal/projects/${portal.projectId}?tab=invoices&payment=submitted`);
    await expect(client.getByText(/your payment was sent/i)).toBeVisible({ timeout: 15000 });
    await expect(client.getByRole("button", { name: /^pay$/i })).toHaveCount(0);

    // ── Disconnect removes the BILL webhook and turns payments off ──
    await owner.goto("/dashboard/settings/billing");
    owner.once("dialog", (d) => d.accept());
    await owner.getByRole("button", { name: /disconnect bill\.com/i }).click();
    await expect(owner.getByTestId("billcom-connect")).toBeVisible({ timeout: 15000 });
    expect(bill.deletedSubscriptions).toEqual(["sub-e2e"]);
    expect((await (await client.request.get(`${API}/payments/enabled`)).json()).enabled).toBe(false);
  });

  test("clients cannot change the Bill.com connection", async () => {
    const res = await portal.client.request.post(`${API}/payments/billcom/connect`, {
      data: { username: "x@example.com", password: "right-password", organizationId: "00801E2E", devKey: "e2e-dev-key", sandbox: true },
      headers: { "x-csrf-token": await csrfFor(portal.client) },
    });
    expect(res.status()).toBe(403);
    const status = await portal.client.request.get(`${API}/payments/billcom/status`);
    expect(status.status()).toBe(403);
  });

  test("webhooks for a workspace without Bill.com are refused", async ({ request }) => {
    const res = await request.post(`${API}/payments/billcom/webhook/not-a-real-org`, {
      data: "{}",
      headers: { "content-type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });
});

function csrfFor(page: import("@playwright/test").Page): Promise<string> {
  return getCsrfTokenFromContext(page.context());
}
