import { describe, test, expect, mock, beforeEach } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { createHmac } from "crypto";
import type { ConfigService } from "@nestjs/config";
import { BillcomService, submittedUrl } from "./billcom.service";
import { BillcomClient, BillcomApiError } from "./billcom-client";
import type { PrismaService } from "../../prisma/prisma.service";
import type { SettingsService } from "../../settings/settings.service";
import type { PaymentsService } from "../payments.service";

const settingsRow = {
  organizationId: "org-1",
  billcomEnabled: true,
  billcomSandbox: true,
  billcomUsername: "enc:shana@example.com",
  billcomPassword: "enc:pw",
  billcomOrganizationId: "00801",
  billcomDevKey: "enc:devkey",
  billcomSubscriptionId: "sub-1",
  billcomWebhookKey: "enc:hook-key",
};

const baseInvoice = {
  id: "inv-1",
  organizationId: "org-1",
  invoiceNumber: "INV-0001",
  type: "itemized",
  amount: null,
  status: "sent",
  dueDate: new Date("2026-12-15T00:00:00Z"),
  createdAt: new Date("2026-11-20T00:00:00Z"),
  billcomInvoiceId: null as string | null,
  lineItems: [
    { description: "Logo design", quantity: 1, unitPrice: 50000 },
    { description: "Business cards", quantity: 2, unitPrice: 7550 },
  ],
};

function fakeClient(overrides: Partial<Record<keyof BillcomClient, unknown>> = {}) {
  return {
    login: mock(() => Promise.resolve({ sessionId: "s", trusted: true })),
    createInvoice: mock(() => Promise.resolve({ id: "00e1", customerId: "0cu1", status: "OPEN" })),
    getInvoice: mock(() => Promise.resolve({ id: "00e1", customerId: "0cu1", status: "OPEN", totalAmount: 651 })),
    getPaymentLink: mock((_id: string, _c: string, _e: string, returnUrl: string) =>
      Promise.resolve(`https://app.bill.com/pay?r=${encodeURIComponent(returnUrl)}`),
    ),
    createInvoiceSubscription: mock(() => Promise.resolve({ id: "sub-2", securityKey: "key" })),
    deleteSubscription: mock(() => Promise.resolve()),
    ...overrides,
  };
}

function setup(invoice = { ...baseInvoice }, client = fakeClient()) {
  const customers: Record<string, string> = {};
  const prisma = {
    systemSettings: {
      findUnique: mock(() => Promise.resolve(settingsRow)),
      upsert: mock(() => Promise.resolve({})),
      update: mock(() => Promise.resolve({})),
    },
    invoice: {
      updateMany: mock(({ data }: { data: { billcomInvoiceId: string } }) => {
        invoice.billcomInvoiceId = data.billcomInvoiceId;
        return Promise.resolve({ count: 1 });
      }),
      findUnique: mock(() => Promise.resolve(invoice)),
      findFirst: mock(() => Promise.resolve(invoice)),
      findMany: mock(() => Promise.resolve([])),
    },
    user: { findUnique: mock(() => Promise.resolve({ name: "Client Person", email: "Client@Example.com" })) },
    billcomCustomer: {
      findUnique: mock(({ where }: { where: { organizationId_email: { email: string } } }) => {
        const id = customers[where.organizationId_email.email];
        return Promise.resolve(id ? { billcomCustomerId: id } : null);
      }),
      upsert: mock(({ create }: { create: { email: string; billcomCustomerId: string } }) => {
        customers[create.email] = create.billcomCustomerId;
        return Promise.resolve({});
      }),
    },
  };
  const settings = {
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => v.replace(/^enc:/, ""),
  };
  const payments = {
    checkAppUrl: mock(() => {}),
    findPayableInvoice: mock(() => Promise.resolve(invoice)),
    markInvoicePaid: mock(() => Promise.resolve(true)),
  };
  const config = { get: (_k: string, fallback?: string) => fallback ?? "https://portal.example.com" };
  const service = new BillcomService(
    prisma as unknown as PrismaService,
    settings as unknown as SettingsService,
    payments as unknown as PaymentsService,
    config as unknown as ConfigService,
  );
  service.useClientFactory(() => client as unknown as BillcomClient);
  return { service, prisma, payments, client, invoice, customers };
}

