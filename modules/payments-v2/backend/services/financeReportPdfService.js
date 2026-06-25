/**
 * Finance Daily Report PDF — A4 layout for email attachment.
 */

const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable').default;

const BRAND = { dark: [3, 57, 108], mid: [0, 91, 150], light: [248, 250, 252] };
const AMBER = [217, 119, 6];
const PURPLE = [124, 58, 237];
const RED = [220, 38, 38];
const GREEN = [22, 163, 74];
const SLATE = [100, 116, 139];

function fmtNum(n) {
  if (!n) return '0';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtAmount(lkr, inr) {
  const parts = [];
  if (lkr > 0) parts.push(`LKR ${fmtNum(lkr)}`);
  if (inr > 0) parts.push(`INR ${fmtNum(inr)}`);
  return parts.length ? parts.join('\n') : '—';
}

function drawHeader(doc, title, badge, yStart = 14) {
  doc.setFillColor(...BRAND.dark);
  doc.rect(0, 0, 210, 38, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 14, yStart);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 220, 240);
  doc.text('Glück Global — Finance Dashboard Automated Report', 14, yStart + 7);
  doc.setFillColor(...BRAND.mid);
  doc.roundedRect(14, yStart + 11, 42, 6, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text(badge.toUpperCase(), 16, yStart + 15.5);
  doc.setTextColor(0, 0, 0);
  return 44;
}

function drawSummaryCards(doc, cards, y) {
  const cardW = 44;
  const cardH = 28;
  const gap = 4;
  let x = 14;

  for (const card of cards) {
    doc.setDrawColor(232, 236, 244);
    doc.setFillColor(...(card.grand ? BRAND.light : [255, 255, 255]));
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');
    doc.setFillColor(...(card.accent || BRAND.mid));
    doc.rect(x, y, cardW, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...SLATE);
    const labelLines = doc.splitTextToSize(card.label.toUpperCase(), cardW - 4);
    doc.text(labelLines, x + 2, y + 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(card.grand ? 11 : 9);
    doc.setTextColor(...(card.accent || BRAND.dark));
    const valLines = doc.splitTextToSize(card.value, cardW - 4);
    doc.text(valLines, x + 2, y + 12);

    if (card.value2) {
      doc.setFontSize(8);
      doc.text(card.value2, x + 2, y + 18);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(...SLATE);
    const subLines = doc.splitTextToSize(card.sub, cardW - 4);
    doc.text(subLines, x + 2, y + (card.value2 ? 23 : 20));

    x += cardW + gap;
  }

  return y + cardH + 8;
}

function sectionTitle(doc, text, y) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND.dark);
  doc.setDrawColor(...BRAND.mid);
  doc.setLineWidth(0.8);
  doc.line(14, y + 1, 17, y + 1);
  doc.text(text, 19, y + 1);
  return y + 6;
}

function tableTheme() {
  return {
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2.5, lineColor: [240, 244, 248], lineWidth: 0.2 },
    headStyles: {
      fillColor: BRAND.dark,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: BRAND.light },
    margin: { left: 14, right: 14 },
  };
}

function commencementRows(rows) {
  return rows
    .filter((r) => r.commencement && !r.commencement.isPast)
    .sort((a, b) => (a.commencement.daysUntil ?? 999) - (b.commencement.daysUntil ?? 999))
    .slice(0, 20)
    .map((r) => {
      const c = r.commencement;
      return [
        r.batch,
        `${c.currentLevel || '—'} → ${c.nextLevel || '—'}`,
        c.dateStr,
        c.amountLKR > 0 ? `LKR ${fmtNum(c.amountLKR)}` : '—',
        c.amountINR > 0 ? `INR ${fmtNum(c.amountINR)}` : '—',
        String(r.studentCount),
      ];
    });
}

