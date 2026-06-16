import PDFDocument from 'pdfkit';

/**
 * PDF generation (module 2.4/2.5) — pdfkit over puppeteer: pure-JS, no
 * headless Chromium to install/patch in the API container, deterministic
 * output, tiny memory footprint; our letters/invoices are simple flow layouts
 * that don't need an HTML engine.
 * Brand tokens from docs/design-system.md.
 */

const BLUE = '#1A73E8';
const DARK = '#202124';
const GREY = '#5F6368';
const BORDER = '#DADCE0';

function buildDoc(): { doc: PDFKit.PDFDocument; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', margin: 56 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, done };
}

function header(doc: PDFKit.PDFDocument, title: string): void {
  doc.rect(0, 0, doc.page.width, 8).fill(BLUE);
  doc.moveDown(1);
  doc.fillColor(BLUE).fontSize(20).font('Helvetica-Bold').text('GUM Internships', 56, 40);
  doc.fillColor(GREY).fontSize(9).font('Helvetica').text('gum-internships.example.com', 56, 64);
  doc
    .fillColor(DARK)
    .fontSize(16)
    .font('Helvetica-Bold')
    .text(title, 56, 40, { align: 'right' });
  doc.moveTo(56, 92).lineTo(doc.page.width - 56, 92).strokeColor(BORDER).stroke();
  doc.y = 110;
}

export interface OfferLetterData {
  refNo: string;
  studentName: string;
  internshipTitle: string;
  instructorName: string;
  batchName: string | null;
  startDate: string | null;
  endDate: string | null;
  durationWeeks: number | null;
  issuedOn: string;
}

export async function generateOfferLetterPdf(d: OfferLetterData): Promise<Buffer> {
  const { doc, done } = buildDoc();
  header(doc, 'Internship Offer Letter');

  doc.fillColor(GREY).fontSize(10).text(`Ref: ${d.refNo}`, { continued: true });
  doc.text(`Issued: ${d.issuedOn}`, { align: 'right' });
  doc.moveDown(2);

  doc.fillColor(DARK).fontSize(11).font('Helvetica');
  doc.text(`Dear ${d.studentName},`);
  doc.moveDown(1);
  doc.text(
    `Congratulations! You have been offered a place in the following internship program with GUM Internships. This letter confirms your enrollment and the program schedule below.`,
    { lineGap: 3 },
  );
  doc.moveDown(1.5);

  const rows: [string, string][] = [
    ['Internship', d.internshipTitle],
    ['Mentor', d.instructorName],
    ['Cohort', d.batchName ?? 'Self-paced'],
    ['Start date', d.startDate ?? '—'],
    ['End date', d.endDate ?? '—'],
    ['Duration', d.durationWeeks ? `${d.durationWeeks} weeks` : '—'],
  ];
  const x = 56;
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.rect(x, y - 4, doc.page.width - 112, 24).strokeColor(BORDER).stroke();
    doc.fillColor(GREY).fontSize(9).font('Helvetica-Bold').text(label.toUpperCase(), x + 10, y + 2, { width: 130 });
    doc.fillColor(DARK).fontSize(11).font('Helvetica').text(value, x + 150, y, { width: 350 });
    doc.y = y + 24;
  }

  doc.moveDown(1.5);
  doc
    .fillColor(DARK)
    .fontSize(11)
    .text(
      'Complete your weekly project tasks and meet the certificate criteria to earn your verifiable completion certificate. We are excited to have you on board.',
      { lineGap: 3 },
    );
  doc.moveDown(2);
  doc.text('Warm regards,');
  doc.font('Helvetica-Bold').text('Team GUM Internships');
  doc
    .fillColor(GREY)
    .fontSize(8)
    .font('Helvetica')
    .text(
      `This is a system-generated letter. Verify authenticity by quoting ref ${d.refNo} to support.`,
      56,
      doc.page.height - 80,
    );
  doc.end();
  return done;
}

export interface InvoiceData {
  invoiceNo: string;
  invoiceDate: string;
  orderNo: string;
  billing: { name: string; email: string | null; phone: string | null; state: string; gstin: string | null };
  seller: { name: string; state: string; gstin: string };
  lineDescription: string;
  subtotal: string;
  discount: string;
  taxable: string;
  gstRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
}

export async function generateInvoicePdf(d: InvoiceData): Promise<Buffer> {
  const { doc, done } = buildDoc();
  header(doc, 'Tax Invoice');

  doc.fillColor(GREY).fontSize(10);
  doc.text(`Invoice no: ${d.invoiceNo}`);
  doc.text(`Invoice date: ${d.invoiceDate}`);
  doc.text(`Order no: ${d.orderNo}`);
  doc.moveDown(1);

  const colW = (doc.page.width - 112) / 2;
  const yStart = doc.y;
  doc.fillColor(DARK).fontSize(10).font('Helvetica-Bold').text('Sold by', 56, yStart);
  doc.font('Helvetica').fillColor(GREY).fontSize(9);
  doc.text(d.seller.name, 56);
  doc.text(`State: ${d.seller.state}`, 56);
  doc.text(`GSTIN: ${d.seller.gstin}`, 56);
  doc.fillColor(DARK).fontSize(10).font('Helvetica-Bold').text('Billed to', 56 + colW, yStart);
  doc.font('Helvetica').fillColor(GREY).fontSize(9);
  doc.text(d.billing.name, 56 + colW);
  if (d.billing.email) doc.text(d.billing.email, 56 + colW);
  doc.text(`Place of supply: ${d.billing.state}`, 56 + colW);
  if (d.billing.gstin) doc.text(`GSTIN: ${d.billing.gstin}`, 56 + colW);
  doc.moveDown(2);

  const x = 56;
  const w = doc.page.width - 112;
  let y = doc.y;
  doc.rect(x, y, w, 22).fill('#E8F0FE');
  doc.fillColor('#1967D2').fontSize(9).font('Helvetica-Bold');
  doc.text('DESCRIPTION', x + 10, y + 7, { width: w - 160 });
  doc.text('AMOUNT (₹)', x + w - 140, y + 7, { width: 130, align: 'right' });
  y += 22;

  const line = (label: string, value: string, bold = false): void => {
    doc.rect(x, y, w, 20).strokeColor(BORDER).stroke();
    doc
      .fillColor(bold ? DARK : GREY)
      .fontSize(9)
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .text(label, x + 10, y + 6, { width: w - 160 });
    doc.text(value, x + w - 140, y + 6, { width: 130, align: 'right' });
    y += 20;
  };

  line(d.lineDescription, d.subtotal);
  line('Discount', `− ${d.discount}`);
  line('Taxable value', d.taxable, true);
  if (Number(d.igst) > 0) {
    line(`IGST @ ${d.gstRate}%`, d.igst);
  } else {
    line(`CGST @ ${Number(d.gstRate) / 2}%`, d.cgst);
    line(`SGST @ ${Number(d.gstRate) / 2}%`, d.sgst);
  }
  line('Total', d.total, true);

  doc.y = y + 24;
  doc
    .fillColor(GREY)
    .fontSize(8)
    .text(
      'Computer-generated tax invoice; no signature required. Services: online education/training (SAC 9992).',
      56,
    );
  doc.end();
  return done;
}