const returnUrl = "https://portal.example.com/portal/projects/p-1?payment=success";

describe("BillcomService.lineItemsFor", () => {
  test("itemized invoices keep their lines, in dollars", () => {
    const { service } = setup();
    expect(service.lineItemsFor(baseInvoice)).toEqual([
      { quantity: 1, description: "Logo design", price: 500 },
      { quantity: 2, description: "Business cards", price: 75.5 },
    ]);
  });

  test("uploaded invoices become one line for the total", () => {
    const { service } = setup();
    expect(
      service.lineItemsFor({ ...baseInvoice, type: "uploaded", amount: 12345, lineItems: [] }),
    ).toEqual([{ quantity: 1, description: "Invoice INV-0001", price: 123.45 }]);
  });

  test("a zero total is refused", () => {
    const { service } = setup();
    expect(() => service.lineItemsFor({ ...baseInvoice, lineItems: [] })).toThrow(BadRequestException);
  });
});

describe("BillcomService.createPaymentLink", () => {
  test("first payment creates the BILL invoice and customer, then returns BILL's page", async () => {
    const { service, client, invoice, customers } = setup();
    const res = await service.createPaymentLink("inv-1", "user-1", "org-1", returnUrl);

    expect(client.createInvoice).toHaveBeenCalledTimes(1);
    const body = (client.createInvoice.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(body.customer).toEqual({ name: "Client Person", email: "client@example.com" });
    expect(body.invoiceNumber).toBe("INV-0001");
    expect(body.dueDate).toBe("2026-12-15");
    expect(body.invoiceDate).toBe("2026-11-20");
    expect(invoice.billcomInvoiceId).toBe("00e1");
    expect(customers["client@example.com"]).toBe("0cu1");
    expect(res.url).toContain(encodeURIComponent("payment=submitted"));
  });

  test("a second payment reuses the BILL invoice", async () => {
    const { service, client } = setup({ ...baseInvoice, billcomInvoiceId: "00e1" });
    await service.createPaymentLink("inv-1", "user-1", "org-1", returnUrl);
    expect(client.createInvoice).not.toHaveBeenCalled();
    expect(client.getPaymentLink).toHaveBeenCalledTimes(1);
    expect((client.getPaymentLink.mock.calls[0] as unknown[]).slice(0, 3)).toEqual(["00e1", "0cu1", "client@example.com"]);
  });

  test("an invoice BILL already has as paid is marked paid, not charged again", async () => {
    const client = fakeClient({
      getInvoice: mock(() => Promise.resolve({ id: "00e1", customerId: "0cu1", status: "PAID_IN_FULL", totalAmount: 651 })),
    });
    const { service, payments } = setup({ ...baseInvoice, billcomInvoiceId: "00e1" }, client);
    const err = await service.createPaymentLink("inv-1", "user-1", "org-1", returnUrl).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(payments.markInvoicePaid).toHaveBeenCalledWith("inv-1", { paidAmount: 65100 }, "Bill.com");
    expect(client.getPaymentLink).not.toHaveBeenCalled();
  });

  test("BILL errors reach the client as a readable message", async () => {
    const client = fakeClient({
      createInvoice: mock(() => Promise.reject(new BillcomApiError("Invoice number already exists", 400, "BDC_1"))),
    });
    const { service } = setup({ ...baseInvoice }, client);
    const err = await service.createPaymentLink("inv-1", "user-1", "org-1", returnUrl).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain("Invoice number already exists");
  });
});

describe("BillcomService.handleWebhook", () => {
  const body = (status: string) =>
    Buffer.from(JSON.stringify({ metadata: { eventType: "invoice.updated" }, invoice: { id: "00e1", status } }));

  test("marks the invoice paid only after BILL confirms it", async () => {
    const client = fakeClient({
      getInvoice: mock(() => Promise.resolve({ id: "00e1", status: "PAID_IN_FULL", totalAmount: 651 })),
    });
    const { service, payments } = setup({ ...baseInvoice, billcomInvoiceId: "00e1" }, client);
    const raw = body("PAID_IN_FULL");
    const sig = createHmac("sha256", "hook-key").update(raw).digest("base64");
    await service.handleWebhook("org-1", raw, sig);
    expect(client.getInvoice).toHaveBeenCalledWith("00e1");
    expect(payments.markInvoicePaid).toHaveBeenCalledWith("inv-1", { paidAmount: 65100 }, "Bill.com");
  });

  test("a notice that claims paid does nothing while BILL says open", async () => {
    const { service, payments } = setup({ ...baseInvoice, billcomInvoiceId: "00e1" });
    await service.handleWebhook("org-1", body("PAID_IN_FULL"), "forged");
    expect(payments.markInvoicePaid).not.toHaveBeenCalled();
  });

  test("signatures are HMAC-SHA256 in base64", () => {
    const { service } = setup();
    const raw = Buffer.from("{}");
    const good = createHmac("sha256", "k").update(raw).digest("base64");
    expect(service.signatureMatches(raw, good, "k")).toBe(true);
    expect(service.signatureMatches(raw, "bad", "k")).toBe(false);
    expect(service.signatureMatches(raw, undefined, "k")).toBe(false);
  });
});

describe("submittedUrl", () => {
  test("replaces the payment flag so the portal says sent, not paid", () => {
    expect(submittedUrl(returnUrl)).toBe("https://portal.example.com/portal/projects/p-1?payment=submitted");
  });
});

describe("BillcomClient", () => {
  let calls: Array<{ url: string; init?: RequestInit }>;
  beforeEach(() => {
    calls = [];
  });

  test("signs in again once when BILL says the session expired", async () => {
    let invoiceCalls = 0;
    const fetchImpl = (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/v3/login")) {
        return Promise.resolve(new Response(JSON.stringify({ sessionId: `s${calls.length}`, trusted: true })));
      }
      invoiceCalls++;
      if (invoiceCalls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify([{ code: "BDC_1109", message: "Session is invalid.  Please log in." }]), { status: 400 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ id: "00e1", status: "OPEN" })));
    };
    const client = new BillcomClient(
      { username: "u", password: "p", organizationId: "008", devKey: "dk", sandbox: true },
      fetchImpl,
    );
    const inv = await client.getInvoice("00e1");
    expect(inv.status).toBe("OPEN");
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/connect/v3/login",
      "/connect/v3/invoices/00e1",
      "/connect/v3/login",
      "/connect/v3/invoices/00e1",
    ]);
    expect(calls[0].url.startsWith("https://gateway.stage.bill.com")).toBe(true);
    const headers = calls[3].init?.headers as Record<string, string>;
    expect(headers.devKey).toBe("dk");
    expect(headers.sessionId).toBe("s3");
  });

  test("other BILL errors are passed on with their message", async () => {
    const client = new BillcomClient(
      { username: "u", password: "p", organizationId: "008", devKey: "dk", sandbox: false },
      (url) =>
        Promise.resolve(
          url.endsWith("/login")
            ? new Response(JSON.stringify({ sessionId: "s" }))
            : new Response(JSON.stringify([{ code: "BDC_1361", message: "Untrusted session." }]), { status: 403 }),
        ),
    );
    const err = await client.getInvoice("00e1").catch((e) => e);
    expect(err).toBeInstanceOf(BillcomApiError);
    expect((err as BillcomApiError).code).toBe("BDC_1361");
    expect((err as Error).message).toBe("Untrusted session.");
  });
});
