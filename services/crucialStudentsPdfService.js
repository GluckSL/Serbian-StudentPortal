'use strict';
/**
 * Crucial Students PDF Report
 *
 * A4 portrait PDF with:
 *  - Header with branding
 *  - Summary cards: total crucial students, average engagement time
 *  - Table: Name | Batch | Phone | Journey Day | Exercise Days (last 3) | Total Time | Live Classes (last 2)
 */

const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable').default;

const BRAND   = { dark: [3, 57, 108], mid: [0, 91, 150], light: [248, 250, 252] };
const RED     = [220, 38, 38];
const ORANGE  = [234, 88, 12];
const SLATE   = [100, 116, 139];
const WHITE   = [255, 255, 255];
const GREEN   = [22, 163, 74];
const AMBER   = [217, 119, 6];

function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function exerciseDaysLabel(days) {
  if (!days || !days.length) return '—';
  return `Days ${days.join(', ')}`;
}

function drawHeader(doc, generatedAt) {
  // Background bar
  doc.setFillColor(...BRAND.dark);
  doc.rect(0, 0, 210, 42, 'F');

  // Alert stripe
  doc.setFillColor(...RED);
  doc.rect(0, 0, 5, 42, 'F');

  // Title
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('Crucial Students Report', 14, 16);

  // Subtitle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(200, 220, 240);
  doc.text('Platinum Batch (New) · Less than 1 hour on last 3 exercise days (pos 2, 4, 5)', 14, 24);

  // Badge
  doc.setFillColor(...RED);
  doc.roundedRect(14, 28, 52, 7, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...WHITE);
  doc.text('⚠  NEEDS ATTENTION', 16, 33.5);

  // Generated timestamp (right side)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(160, 190, 220);
  doc.text(`Generated: ${generatedAt}`, 196, 33.5, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  return 48;
}

function drawSummaryCards(doc, totalStudents, avgMinutes, y) {
  const cards = [
    {
      label: 'Crucial Students',
      value: String(totalStudents),
      sub: 'Platinum · <1 hr last 3 ex. days',
      accent: RED,
      wide: false,
    },
    {
      label: 'Avg. Engagement',
      value: `${avgMinutes} min`,
      sub: 'On last 3 exercise days',
      accent: ORANGE,
      wide: false,
    },
    {
      label: 'Threshold',
      value: '< 1 Hour',
      sub: 'Per student exercise-day window',
      accent: AMBER,
      wide: false,
    },
    {
      label: 'Exercise Days',
      value: 'Last 3',
      sub: 'Positions 2, 4, 5 per week',
      accent: BRAND.mid,
      wide: false,
    },
  ];

  const cardW = 43;
  const cardH = 24;
  const gap = 4;
  let x = 14;

  for (const card of cards) {
    doc.setDrawColor(230, 235, 245);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');
    doc.setFillColor(...card.accent);
    doc.rect(x, y, cardW, 1.8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...SLATE);
    doc.text(card.label.toUpperCase(), x + 2, y + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...card.accent);
    doc.text(card.value, x + 2, y + 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(...SLATE);
    const subLines = doc.splitTextToSize(card.sub, cardW - 4);
    doc.text(subLines, x + 2, y + 19);

    x += cardW + gap;
  }

  doc.setTextColor(0, 0, 0);
  return y + cardH + 8;
}

function sectionTitle(doc, text, y) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND.dark);
  doc.setDrawColor(...BRAND.mid);
  doc.setLineWidth(0.8);
  doc.line(14, y + 1.5, 17, y + 1.5);
  doc.text(text, 19, y + 2);
  return y + 7;
}

function tableTheme() {
  return {
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 2.8,
      lineColor: [232, 240, 248],
      lineWidth: 0.2,
      valign: 'middle',
    },
    headStyles: {
      fillColor: BRAND.dark,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'left',
    },
    alternateRowStyles: { fillColor: BRAND.light },
    margin: { left: 14, right: 14 },
  };
}

function generateCrucialStudentsPdf({ students, summary }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = drawHeader(doc, summary.generatedAt || '');

  // Summary cards
  y = drawSummaryCards(doc, summary.total, summary.avgMinutes, y);

  // Legend note
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...SLATE);
  doc.text(
    'Note: Each student is measured on their last 3 exercise journey days (positions 2, 4, 5 per week). ' +
    'E.g. a student on day 9 is checked on days 4, 5, 9. Live classes = last 2 for the batch.',
    14, y,
    { maxWidth: 182 },
  );
  y += 8;

  if (!students.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...GREEN);
    doc.text('🎉 All Platinum students are well-engaged! No crucial students found.', 14, y + 10);
    return Buffer.from(doc.output('arraybuffer'));
  }

  y = sectionTitle(doc, `Crucial Students (${students.length} total)`, y);

  // Build table body
  const body = students.map((s, i) => [
    String(i + 1),
    s.name,
    s.batch,
    s.phone,
    s.currentCourseDay ? String(s.currentCourseDay) : '—',
    exerciseDaysLabel(s.exerciseDays),
    fmtDuration(s.totalSeconds),
    `${s.liveClassesAttended ?? 0}/${s.liveClassesTotal ?? 0}`,
  ]);

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [[
      '#',
      'Student Name',
      'Batch',
      'Phone',
      'Journey Day',
      'Exercise Days\n(last 3)',
      'Total Time',
      'Live Classes\n(last 2)',
    ]],
    body,
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      1: { cellWidth: 30, fontStyle: 'bold' },
      2: { cellWidth: 20 },
      3: { cellWidth: 24 },
      4: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      5: { cellWidth: 26, halign: 'center' },
      6: { cellWidth: 20, halign: 'center', fontStyle: 'bold', textColor: RED },
      7: { cellWidth: 14, halign: 'center' },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 6) {
        const student = students[data.row.index];
        if (student && student.totalSeconds === 0) {
          data.cell.styles.textColor = RED;
          data.cell.styles.fontStyle = 'bold';
        }
      }
      if (data.section === 'body' && data.column.index === 7) {
        const student = students[data.row.index];
        if (student && (student.liveClassesAttended ?? 0) === 0) {
          data.cell.styles.textColor = AMBER;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  // Footer
  const footerY = doc.internal.pageSize.height - 10;
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(6.5);
    doc.setTextColor(...SLATE);
    doc.text(
      'Glück Global — Crucial Students Automated Report · Language Tracking Module',
      14,
      footerY,
      { maxWidth: 150 },
    );
    doc.text(`Page ${i} of ${pageCount}`, 196, footerY, { align: 'right' });
  }

  return Buffer.from(doc.output('arraybuffer'));
}

module.exports = { generateCrucialStudentsPdf };
