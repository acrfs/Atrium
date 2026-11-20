import { existsSync } from "fs";
import { join } from "path";

/**
 * Letterhead invoice layout.
 *
 * When INVOICE_ASSETS_DIR points at a folder containing `letterhead.png`
 * (a full US Letter page, drawn behind every page), invoices are rendered with
 * this layout instead of the default one. The folder may also hold
 * `font-light`, `font-regular`, `font-medium` and `font-bold` files
 * (.ttf, .otf or .woff); any that are missing fall back to Helvetica.
 *
 * Positions are in PDF points on a 612 x 792 page and follow the studio's own
 * invoice design: header artwork lives in the letterhead image, and everything
 * from the "INVOICE" title down is drawn here.
 */

export interface LetterheadAssets {
  letterhead: string;
  fonts: { light: string; regular: string; medium: string; bold: string };
}

export interface LetterheadLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface LetterheadInvoice {
  invoiceNumber: string;
  status: string;
  createdAt: Date;
  dueDate: Date | null;
  notes: string | null;
  projectName: string | null;
  issuedTo: string | null;
  lineItems: LetterheadLineItem[];
}

export interface LetterheadOptions {
  orgName: string;
  headingColor: string;
  textColor: string;
  barColor: string;
  paymentInfo: string | null;
  money: (cents: number) => string;
}

const FONT_EXTENSIONS: string[] = [".ttf", ".otf", ".woff"];

