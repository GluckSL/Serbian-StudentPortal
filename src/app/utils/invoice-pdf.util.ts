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

export function renderInvoiceHTML(data: InvoiceData): string {
  const formatAmount = (amount: number, currency: string) =>
    `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB"); // DD/MM/YYYY
  };

  const si = data.studentInfo;

  /* ── Description line ── */
  const descriptionParts = [
    si.servicesOpted ?? "Language Learning",
    si.level ? `${si.level} Level` : null,
    data.installmentAllowed && data.activeInstallmentNumber != null
      ? `(Instalment number: ${data.activeInstallmentNumber})`
      : null,
  ].filter(Boolean);
  const description = descriptionParts.join(" ");

  /* ── Tax (always 0 for now) ── */
  const tax = 0;

  /* ── Installments rows ── */
  const installmentRows =
    data.installments && data.installments.length > 0
      ? data.installments
          .map(
            (inst) => `
        <tr>
          <td>Instalment ${inst.installmentNumber}
            <span style="margin-left:8px;font-size:13px;padding:2px 8px;border-radius:10px;
              background:${inst.status === "paid" ? "#d1fae5" : inst.status === "overdue" ? "#fee2e2" : "#fef9c3"};
              color:${inst.status === "paid" ? "#065f46" : inst.status === "overdue" ? "#991b1b" : "#854d0e"};">
              ${inst.status}
            </span>
          </td>
          <td>1</td>
          <td>${inst.currency}<br/>${inst.requestedAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
          <td>${inst.currency}<br/>${inst.requestedAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
        </tr>
        ${
          inst.paidAmount != null && inst.paidAmount > 0
            ? `<tr style="background:#f9fafb;">
                <td style="padding-left:24px;color:#555;font-size:14px;">↳ Paid</td>
                <td></td>
                <td></td>
                <td style="color:#16a34a;font-size:14px;">${inst.currency} ${inst.paidAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
               </tr>`
            : ""
        }
        ${
          inst.remainingAmount != null && inst.remainingAmount > 0
            ? `<tr style="background:#f9fafb;">
                <td style="padding-left:24px;color:#555;font-size:14px;">↳ Remaining</td>
                <td></td>
                <td></td>
                <td style="color:#dc2626;font-size:14px;">${inst.currency} ${inst.remainingAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
               </tr>`
            : ""
        }`,
          )
          .join("")
      : `<tr>
          <td>${description}</td>
          <td>1</td>
          <td>${data.currency}<br/>${data.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
          <td>${data.currency}<br/>${data.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
        </tr>`;

  /* ── Submission block ── */
  const submissionBlock = data.submission
    ? `
    <hr class="divider"/>
    <div class="section">
      <h3>Payment Submission</h3>
      <div class="bank-grid">
        ${data.submission.transactionId ? `<div class="bank-item"><strong>Transaction ID:</strong> ${data.submission.transactionId}</div>` : ""}
        <div class="bank-item"><strong>Method:</strong> ${data.submission.paymentMethod ?? "—"}</div>
        <div class="bank-item"><strong>Submitted:</strong> ${formatDate(data.submission.submittedAt)}</div>
        ${data.submission.approvedAt ? `<div class="bank-item"><strong>Approved:</strong> ${formatDate(data.submission.approvedAt)}</div>` : ""}
        <div class="bank-item"><strong>Amount Paid:</strong> ${formatAmount(data.submission.paidAmount, data.submission.currency)}</div>
        <div class="bank-item"><strong>Status:</strong>
          <span style="padding:2px 8px;border-radius:10px;font-size:13px;
            background:${data.submission.status === "approved" ? "#d1fae5" : data.submission.status === "rejected" ? "#fee2e2" : "#fef9c3"};
            color:${data.submission.status === "approved" ? "#065f46" : data.submission.status === "rejected" ? "#991b1b" : "#854d0e"};">
            ${data.submission.status}
          </span>
        </div>
        ${data.submission.adminRemarks ? `<div class="bank-item" style="grid-column:1/-1"><strong>Remarks:</strong> ${data.submission.adminRemarks}</div>` : ""}
        ${data.submission.rejectionReason ? `<div class="bank-item" style="grid-column:1/-1"><strong>Rejection Reason:</strong> ${data.submission.rejectionReason}</div>` : ""}
      </div>
    </div>`
    : "";

  /* ── Remarks block ── */
  const remarksBlock = data.remarks
    ? `<hr class="divider"/>
       <div class="section">
         <h3>Remarks</h3>
         <p style="font-size:15px;color:#444;line-height:1.7;">${data.remarks}</p>
       </div>`
    : "";

  /* ── Progress bar ── */
  const progressBar = `
    <div style="margin-bottom:28px;">
      <div style="display:flex;justify-content:space-between;font-size:14px;color:#555;margin-bottom:6px;">
        <span>Payment Progress</span>
        <span style="font-weight:600;">${data.percentPaid.toFixed(1)}% paid</span>
      </div>
      <div style="background:#e5e7eb;border-radius:999px;height:8px;overflow:hidden;">
        <div style="height:100%;width:${Math.min(data.percentPaid, 100)}%;background:${data.progressColor};border-radius:999px;transition:width 0.4s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:14px;margin-top:6px;">
        <span style="color:#16a34a;">Paid: ${formatAmount(data.paidAmount, data.currency)}</span>
        <span style="color:${data.balanceColor};">Balance: ${formatAmount(data.amountRemaining, data.currency)}</span>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Proforma Invoice – ${data.invoiceNumber}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', sans-serif;
      margin: 0;
      padding: 0;
      color: #1a1a1a;
    }

    .page {
      background: #ffffff;
    }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
    .company-info { text-align: right; font-size: 15px; line-height: 1.7; color: #333; }
    .company-info .company-name { font-weight: 700; font-size: 17px; color: #111; }
    .title-block { margin-bottom: 28px; }
    .title-block h1 { font-size: 31px; font-weight: 800; letter-spacing: 0.02em; color: #111; text-transform: uppercase; margin-bottom: 4px; }
    .title-block .subtitle { font-size: 14px; color: #777; }
    hr.divider { border: none; border-top: 1.5px solid #e0e0e0; margin: 20px 0; }
    .bill-meta { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 32px; }
    .bill-to h3 { font-size: 16px; font-weight: 700; margin-bottom: 6px; color: #111; }
    .bill-to p { font-size: 15px; line-height: 1.7; color: #333; }
    .invoice-meta { min-width: 320px; }
    .meta-row { display: flex; justify-content: space-between; font-size: 15px; line-height: 1.9; color: #333; }
    .meta-row .label { font-weight: 600; color: #111; margin-right: 24px; }
    .meta-row .value { text-align: right; min-width: 120px; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .items-table thead tr { border-top: 1.5px solid #222; border-bottom: 1.5px solid #222; }
    .items-table thead th { font-size: 15px; font-weight: 700; padding: 10px 8px; text-align: left; color: #111; }
    .items-table thead th:not(:first-child) { text-align: right; }
    .items-table tbody tr { border-bottom: 1px solid #e8e8e8; }
    .items-table tbody td { font-size: 15px; padding: 12px 8px; vertical-align: top; color: #222; }
    .items-table tbody td:not(:first-child) { text-align: right; }
    .totals { display: flex; justify-content: flex-end; margin-bottom: 28px; }
    .totals-block { width: 260px; }
    .total-row { display: flex; justify-content: space-between; font-size: 15px; padding: 5px 8px; color: #333; }
    .total-row.grand { border-top: 1.5px solid #222; margin-top: 4px; padding-top: 8px; font-weight: 700; font-size: 16px; color: #111; }
    .section { margin-bottom: 24px; }
    .section h3 { font-size: 16px; font-weight: 700; margin-bottom: 10px; color: #111; }
    .bank-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 32px; }
    .bank-item { font-size: 14px; line-height: 1.75; color: #333; }
    .bank-item strong { font-weight: 600; color: #111; }
    .info-list { list-style: none; padding: 0; counter-reset: item; }
    .info-list li { font-size: 14px; color: #444; line-height: 1.75; padding-left: 14px; position: relative; counter-increment: item; }
    .info-list li::before { content: counter(item) "."; position: absolute; left: 0; font-weight: 500; }
    .footer { margin-top: 36px; text-align: center; border-top: 1px solid #e8e8e8; padding-top: 20px; }
    .footer p { font-size: 14px; color: #888; line-height: 1.7; }
    .footer .thank-you { font-size: 15px; color: #444; font-weight: 500; margin-bottom: 4px; }
    .status-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      background: ${data.statusColor}22;
      color: ${data.statusColor};
      border: 1px solid ${data.statusColor}44;
    }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="logo">
      <svg viewBox="0 0 52 44" fill="none" xmlns="http://www.w3.org/2000/svg" width="52" height="44">
        <rect x="0" y="0" width="10" height="10" rx="5" fill="#F5C800"/>
        <rect x="30" y="0" width="10" height="10" rx="5" fill="#F5C800"/>
        <path d="M0 8 Q0 38 20 38 Q40 38 40 8" stroke="#F5C800" stroke-width="9" fill="none" stroke-linecap="round"/>
      </svg>
    </div>
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
      ${si.subscription ? `<div class="meta-row"><span class="label">Plan:</span><span class="value">${si.subscription}</span></div>` : ""}
      <div class="meta-row"><span class="label">Proforma Number:</span><span class="value">${data.invoiceNumber}</span></div>
      <div class="meta-row"><span class="label">Proforma Date:</span><span class="value">${formatDate(data.invoiceDate)}</span></div>
      <div class="meta-row"><span class="label">Due Date:</span><span class="value" style="color:${data.dueDateColor};">${formatDate(data.dueDate)}</span></div>
      <div class="meta-row"><span class="label">Status:</span><span class="value"><span class="status-badge">${data.status}</span></span></div>
      ${data.paymentDate ? `<div class="meta-row"><span class="label">Payment Date:</span><span class="value">${formatDate(data.paymentDate)}</span></div>` : ""}
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
      ${installmentRows}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-block">
      <div class="total-row"><span>Subtotal:</span><span>${formatAmount(data.totalAmount, data.currency)}</span></div>
      <div class="total-row"><span>Tax (0%):</span><span>${formatAmount(tax, data.currency)}</span></div>
      <div class="total-row grand"><span>Total:</span><span>${formatAmount(data.totalAmount, data.currency)}</span></div>
    </div>
  </div>

  ${progressBar}

  <hr class="divider"/>

  <div class="section">
    <h3>Bank Details</h3>
    <div class="bank-grid">
      <div class="bank-item"><strong>Beneficiary Name:</strong> Glück Global Pvt Ltd</div>
      <div class="bank-item"><strong>Account Number:</strong> 115511485187</div>
      <div class="bank-item"><strong>Bank Name:</strong> National Development Bank PLC</div>
      <div class="bank-item"><strong>Bank Address:</strong> No 133, Kotugodella Street, Kandy</div>
      <div class="bank-item"><strong>Bank Code:</strong> 7214</div>
      <div class="bank-item"><strong>Branch Code:</strong> 002</div>
      <div class="bank-item"><strong>SWIFT Code:</strong> NDBSLKLX</div>
      <div class="bank-item"><strong>Account Currency:</strong> Sri Lankan Rupee (LKR)</div>
    </div>
  </div>

  ${submissionBlock}
  ${remarksBlock}

  <hr class="divider"/>

  <div class="section">
    <h3>Proforma Information</h3>
    <ol class="info-list">
      <li>This is a proforma invoice and not a tax invoice.</li>
      <li>Please include the proforma invoice number in your payment reference.</li>
      <li>All bank charges are to be borne by the remitter.</li>
      <li>A final invoice will be issued upon receipt of payment.</li>
    </ol>
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
  // 1. Use an off-screen iframe so the invoice's own <style> (including body
  //    styles) renders in full isolation without fighting the host page.
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, {
    position:     "absolute",
    top:          "0",
    left:         "0",
    width:        "100%",       // fill available width — jsPDF controls page size
    height:       "1px",
    border:       "none",
    opacity:      "0",
    pointerEvents:"none",
  });
  document.body.appendChild(iframe);

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
    iframe.srcdoc = html;
  });

  // 2. Expand iframe to full content height so nothing is clipped
  const iframeDoc  = iframe.contentDocument!;
  const scrollH    = iframeDoc.documentElement.scrollHeight;
  iframe.style.height = `${scrollH}px`;

  // Give fonts/images an extra tick to finish rendering
  await new Promise((r) => setTimeout(r, 500));

  try {
    // 3. Rasterise the iframe's body at 2× scale
    const canvas = await html2canvas(iframeDoc.body, {
      scale:           2,
      useCORS:         true,
      allowTaint:      true,
      backgroundColor: "#ffffff",
      scrollX:         0,
      scrollY:         0,
    });

    // 4. Slice canvas into A4 pages
    const pdf    = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW  = pdf.internal.pageSize.getWidth();   // 210 mm
    const pageH  = pdf.internal.pageSize.getHeight();  // 297 mm
    const margin = 10;
    const printW = pageW - margin * 2;                 // 190 mm
    const printH = pageH - margin * 2;                 // 277 mm

    // canvas px that fit in one printed page height
    const pxPerMm    = canvas.width / printW;
    const sliceH     = Math.floor(printH * pxPerMm);
    const totalPages = Math.ceil(canvas.height / sliceH);

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) pdf.addPage();

      const srcY = page * sliceH;
      const srcH = Math.min(sliceH, canvas.height - srcY);

      const pageCanvas         = document.createElement("canvas");
      pageCanvas.width         = canvas.width;
      pageCanvas.height        = sliceH;
      const ctx                = pageCanvas.getContext("2d")!;
      ctx.fillStyle            = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);

      const imgData = pageCanvas.toDataURL("image/jpeg", 0.97);
      pdf.addImage(imgData, "JPEG", margin, margin, printW, printH);
    }

    pdf.save(filename);
  } finally {
    document.body.removeChild(iframe);
  }
}
