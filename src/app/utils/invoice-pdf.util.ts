import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export interface InvoiceStudentInfo {
  name?: string;
  email?: string;
  level?: string;
  batch?: string;
  studentStatus?: string;
  subscription?: string;
  phoneNumber?: string;
  address?: string;
  servicesOpted?: string;
  regNo?: string;
}

export interface InvoiceSubmission {
  _id: string;
  paymentMethod?: string;
  paidAmount: number;
  currency: string;
  status: string;
  submittedAt: string;
  approvedAt?: string;
  transactionId?: string;
  rejectionReason?: string;
  reuploadNote?: string;
  adminRemarks?: string;
}

export interface InvoiceInstallment {
  installmentNumber: number;
  currency: string;
  requestedAmount: number;
  status: string;
  dueDate: string;
  paidAmount?: number;
  remainingAmount?: number;
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  statusColor: string;
  requestId: string;
  source?: string;
  isImported?: boolean;
  studentInfo: InvoiceStudentInfo;
  paymentType: string;
  customType?: string;
  currency: string;
  totalAmount: number;
  /** Line-item amount shown in Description / Rate / Amount / totals (defaults to totalAmount). */
  lineAmount?: number;
  /** Explicit description for the single invoice line item. */
  lineDescription?: string;
  paidAmount: number;
  amountRemaining: number;
  percentPaid: number;
  progressColor: string;
  balanceColor: string;
  dueDate: string;
  dueDateColor: string;
  isOverdue: boolean;
  paymentDate?: string;
  installmentAllowed: boolean;
  totalInstallments?: number;
  activeInstallmentNumber?: number;
  remarks?: string;
  submission?: InvoiceSubmission;
  installments?: InvoiceInstallment[];
}

/** A4 portrait dimensions for PDF rendering */
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const A4_MARGIN_MM = 10;
const MM_TO_PX = 96 / 25.4;
const A4_WIDTH_PX = Math.round(A4_WIDTH_MM * MM_TO_PX);

const fmt = (val: number | undefined | null): string => {
  if (val === undefined || val === null) return "0";
  return val.toLocaleString("en-IN");
};

const fmtDate = (d: string | undefined | null): string => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

function renderBankDetailsBlock(currency: string): string {
  const isInr = String(currency ?? "").trim().toUpperCase() === "INR";
  if (isInr) {
    return `
    <div class="bank-grid">
      <div class="bank-item"><strong>Account Name:</strong> GLUCK GLOBAL PRIVATE LIMITED</div>
      <div class="bank-item"><strong>Account No:</strong> 0021001010654</div>
      <div class="bank-item"><strong>Bank Name:</strong> Cosmos Co-operative Bank Ltd</div>
      <div class="bank-item"><strong>IFSC:</strong> COSB0000002</div>
      <div class="bank-item"><strong>Branch:</strong> Khadki</div>
      <div class="bank-item"><strong>Account Currency:</strong> Indian Rupee (INR)</div>
    </div>`;
  }
  return `
    <div class="bank-grid">
      <div class="bank-item"><strong>Beneficiary Name:</strong> Glück Global Pvt Ltd</div>
      <div class="bank-item"><strong>Account Number:</strong> 115511485187</div>
      <div class="bank-item"><strong>Bank Name:</strong> National Development Bank PLC</div>
      <div class="bank-item"><strong>Bank Address:</strong> No 133, Kotugodella Street, Kandy</div>
      <div class="bank-item"><strong>Bank Code:</strong> 7214</div>
      <div class="bank-item"><strong>Branch Code:</strong> 002</div>
      <div class="bank-item"><strong>SWIFT Code:</strong> NDBSLKLX</div>
      <div class="bank-item"><strong>Account Currency:</strong> Sri Lankan Rupee (LKR)</div>
    </div>`;
}

/** Stable GGP_INV### number from a payment request id (matches legacy proforma format). */
export function formatProformaNumber(requestId: string): string {
  const n = (parseInt(requestId.slice(-4), 16) % 900) + 100;
  return `GGP_INV${n}`;
}