function generateMorningReportPdf({
  rows,
  now,
  totalOngoingLKR,
  totalOngoingINR,
  totalLastLevelLKR,
  totalLastLevelINR,
  totalCommence10LKR,
  totalCommence10INR,
  totalGrandLKR,
  totalGrandINR,
  nearCommenceRows,
  cutoffDateStr,
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = drawHeader(doc, 'Morning Finance Report', '10:00 AM Daily Summary');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text(`Morning Pending Summary — ${now}`, 14, y);
  y += 6;

  y = drawSummaryCards(doc, [
    {
      label: 'Ongoing Pending',
      value: totalOngoingLKR > 0 ? `LKR ${fmtNum(totalOngoingLKR)}` : '—',
      value2: totalOngoingINR > 0 ? `INR ${fmtNum(totalOngoingINR)}` : null,
      sub: 'current level · all active batches',
      accent: AMBER,
    },
    {
      label: 'Previous Levels',
      value: totalLastLevelLKR > 0 ? `LKR ${fmtNum(totalLastLevelLKR)}` : '—',
      value2: totalLastLevelINR > 0 ? `INR ${fmtNum(totalLastLevelINR)}` : null,
      sub: 'pending from earlier levels',
      accent: PURPLE,
    },
    {
      label: 'Commencement (10d)',
      value: totalCommence10LKR > 0 ? `LKR ${fmtNum(totalCommence10LKR)}` : '—',
      value2: totalCommence10INR > 0 ? `INR ${fmtNum(totalCommence10INR)}` : null,
      sub: `${nearCommenceRows.length} batch(es) by ${cutoffDateStr}`,
      accent: RED,
    },
    {
      label: 'Total Amount',
      value: totalGrandLKR > 0 ? `LKR ${fmtNum(totalGrandLKR)}` : '—',
      value2: totalGrandINR > 0 ? `INR ${fmtNum(totalGrandINR)}` : null,
      sub: 'ongoing + previous + commencement',
      accent: BRAND.dark,
      grand: true,
    },
  ], y);

  const upcoming = commencementRows(rows);
  if (upcoming.length) {
    y = sectionTitle(doc, 'Upcoming Level Commencements', y);
    autoTable(doc, {
      ...tableTheme(),
      startY: y,
      head: [['Batch', 'Level change', 'Commencement', 'Projected LKR', 'Projected INR', 'Students']],
      body: upcoming,
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  y = sectionTitle(doc, 'Batch-wise Pending Balance', y);
  const batchBody = rows.map((r) => {
    const c = r.commencement;
    let comm = '—';
    if (c) {
      comm = c.dateStr;
      const amts = [];
      if (c.amountLKR > 0) amts.push(`LKR ${fmtNum(c.amountLKR)}`);
      if (c.amountINR > 0) amts.push(`INR ${fmtNum(c.amountINR)}`);
      if (amts.length) comm += `\n${amts.join(' · ')}`;
    }
    return [
      r.batch,
      `${r.balanceStudents} / ${r.studentCount}`,
      r.pendingLKR > 0 ? `LKR ${fmtNum(r.pendingLKR)}` : '—',
      r.pendingINR > 0 ? `INR ${fmtNum(r.pendingINR)}` : '—',
      r.overdueStudents > 0 ? `${r.overdueStudents}` : '—',
      comm,
    ];
  });

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [['Batch', 'Students\n(balance/total)', 'Pending LKR', 'Pending INR', 'Overdue', 'Commencement']],
    body: batchBody.length ? batchBody : [['No batches configured', '', '', '', '', '']],
  });

  const footerY = doc.internal.pageSize.height - 12;
  doc.setFontSize(6.5);
  doc.setTextColor(...SLATE);
  doc.text(
    'Current-level language fees for ongoing students only. Commencement = projected next-level collection. Generated automatically.',
    14,
    footerY,
    { maxWidth: 182 },
  );

  return Buffer.from(doc.output('arraybuffer'));
}

function generateEveningReportPdf({
  rows,
  todayReceived,
  now,
  totalTodayLKR,
  totalTodayINR,
  totalTodayCount,
  totalPendingLKR,
  totalPendingINR,
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = drawHeader(doc, 'Evening Finance Report', '6:00 PM Daily Summary');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text(`Evening Collection Summary — ${now}`, 14, y);
  y += 6;

  const cards = [
    {
      label: 'Received Today',
      value: `LKR ${fmtNum(totalTodayLKR)}`,
      value2: totalTodayINR > 0 ? `INR ${fmtNum(totalTodayINR)}` : null,
      sub: `${totalTodayCount} payment(s) approved`,
      accent: GREEN,
    },
    {
      label: 'Still Pending',
      value: `LKR ${fmtNum(totalPendingLKR)}`,
      value2: totalPendingINR > 0 ? `INR ${fmtNum(totalPendingINR)}` : null,
      sub: 'as of 6 PM IST',
      accent: AMBER,
    },
  ];
  y = drawSummaryCards(doc, cards, y);

  const batchMap = new Map(rows.map((r) => [String(r.batch).toLowerCase(), r]));
  const receivedKeys = Object.keys(todayReceived || {});

  if (receivedKeys.length) {
    y = sectionTitle(doc, 'Payments Received Today (by Batch)', y);
    const receivedBody = receivedKeys.map((key) => {
      const row = batchMap.get(key);
      const rec = todayReceived[key] || {};
      return [
        row ? row.batch : key,
        row ? String(row.balanceStudents) : '—',
        rec.lkr > 0 ? `LKR ${fmtNum(rec.lkr)}` : '—',
        rec.inr > 0 ? `INR ${fmtNum(rec.inr)}` : '—',
        `${rec.count || 0}`,
      ];
    });
    autoTable(doc, {
      ...tableTheme(),
      startY: y,
      head: [['Batch', 'Balance students', 'Received LKR', 'Received INR', 'Submissions']],
      body: receivedBody,
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  const upcoming = commencementRows(rows);
  if (upcoming.length) {
    y = sectionTitle(doc, 'Upcoming Level Commencements', y);
    autoTable(doc, {
      ...tableTheme(),
      startY: y,
      head: [['Batch', 'Level change', 'Commencement', 'Projected LKR', 'Projected INR', 'Students']],
      body: upcoming,
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  if (y > 240) {
    doc.addPage();
    y = 20;
  }

  y = sectionTitle(doc, 'Full Balance Status as of 6 PM', y);
  const balanceBody = rows.map((r) => {
    const rec = todayReceived[String(r.batch).toLowerCase()] || {};
    const c = r.commencement;
    let comm = '—';
    if (c) {
      comm = c.dateStr;
      const amts = [];
      if (c.amountLKR > 0) amts.push(`LKR ${fmtNum(c.amountLKR)}`);
      if (c.amountINR > 0) amts.push(`INR ${fmtNum(c.amountINR)}`);
      if (amts.length) comm += `\n${amts.join(' · ')}`;
    }
    return [
      r.batch,
      `${r.balanceStudents} / ${r.studentCount}`,
      rec.lkr > 0 ? `LKR ${fmtNum(rec.lkr)}` : '—',
      r.pendingLKR > 0 ? `LKR ${fmtNum(r.pendingLKR)}` : '—',
      r.pendingINR > 0 ? `INR ${fmtNum(r.pendingINR)}` : '—',
      r.overdueStudents > 0 ? String(r.overdueStudents) : '—',
      comm,
    ];
  });

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [['Batch', 'Students', 'Today LKR', 'Pending LKR', 'Pending INR', 'Overdue', 'Commencement']],
    body: balanceBody.length ? balanceBody : [['No batches', '', '', '', '', '', '']],
  });

  const footerY = doc.internal.pageSize.height - 12;
  doc.setFontSize(6.5);
  doc.setTextColor(...SLATE);
  doc.text(
    'Received today = current-level payments approved today. Still pending = current-level balance for ongoing students.',
    14,
    footerY,
    { maxWidth: 182 },
  );

  return Buffer.from(doc.output('arraybuffer'));
}

module.exports = {
  generateMorningReportPdf,
  generateEveningReportPdf,
};