function findFont(dir: string, name: string, fallback: string): string {
  for (const ext of FONT_EXTENSIONS) {
    const candidate = join(dir, `${name}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return fallback;
}

/** Returns the letterhead assets, or null when the feature is not configured. */
export function resolveLetterheadAssets(dir: string | undefined): LetterheadAssets | null {
  const trimmed = dir?.trim();
  if (!trimmed) return null;
  const letterhead = join(trimmed, "letterhead.png");
  if (!existsSync(letterhead)) return null;
  return {
    letterhead,
    fonts: {
      light: findFont(trimmed, "font-light", "Helvetica"),
      regular: findFont(trimmed, "font-regular", "Helvetica"),
      medium: findFont(trimmed, "font-medium", "Helvetica-Bold"),
      bold: findFont(trimmed, "font-bold", "Helvetica-Bold"),
    },
  };
}

const LEFT = 47.7;
const RIGHT = 543.3;
const WIDTH = RIGHT - LEFT;
const FIRST_PAGE_TOP = 204;
const NEXT_PAGE_TOP = 204;
const ROWS_BOTTOM = 690; // keep rows clear of the artwork at the foot of the page
const FOOTER_TOP = 640; // "PAYMENT INFORMATION" block is pinned here on the last page
const AMOUNT_COL = 110;

function longDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function renderLetterheadInvoice(
  doc: PDFKit.PDFDocument,
  assets: LetterheadAssets,
  invoice: LetterheadInvoice,
  opts: LetterheadOptions,
): void {
  const { fonts } = assets;
  const { headingColor, textColor, barColor, money } = opts;

  const drawLetterhead = (): void => {
    doc.image(assets.letterhead, 0, 0, { width: doc.page.width, height: doc.page.height });
  };
  drawLetterhead();
  doc.on("pageAdded", drawLetterhead);

  const rule = (y: number): void => {
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(textColor).lineWidth(1).stroke();
  };
  const newPage = (): number => {
    doc.addPage();
    return NEXT_PAGE_TOP;
  };

  // Title
  doc.font(fonts.regular).fontSize(37.6).fillColor(headingColor).text("INVOICE", LEFT - 1.5, FIRST_PAGE_TOP, { lineBreak: false });

  // Invoice number, date and due date. Left-aligned as a block that ends at the right margin.
  const meta: string[] = [
    `Invoice #: ${invoice.invoiceNumber}`,
    `Date: ${longDate(invoice.createdAt)}`,
    `Due: ${invoice.dueDate ? longDate(invoice.dueDate) : "Upon Receipt"}`,
  ];
  doc.font(fonts.regular).fontSize(10);
  const metaWidth: number = Math.max(...meta.map((line) => doc.widthOfString(line)));
  const metaX: number = Math.min(428.5, RIGHT - metaWidth);
  doc.fillColor(textColor);
  meta.forEach((line, i) => doc.text(line, metaX, 268 + i * 14, { lineBreak: false }));

  // Issued to
  const issuedWidth: number = metaX - LEFT - 20;
  doc.font(fonts.regular).fontSize(10.9).fillColor(textColor).text("ISSUED TO", LEFT, 265.5, { lineBreak: false });
  let y = 284.5;
  const issuedLines: string[] = [invoice.issuedTo, invoice.projectName].filter((v): v is string => !!v);
  for (const line of issuedLines) {
    doc.text(line, LEFT, y, { width: issuedWidth });
    y = doc.y + 3;
  }

  // Table header
  y = Math.max(347, y + 20);
  doc.font(fonts.medium).fontSize(11).fillColor(textColor);
  doc.text("DESCRIPTION", LEFT + 1, y, { lineBreak: false });
  doc.text("AMOUNT", RIGHT - AMOUNT_COL, y, { width: AMOUNT_COL - 1, align: "right" });
  rule(y + 18.2);
  y += 31;

  // Line items
  const descWidth: number = WIDTH - AMOUNT_COL - 20;
  let total = 0;
  for (const item of invoice.lineItems) {
    const lineTotal: number = item.quantity * item.unitPrice;
    total += lineTotal;
    const detail: string | null = item.quantity !== 1 ? `${item.quantity} x ${money(item.unitPrice)}` : null;

    doc.font(fonts.medium).fontSize(11);
    const rowHeight: number = doc.heightOfString(item.description, { width: descWidth }) + (detail ? 10 : 0);
    if (y + rowHeight > ROWS_BOTTOM) y = newPage();

    doc.font(fonts.medium).fontSize(11).fillColor(textColor);
    doc.text(money(lineTotal), RIGHT - AMOUNT_COL, y, { width: AMOUNT_COL - 1, align: "right" });
    doc.text(item.description, LEFT, y, { width: descWidth });
    y = doc.y;
    if (detail) {
      doc.fontSize(7.5).text(detail, LEFT, y + 1, { lineBreak: false });
      y += 10;
    }
    y += 10;
  }

  // Totals. Rule, total row, highlighted amount bar and notes stay together on one page.
  doc.font(fonts.regular).fontSize(10);
  const notesHeight: number = invoice.notes ? doc.heightOfString(invoice.notes, { width: WIDTH }) + 6 : 0;
  if (y + 82 + notesHeight > ROWS_BOTTOM) y = newPage();

  rule(y);
  doc.font(fonts.medium).fontSize(11).fillColor(textColor);
  doc.text(invoice.projectName ? "PROJECT TOTAL" : "TOTAL", LEFT + 2, y + 9.4, { lineBreak: false });
  doc.text(money(total), RIGHT - AMOUNT_COL, y + 9.4, { width: AMOUNT_COL - 1, align: "right" });

  const barTop: number = y + 37.7;
  doc.rect(LEFT - 1.2, barTop, WIDTH + 2.4, 41).fill(barColor);
  doc.font(fonts.medium).fontSize(16.8).fillColor(headingColor);
  doc.text(invoice.status === "paid" ? "Paid in Full" : "Amount Due", LEFT + 6, barTop + 10, { lineBreak: false });
  doc.font(fonts.bold).text(money(total), RIGHT - 200, barTop + 10, { width: 187.5, align: "right" });
  y = barTop + 41;

  if (invoice.notes) {
    doc.font(fonts.regular).fontSize(10).fillColor(textColor).text(invoice.notes, LEFT, y + 5, { width: WIDTH });
    y = doc.y;
  }

  // Footer, pinned near the foot of the last page.
  if (y > FOOTER_TOP - 10) newPage();
  if (opts.paymentInfo) {
    doc.font(fonts.medium).fontSize(12.6).fillColor(headingColor).text("PAYMENT INFORMATION", LEFT, FOOTER_TOP, { lineBreak: false });
    doc.fontSize(10.6).fillColor(textColor).text(opts.paymentInfo, LEFT + 1.5, FOOTER_TOP + 24, { width: WIDTH, height: 14, ellipsis: true });
  }
  rule(686.9);
  doc.font(fonts.light).fontSize(11).fillColor(textColor);
  doc.text(`Thank you for working with ${opts.orgName}!`, LEFT + 0.7, 702, { lineBreak: false });
}
