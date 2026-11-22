/**
 * Minimal client for the BILL (Bill.com) v3 API, covering only what the portal
 * needs to take invoice payments: sign in, create an invoice, make a hosted
 * payment link, read an invoice back, and subscribe to invoice webhooks.
 *
 * Docs: https://developer.bill.com/docs/home
 *  - POST /v3/login -> { sessionId, organizationId, userId, trusted }; later
 *    calls send `devKey` and `sessionId` headers. Sessions expire after 35
 *    minutes of inactivity (error code BDC_1109).
 *  - Errors come back as an array of { code, message, ... }.
 */

export const BILLCOM_BASE = {
  sandbox: "https://gateway.stage.bill.com",
  production: "https://gateway.prod.bill.com",
} as const;

/** BILL's codes for a session that has expired or is not valid. */
const SESSION_ERROR_CODES = new Set(["BDC_1109"]);

export interface BillcomCredentials {
  username: string;
  password: string;
  organizationId: string;
  devKey: string;
  sandbox: boolean;
}

export interface BillcomInvoice {
  id: string;
  customerId?: string;
  invoiceNumber?: string;
  status?: "PAID_IN_FULL" | "OPEN" | "PARTIAL_PAYMENT" | "SCHEDULED" | "UNDEFINED" | string;
  totalAmount?: number;
  dueAmount?: number;
}

export interface BillcomLineItem {
  quantity: number;
  description: string;
  price: number; // dollars
}

export class BillcomApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BillcomApiError";
  }

  get isSessionError(): boolean {
    return this.status === 401 || (!!this.code && SESSION_ERROR_CODES.has(this.code));
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class BillcomClient {
  private sessionId: string | null = null;

  constructor(
    private readonly creds: BillcomCredentials,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    /** Only for tests (env BILLCOM_API_BASE_URL); real use picks sandbox or production. */
    private readonly baseOverride?: string,
  ) {}

  private get base(): string {
    if (this.baseOverride) return this.baseOverride.replace(/\/+$/, "");
    return this.creds.sandbox ? BILLCOM_BASE.sandbox : BILLCOM_BASE.production;
  }

  async login(): Promise<{ sessionId: string; trusted: boolean }> {
    const res = await this.raw("POST", "/connect/v3/login", {
      username: this.creds.username,
      password: this.creds.password,
      organizationId: this.creds.organizationId,
      devKey: this.creds.devKey,
    }, false);
    const sessionId = (res as { sessionId?: string }).sessionId;
    if (!sessionId) throw new BillcomApiError("Bill.com did not return a session", 502);
    this.sessionId = sessionId;
    return { sessionId, trusted: !!(res as { trusted?: boolean }).trusted };
  }

  createInvoice(body: {
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    customer: { id: string } | { name: string; email: string };
    invoiceLineItems: BillcomLineItem[];
  }): Promise<BillcomInvoice> {
    return this.call("POST", "/connect/v3/invoices", {
      ...body,
      enableCardPayment: true,
      processingOptions: { sendEmail: false },
    }) as Promise<BillcomInvoice>;
  }

  getInvoice(invoiceId: string): Promise<BillcomInvoice> {
    return this.call("GET", `/connect/v3/invoices/${encodeURIComponent(invoiceId)}`) as Promise<BillcomInvoice>;
  }

  async getPaymentLink(invoiceId: string, customerId: string, email: string, returnUrl?: string): Promise<string> {
    const res = (await this.call("POST", `/connect/v3/invoices/${encodeURIComponent(invoiceId)}/payment-link`, {
      customerId,
      email,
      ...(returnUrl ? { returnUrl } : {}),
    })) as { paymentLink?: string };
    if (!res.paymentLink) throw new BillcomApiError("Bill.com did not return a payment link", 502);
    return res.paymentLink;
  }

  async createInvoiceSubscription(notificationUrl: string, idempotencyKey: string) {
    return (await this.call(
      "POST",
      "/connect-events/v3/subscriptions",
      {
        name: "Client portal invoice updates",
        status: { enabled: true },
        events: [{ type: "invoice.updated", version: "1" }],
        notificationUrl,
      },
      { "X-Idempotent-Key": idempotencyKey },
    )) as { id?: string; securityKey?: string };
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    await this.call("DELETE", `/connect-events/v3/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  /** Signed-in call; signs in first, and once more if the session has expired. */
  private async call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<unknown> {
    if (!this.sessionId) await this.login();
    try {
      return await this.raw(method, path, body, true, headers);
    } catch (err) {
      if (err instanceof BillcomApiError && err.isSessionError) {
        await this.login();
        return this.raw(method, path, body, true, headers);
      }
      throw err;
    }
  }

  private async raw(
    method: string,
    path: string,
    body: unknown,
    signedIn: boolean,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (signedIn) {
      headers.devKey = this.creds.devKey;
      headers.sessionId = this.sessionId ?? "";
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new BillcomApiError("Could not reach Bill.com", 502);
    }

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const first = Array.isArray(json) ? (json[0] as { code?: string; message?: string } | undefined) : undefined;
      throw new BillcomApiError(first?.message ?? `Bill.com request failed (${res.status})`, res.status, first?.code);
    }
    return json ?? {};
  }
}

/** Cents to BILL's dollar amounts. */
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** yyyy-MM-dd in UTC, the date format BILL expects. */
export function billDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
