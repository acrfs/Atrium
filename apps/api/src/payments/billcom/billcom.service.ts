import {
  Injectable,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import * as Sentry from "@sentry/nestjs";
import { PrismaService } from "../../prisma/prisma.service";
import { SettingsService } from "../../settings/settings.service";
import { PaymentsService } from "../payments.service";
import { calculateInvoiceTotal } from "../invoice-total";
import { publicApiUrl } from "../../common/helpers/public-api-url";
import {
  BillcomApiError,
  BillcomClient,
  type BillcomCredentials,
  type BillcomLineItem,
  billDate,
  centsToDollars,
} from "./billcom-client";

export interface BillcomConnectInput {
  username: string;
  password: string;
  organizationId: string;
  devKey: string;
  sandbox: boolean;
}

export interface BillcomStatus {
  enabled: boolean;
  sandbox: boolean;
  organizationId: string | null;
  username: string | null;
  webhook: boolean;
}

/** Where BILL sends the client back: the portal says "sent" rather than "paid", as bank payments take days. */
export function submittedUrl(returnUrl: string): string {
  const url = new URL(returnUrl);
  url.searchParams.set("payment", "submitted");
  return url.toString();
}

type ClientFactory = (creds: BillcomCredentials) => BillcomClient;

/**
 * Bill.com invoice payments. When a workspace connects BILL, the portal's Pay
 * button copies the invoice into BILL and sends the client to BILL's hosted
 * payment page (bank or card, no BILL account needed). The invoice is marked
 * paid from BILL's invoice.updated webhook and, as a backup, a poll.
 */
@Injectable()
export class BillcomService {
  private readonly logger = new Logger(BillcomService.name);
  private readonly apiUrl: string;
  /** One client per workspace, so the BILL session is reused between calls. */
  private readonly clients = new Map<string, { key: string; client: BillcomClient }>();
  private clientFactory: ClientFactory;

  private static readonly CLEAR_DATA = {
    billcomEnabled: false,
    billcomSandbox: false,
    billcomUsername: null,
    billcomPassword: null,
    billcomOrganizationId: null,
    billcomDevKey: null,
    billcomSubscriptionId: null,
    billcomWebhookKey: null,
  } as const;

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private payments: PaymentsService,
    config: ConfigService,
  ) {
    this.apiUrl = publicApiUrl(config);
    const baseOverride = config.get<string>("BILLCOM_API_BASE_URL") || undefined;
    this.clientFactory = (creds) => new BillcomClient(creds, undefined, baseOverride);
  }

  /** Test seam. */
  useClientFactory(factory: ClientFactory): void {
    this.clientFactory = factory;
    this.clients.clear();
  }

  webhookUrl(orgId: string): string {
    return `${this.apiUrl}/api/payments/billcom/webhook/${orgId}`;
  }

  async getStatus(orgId: string): Promise<BillcomStatus> {
    const s = await this.prisma.systemSettings.findUnique({ where: { organizationId: orgId } });
    return {
      enabled: !!s?.billcomEnabled,
      sandbox: !!s?.billcomSandbox,
      organizationId: s?.billcomEnabled ? (s.billcomOrganizationId ?? null) : null,
      username: s?.billcomEnabled && s.billcomUsername ? this.settingsService.decrypt(s.billcomUsername) || null : null,
      webhook: !!s?.billcomEnabled && !!s.billcomSubscriptionId,
    };
  }

  async isEnabled(orgId: string): Promise<boolean> {
    const s = await this.prisma.systemSettings.findUnique({
      where: { organizationId: orgId },
      select: { billcomEnabled: true },
    });
    return !!s?.billcomEnabled;
  }

  async connect(orgId: string, input: BillcomConnectInput): Promise<BillcomStatus> {
    const creds: BillcomCredentials = {
      username: input.username.trim(),
      password: input.password,
      organizationId: input.organizationId.trim(),
      devKey: input.devKey.trim(),
      sandbox: input.sandbox,
    };
    const client = this.clientFactory(creds);
    try {
      await client.login();
    } catch (err) {
      const detail = err instanceof BillcomApiError ? ` ${err.message}` : "";
      throw new BadRequestException(`Could not sign in to Bill.com.${detail}`.trim());
    }

    await this.removeSubscription(orgId);

    // Ask BILL to tell us when an invoice changes. Best effort: the poll still
    // marks invoices paid if BILL refuses (for example on an older plan).
    let subscriptionId: string | null = null;
    let webhookKey: string | null = null;
    try {
      const sub = await client.createInvoiceSubscription(this.webhookUrl(orgId), randomUUID());
      subscriptionId = sub.id ?? null;
      webhookKey = sub.securityKey ? this.settingsService.encrypt(sub.securityKey) : null;
    } catch (err) {
      this.logger.warn(`Bill.com webhook subscription failed for org ${orgId}; relying on the poll`, err);
    }

    const data = {
      billcomEnabled: true,
      billcomSandbox: creds.sandbox,
      billcomUsername: this.settingsService.encrypt(creds.username),
      billcomPassword: this.settingsService.encrypt(creds.password),
      billcomOrganizationId: creds.organizationId,
      billcomDevKey: this.settingsService.encrypt(creds.devKey),
      billcomSubscriptionId: subscriptionId,
      billcomWebhookKey: webhookKey,
    };
    await this.prisma.systemSettings.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...data },
      update: data,
    });
    this.clients.set(orgId, { key: this.credsKey(creds), client });
    this.logger.log(`Connected Bill.com for org ${orgId} (sandbox: ${creds.sandbox})`);
    return this.getStatus(orgId);
  }

  async disconnect(orgId: string): Promise<void> {
    const s = await this.prisma.systemSettings.findUnique({ where: { organizationId: orgId } });
    if (!s?.billcomEnabled) throw new BadRequestException("Bill.com is not connected");
    await this.removeSubscription(orgId);
    await this.prisma.systemSettings.update({
      where: { organizationId: orgId },
      data: BillcomService.CLEAR_DATA,
    });
    this.clients.delete(orgId);
    this.logger.log(`Disconnected Bill.com for org ${orgId}`);
  }

  /**
   * The BILL payment page for an invoice, creating the invoice in BILL the
   * first time a client asks to pay it.
   */
  async createPaymentLink(invoiceId: string, userId: string, orgId: string, returnUrl: string) {
    this.payments.checkAppUrl(returnUrl);
    const invoice = await this.payments.findPayableInvoice(invoiceId, userId, orgId);
    const client = await this.clientFor(orgId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!user?.email) throw new BadRequestException("Your account has no email address");
    const email = user.email.toLowerCase();

    try {
      let billInvoiceId = invoice.billcomInvoiceId;
      let billCustomerId: string | undefined;

      if (billInvoiceId) {
        const existing = await client.getInvoice(billInvoiceId);
        if (existing.status === "PAID_IN_FULL") {
          await this.recordPaid(invoice.id, existing.totalAmount);
          throw new BadRequestException("This invoice has already been paid");
        }
        billCustomerId = existing.customerId;
      }

      if (!billInvoiceId) {
        const known = await this.prisma.billcomCustomer.findUnique({
          where: { organizationId_email: { organizationId: orgId, email } },
        });
        const today = new Date();
        const due = invoice.dueDate ?? today;
        const created = await client.createInvoice({
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: billDate(invoice.createdAt < due ? invoice.createdAt : due),
          dueDate: billDate(due),
          customer: known
            ? { id: known.billcomCustomerId }
            : { name: (user.name || email).slice(0, 100), email },
          invoiceLineItems: this.lineItemsFor(invoice),
        });
        billInvoiceId = created.id;
        billCustomerId = created.customerId ?? known?.billcomCustomerId;

        // Only record it if no concurrent request got there first.
        const { count } = await this.prisma.invoice.updateMany({
          where: { id: invoice.id, billcomInvoiceId: null },
          data: { billcomInvoiceId: billInvoiceId },
        });
        if (count === 0) {
          const fresh = await this.prisma.invoice.findUnique({
            where: { id: invoice.id },
            select: { billcomInvoiceId: true },
          });
          if (fresh?.billcomInvoiceId) billInvoiceId = fresh.billcomInvoiceId;
        }
        if (!known && billCustomerId) {
          await this.prisma.billcomCustomer.upsert({
            where: { organizationId_email: { organizationId: orgId, email } },
            create: { organizationId: orgId, email, billcomCustomerId: billCustomerId },
            update: {},
          });
        }
      }

      if (!billInvoiceId || !billCustomerId) {
        throw new BadRequestException("Bill.com did not return the invoice. Please try again.");
      }

      const url = await client.getPaymentLink(billInvoiceId, billCustomerId, email, submittedUrl(returnUrl));
      return { url };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      Sentry.captureException(err);
      this.logger.error(`Bill.com payment link failed for invoice ${invoice.id}`, err);
      const detail = err instanceof BillcomApiError ? ` ${err.message}` : "";
      throw new BadRequestException(`Bill.com could not start the payment.${detail}`.trim());
    }
  }

  /**
   * BILL's webhook only tells us which invoice changed. Its signature is
   * checked, but the paid status always comes from reading the invoice back
   * from BILL, so a forged notice cannot mark anything paid.
   */
  async handleWebhook(orgId: string, rawBody: Buffer | undefined, signature: string | undefined) {
    const s = await this.prisma.systemSettings.findUnique({ where: { organizationId: orgId } });
    if (!s?.billcomEnabled) throw new BadRequestException("Bill.com is not connected for this workspace");

    if (s.billcomWebhookKey && rawBody) {
      const key = this.settingsService.decrypt(s.billcomWebhookKey);
      if (key && !this.signatureMatches(rawBody, signature, key)) {
        this.logger.warn(`Bill.com webhook signature did not match for org ${orgId}; re-checking with BILL`);
      }
    }

    let billInvoiceId: string | undefined;
    try {
      const body = JSON.parse(rawBody?.toString("utf8") ?? "{}") as { invoice?: { id?: string } };
      billInvoiceId = body.invoice?.id;
    } catch {
      throw new BadRequestException("Invalid webhook body");
    }
    if (!billInvoiceId) return { received: true };

    const invoice = await this.prisma.invoice.findFirst({
      where: { organizationId: orgId, billcomInvoiceId: billInvoiceId },
      select: { id: true, status: true, billcomInvoiceId: true },
    });
    if (invoice && invoice.status !== "paid") await this.syncInvoice(orgId, invoice.id, billInvoiceId);
    return { received: true };
  }

  /** Read one invoice from BILL and mark ours paid when BILL says it is. */
  async syncInvoice(orgId: string, invoiceId: string, billInvoiceId: string): Promise<boolean> {
    const client = await this.clientFor(orgId);
    const bill = await client.getInvoice(billInvoiceId);
    if (bill.status !== "PAID_IN_FULL") return false;
    return this.recordPaid(invoiceId, bill.totalAmount);
  }

  /** Backup for missed webhooks: re-check every unpaid invoice that has a BILL copy. */
  async pollUnpaid(): Promise<number> {
    const invoices = await this.prisma.invoice.findMany({
      where: { billcomInvoiceId: { not: null }, status: { in: ["sent", "overdue"] } },
      select: { id: true, organizationId: true, billcomInvoiceId: true },
      take: 500,
    });
    let paid = 0;
    const enabled = new Map<string, boolean>();
    for (const inv of invoices) {
      if (!enabled.has(inv.organizationId)) enabled.set(inv.organizationId, await this.isEnabled(inv.organizationId));
      if (!enabled.get(inv.organizationId)) continue;
      try {
        if (await this.syncInvoice(inv.organizationId, inv.id, inv.billcomInvoiceId!)) paid++;
      } catch (err) {
        this.logger.warn(`Bill.com check failed for invoice ${inv.id}`, err);
      }
    }
    return paid;
  }

  lineItemsFor(invoice: {
    type: string;
    invoiceNumber: string;
    amount?: number | null;
    lineItems: Array<{ description: string; quantity: number; unitPrice: number }>;
  }): BillcomLineItem[] {
    const totalCents = calculateInvoiceTotal(invoice);
    if (totalCents <= 0) throw new BadRequestException("Invoice total must be greater than zero");
    if (invoice.type === "uploaded" || invoice.lineItems.length === 0) {
      return [{ quantity: 1, description: `Invoice ${invoice.invoiceNumber}`, price: centsToDollars(totalCents) }];
    }
    return invoice.lineItems.map((li) => ({
      quantity: li.quantity,
      description: li.description.slice(0, 4000),
      price: centsToDollars(li.unitPrice),
    }));
  }

  signatureMatches(rawBody: Buffer, signature: string | undefined, key: string): boolean {
    if (!signature) return false;
    const expected = createHmac("sha256", key).update(rawBody).digest("base64");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async recordPaid(invoiceId: string, totalDollars: number | undefined): Promise<boolean> {
    let paidAmount = totalDollars != null ? Math.round(totalDollars * 100) : undefined;
    if (paidAmount == null) {
      const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true } });
      paidAmount = inv ? calculateInvoiceTotal(inv) : 0;
    }
    return this.payments.markInvoicePaid(invoiceId, { paidAmount }, "Bill.com");
  }

  private async removeSubscription(orgId: string): Promise<void> {
    const s = await this.prisma.systemSettings.findUnique({ where: { organizationId: orgId } });
    if (!s?.billcomEnabled || !s.billcomSubscriptionId) return;
    try {
      const client = await this.clientFor(orgId);
      await client.deleteSubscription(s.billcomSubscriptionId);
    } catch (err) {
      this.logger.warn(`Could not remove the Bill.com webhook subscription for org ${orgId}`, err);
    }
  }

  private credsKey(c: BillcomCredentials): string {
    return createHmac("sha256", "billcom-client").update(JSON.stringify(c)).digest("hex");
  }

  private async clientFor(orgId: string): Promise<BillcomClient> {
    const s = await this.prisma.systemSettings.findUnique({ where: { organizationId: orgId } });
    if (!s?.billcomEnabled || !s.billcomUsername || !s.billcomPassword || !s.billcomDevKey || !s.billcomOrganizationId) {
      throw new BadRequestException("Bill.com is not connected");
    }
    const creds: BillcomCredentials = {
      username: this.settingsService.decrypt(s.billcomUsername),
      password: this.settingsService.decrypt(s.billcomPassword),
      devKey: this.settingsService.decrypt(s.billcomDevKey),
      organizationId: s.billcomOrganizationId,
      sandbox: s.billcomSandbox,
    };
    if (!creds.username || !creds.password || !creds.devKey) {
      throw new BadRequestException("Failed to read the saved Bill.com sign-in. Connect Bill.com again in Settings.");
    }
    const key = this.credsKey(creds);
    const cached = this.clients.get(orgId);
    if (cached && cached.key === key) return cached.client;
    const client = this.clientFactory(creds);
    this.clients.set(orgId, { key, client });
    return client;
  }
}