let cachedLogoDataUrl: string | null = null;

/** Load the Glück ü logo with black background removed for white invoice pages. */
export async function loadInvoiceLogoDataUrl(): Promise<string> {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = `${window.location.origin}/assets/gluck-logo.png`;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Logo failed to load"));
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] < 40 && pixels[i + 1] < 40 && pixels[i + 2] < 40) {
      pixels[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  cachedLogoDataUrl = canvas.toDataURL("image/png");
  return cachedLogoDataUrl;
}

function renderGluckLogoSvg(): string {
  return `<svg viewBox="0 0 80 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="56" height="45" aria-hidden="true">
    <circle cx="22" cy="13" r="9" fill="#F5C800"/>
    <circle cx="58" cy="13" r="9" fill="#F5C800"/>
    <path d="M14 26 C14 54 26 56 40 56 C54 56 66 54 66 26" stroke="#F5C800" stroke-width="16" fill="none" stroke-linecap="round"/>
  </svg>`;
}

export function renderInvoiceHTML(data: InvoiceData, logoDataUrl?: string): string {
  const formatAmount = (amount: number, currency: string) =>
    `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB"); // DD/MM/YYYY
  };

  const si = data.studentInfo;
  const lineAmount = data.lineAmount ?? data.totalAmount;

  /* ── Description line ── */
  const descriptionParts = [
    si.servicesOpted ?? "German Language",
    si.level ? si.level : null,
    data.installmentAllowed && data.activeInstallmentNumber != null
      ? `(Instalment number: ${data.activeInstallmentNumber})`
      : null,
  ].filter(Boolean);
  const description = data.lineDescription ?? descriptionParts.join(" ");

  /* ── Tax (always 0 for now) ── */
  const tax = 0;

  const lineItemRow = `<tr>
    <td>${description}</td>
    <td>1</td>
    <td>${formatAmount(lineAmount, data.currency)}</td>
    <td>${formatAmount(lineAmount, data.currency)}</td>
  </tr>`;

  const planLabel = si.subscription
    ? si.subscription.charAt(0).toUpperCase() + si.subscription.slice(1).toLowerCase()
    : "";

  const logoMarkup = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="Glück Global" class="logo-img" />`
    : `<div class="logo-fallback">${renderGluckLogoSvg()}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${A4_WIDTH_PX}, initial-scale=1.0"/>
  <title>Proforma Invoice – ${data.invoiceNumber}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    @page { size: A4 portrait; margin: 0; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: ${A4_WIDTH_MM}mm;
      max-width: ${A4_WIDTH_MM}mm;
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    body {
      font-family: 'Inter', Arial, Helvetica, sans-serif;
      color: #1a1a1a;
      -webkit-font-smoothing: antialiased;
    }

    .page {
      width: ${A4_WIDTH_MM}mm;
      min-height: ${A4_HEIGHT_MM}mm;
      padding: 10mm;
      background: #ffffff;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 14px;
    }
    .logo {
      flex: 0 0 auto;
      display: flex;
      align-items: flex-start;
    }
    .logo-img {
      display: block;
      width: 54px;
      height: auto;
      object-fit: contain;
    }
    .logo-fallback svg { display: block; }

    .company-info {
      flex: 1;
      text-align: right;
      font-size: 14px;
      line-height: 1.65;
      color: #333;
    }
    .company-info .company-name {
      font-weight: 700;
      font-size: 16px;
      color: #111;
      margin-bottom: 2px;
    }

    .title-block h1 {
      font-size: 26px;
      font-weight: 650;
      letter-spacing: 0.03em;
      color: #111;
      text-transform: uppercase;
      margin-bottom: 3px;
      line-height: 1.1;
    }
    .title-block .subtitle { font-size: 12px; color: #777; }

    hr.divider { border: none; border-top: 1px solid #d8d8d8; margin-top: 6px; margin-bottom: 20px; }

    .bill-meta {
      margin-top: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-bottom: 14px;
    }
    .bill-to {
      flex: 1;
      min-width: 0;
    }
    .bill-to h3 {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 6px;
      color: #111;
    }
    .bill-to p {
      font-size: 13px;
      line-height: 1.5;
      color: #333;
    }

    .invoice-meta {
      flex: 0 0 46%;
      max-width: 280px;
      margin-left: auto;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      font-size: 13px;
      line-height: 1.6;
      color: #333;
    }
    .meta-row .label {
      font-weight: 600;
      color: #111;
      white-space: nowrap;
    }
    .meta-row .value {
      text-align: right;
      flex: 1;
    }

    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 6px;
      table-layout: fixed;
    }
    .items-table thead tr {
      border-top: 1.5px solid #222;
      border-bottom: 1.5px solid #222;
    }
    .items-table thead th {
      font-size: 13px;
      font-weight: 700;
      padding: 7px 6px;
      text-align: left;
      color: #111;
    }
    .items-table thead th:nth-child(1) { width: 46%; }
    .items-table thead th:nth-child(2) { width: 12%; text-align: center; }
    .items-table thead th:nth-child(3),
    .items-table thead th:nth-child(4) { width: 21%; text-align: right; }
    .items-table tbody tr { border-bottom: 1px solid #e8e8e8; }
    .items-table tbody td {
      font-size: 13px;
      padding: 8px 6px;
      vertical-align: top;
      color: #222;
      word-wrap: break-word;
    }
    .items-table tbody td:nth-child(2) { text-align: center; }
    .items-table tbody td:nth-child(3),
    .items-table tbody td:nth-child(4) { text-align: right; white-space: nowrap; }

    .totals {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 12px;
    }
    .totals-block { width: 250px; }
    .total-row {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      padding: 4px 6px;
      color: #333;
    }
    .total-row.grand {
      border-top: 1.5px solid #222;
      margin-top: 4px;
      padding-top: 8px;
      font-weight: 700;
      font-size: 15px;
      color: #111;
    }

    .section { margin-bottom: 20px; }
    .section h3 {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 5px;
      color: #111;
    }
    .bank-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px 28px;
    }
    .bank-item {
      font-size: 12px;
      line-height: 1.55;
      color: #333;
    }
    .bank-item strong { font-weight: 600; color: #111; }

    .info-list {
      list-style: none;
      padding: 0;
      counter-reset: item;
    }
    .info-list li {
      font-size: 12px;
      color: #444;
      line-height: 1.5;
      padding-left: 16px;
      position: relative;
      counter-increment: item;
      margin-bottom: 1px;
    }
    .info-list li::before {
      content: counter(item) ".";
      position: absolute;
      left: 0;
      font-weight: 500;
    }

    .note-text {
      font-size: 12px;
      color: #444;
      line-height: 1.5;
    }

    .footer {
      margin-top: auto;
      text-align: center;
      border-top: 1px solid #e8e8e8;
      padding-top: 10px;
    }
    .footer p { font-size: 12px; color: #888; line-height: 1.5; }
    .footer .thank-you {
      font-size: 13px;
      color: #555;
      font-weight: 500;
      margin-bottom: 2px;
    }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="logo">${logoMarkup}</div>
    <div class="company-info">
      <div class="company-name">Glück Global Pvt Ltd</div>
      <div>450/73, Srimavo Bandaranayaka Mawatha,</div>
      <div>Peradeniya Road, Kandy</div>
      <div>info@gluckglobal.com</div>
      <div>www.gluckglobal.com</div>
      <div>Phone: +94 70 304 5656 / +94 70 148 5656</div>
    </div>
  </div>

  <div class="title-block">
    <h1>Proforma Invoice</h1>
    <p class="subtitle">This is not a tax invoice. For advance payment purposes only.</p>
  </div>

  <hr class="divider"/>

  <div class="bill-meta">
    <div class="bill-to">
      <h3>Bill To:</h3>
      <p>
        ${si.name ?? "—"}<br/>
        ${si.address ?? ""}<br/>
        ${si.email ?? ""}<br/>
        ${si.phoneNumber ? `Phone: ${si.phoneNumber}` : ""}
        ${si.regNo ? `<br/>Reg No: ${si.regNo}` : ""}
        ${si.batch ? `<br/>Batch: ${si.batch}` : ""}
      </p>
    </div>
    <div class="invoice-meta">
      ${planLabel ? `<div class="meta-row"><span class="label">Plan:</span><span class="value">${planLabel}</span></div>` : ""}
      <div class="meta-row"><span class="label">Proforma Number:</span><span class="value">${data.invoiceNumber}</span></div>
      <div class="meta-row"><span class="label">Proforma Date:</span><span class="value">${formatDate(data.invoiceDate)}</span></div>
      <div class="meta-row"><span class="label">Due Date:</span><span class="value">${formatDate(data.dueDate)}</span></div>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th>Description</th>
        <th>Quantity</th>
        <th>Rate</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemRow}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-block">
      <div class="total-row"><span>Subtotal:</span><span>${formatAmount(lineAmount, data.currency)}</span></div>
      <div class="total-row"><span>Tax (0%):</span><span>${formatAmount(tax, data.currency)}</span></div>
      <div class="total-row grand"><span>Total:</span><span>${formatAmount(lineAmount, data.currency)}</span></div>
    </div>
  </div>

  <hr class="divider"/>

  <div class="section">
    <h3>Bank Details</h3>
    ${renderBankDetailsBlock(data.currency)}
  </div>

  <div class="section">
    <h3>Proforma Information</h3>
    <ol class="info-list">
      <li>This is a proforma invoice and not a tax invoice.</li>
      <li>Please include the proforma invoice number in your payment reference.</li>
      <li>All bank charges are to be borne by the remitter.</li>
      <li>A final invoice will be issued upon receipt of payment.</li>
    </ol>
    <p class="note-text" style="margin-top:6px;"><strong>Note:</strong> Thank you for choosing our services.</p>
  </div>

  <div class="footer">
    <p class="thank-you">Thank you for your business!</p>
    <p>This is a computer-generated proforma invoice and does not require a signature.</p>
  </div>

</div>
</body>
</html>`;
}

export async function generatePdfFromHtml(
  html: string,
  filename: string,
): Promise<void> {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, {
    position:      "absolute",
    top:           "0",
    left:          "0",
    width:         `${A4_WIDTH_PX}px`,
    height:        "1px",
    border:        "none",
    opacity:       "0",
    pointerEvents: "none",
  });
  document.body.appendChild(iframe);

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
    iframe.srcdoc = html;
  });

  const iframeDoc = iframe.contentDocument!;
  const pageEl = iframeDoc.querySelector(".page") as HTMLElement;
  const captureTarget = pageEl ?? iframeDoc.body;
  const scrollH = captureTarget.scrollHeight;
  iframe.style.height = `${scrollH}px`;

  const images = Array.from(iframeDoc.images);
  await Promise.all(
    images.map(
      (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }),
    ),
  );
  await new Promise((r) => setTimeout(r, 300));

  try {
    const canvas = await html2canvas(captureTarget, {
      scale:           2,
      width:           A4_WIDTH_PX,
      windowWidth:     A4_WIDTH_PX,
      height:          scrollH,
      windowHeight:    scrollH,
      useCORS:         true,
      allowTaint:      true,
      backgroundColor: "#ffffff",
      scrollX:         0,
      scrollY:         0,
    });

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const imgData = canvas.toDataURL("image/jpeg", 0.97);

    const naturalHeightMm = (canvas.height / canvas.width) * A4_WIDTH_MM;
    let drawW = A4_WIDTH_MM;
    let drawH = naturalHeightMm;

    if (drawH > A4_HEIGHT_MM) {
      const scale = A4_HEIGHT_MM / drawH;
      drawW = drawW * scale;
      drawH = A4_HEIGHT_MM;
    }

    pdf.addImage(imgData, "JPEG", 0, 0, drawW, drawH);
    pdf.save(filename);
  } finally {
    document.body.removeChild(iframe);
  }
}
