import PDFDocument from "pdfkit";
import type { Quote, Opportunity, Account } from "@workspace/db";

export type QuoteLineItem = {
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent?: number | null;
};

export function lineItemTotal(item: QuoteLineItem): number {
  const gross = item.quantity * item.unitPrice;
  const discount = (item.discountPercent ?? 0) / 100;
  return gross * (1 - discount);
}

export function quoteTotals(
  lineItems: QuoteLineItem[],
  discountPercent: number,
): { subtotal: number; total: number } {
  const subtotal = lineItems.reduce((sum, li) => sum + lineItemTotal(li), 0);
  const total = subtotal * (1 - discountPercent / 100);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

const NAVY = "#0A0E27";
const BLUE = "#00B4D8";
const GRAY = "#5B6178";

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Render a quote as a branded PDF and return it as a Buffer. */
export function renderQuotePdf(args: {
  quote: Quote;
  opportunity: Opportunity;
  account: Account;
  orgName: string;
}): Promise<Buffer> {
  const { quote, opportunity, account, orgName } = args;
  const lineItems = (quote.lineItems ?? []) as QuoteLineItem[];
  const discountPercent = Number(quote.discountPercent ?? 0);
  const { subtotal, total } = quoteTotals(lineItems, discountPercent);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header band
    doc.rect(0, 0, doc.page.width, 110).fill(NAVY);
    doc
      .fillColor("#FFFFFF")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(orgName, 54, 38);
    doc
      .fillColor(BLUE)
      .font("Helvetica")
      .fontSize(11)
      .text(`QUOTE ${quote.quoteNumber}`, 54, 66);

    let y = 140;
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("Prepared for", 54, y);
    doc
      .fillColor(GRAY)
      .font("Helvetica")
      .fontSize(11)
      .text(account.name, 54, y + 16)
      .text(quote.recipientEmail ?? "", 54, y + 32);

    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("Opportunity", 330, y);
    doc
      .fillColor(GRAY)
      .font("Helvetica")
      .fontSize(11)
      .text(opportunity.name, 330, y + 16, { width: 220 })
      .text(
        quote.validUntil ? `Valid until ${quote.validUntil}` : "",
        330,
        y + 32,
      );

    y = 230;
    // Table header
    doc.rect(54, y, doc.page.width - 108, 24).fill(NAVY);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9);
    doc.text("ITEM", 62, y + 8);
    doc.text("QTY", 330, y + 8, { width: 40, align: "right" });
    doc.text("UNIT PRICE", 380, y + 8, { width: 70, align: "right" });
    doc.text("DISC", 455, y + 8, { width: 35, align: "right" });
    doc.text("AMOUNT", 495, y + 8, { width: 63, align: "right" });
    y += 24;

    doc.font("Helvetica").fontSize(10);
    for (const li of lineItems) {
      const rowH = li.description ? 34 : 22;
      doc.fillColor(NAVY).text(li.name, 62, y + 6, { width: 260 });
      if (li.description) {
        doc.fillColor(GRAY).fontSize(8).text(li.description, 62, y + 19, { width: 260 });
        doc.fontSize(10);
      }
      doc.fillColor(NAVY);
      doc.text(String(li.quantity), 330, y + 6, { width: 40, align: "right" });
      doc.text(money(li.unitPrice), 380, y + 6, { width: 70, align: "right" });
      doc.text(
        li.discountPercent ? `${li.discountPercent}%` : "-",
        455,
        y + 6,
        { width: 35, align: "right" },
      );
      doc.text(money(lineItemTotal(li)), 495, y + 6, { width: 63, align: "right" });
      y += rowH;
      doc
        .moveTo(54, y)
        .lineTo(doc.page.width - 54, y)
        .strokeColor("#E2E4EC")
        .lineWidth(0.5)
        .stroke();
    }

    y += 16;
    doc.font("Helvetica").fontSize(10).fillColor(GRAY);
    doc.text("Subtotal", 380, y, { width: 100, align: "right" });
    doc.fillColor(NAVY).text(money(subtotal), 485, y, { width: 73, align: "right" });
    if (discountPercent > 0) {
      y += 16;
      doc.fillColor(GRAY).text(`Discount (${discountPercent}%)`, 380, y, {
        width: 100,
        align: "right",
      });
      doc
        .fillColor(NAVY)
        .text(`-${money(subtotal - total)}`, 485, y, { width: 73, align: "right" });
    }
    y += 20;
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(NAVY)
      .text("Total", 380, y, { width: 100, align: "right" });
    doc.fillColor(BLUE).text(money(total), 485, y, { width: 73, align: "right" });

    if (quote.notes) {
      y += 44;
      doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Notes", 54, y);
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(GRAY)
        .text(quote.notes, 54, y + 14, { width: doc.page.width - 108 });
    }

    doc.end();
  });
}
