import type { FinalPayResult, PayLine, PayslipComputation } from '@payrollph/shared';
import PDFDocument from 'pdfkit';

/** Everything printed on one payslip. Amounts are 2-dp strings straight from the DB / engine. */
export interface PayslipPdfData {
  employer: { name: string; address: string | null; tin: string | null };
  employee: {
    employeeNo: string;
    name: string;
    position: string | null;
    payType: 'monthly' | 'semi_monthly' | 'daily' | 'hourly';
  };
  run: {
    kind: 'semi_monthly_1' | 'semi_monthly_2' | 'monthly' | 'thirteenth_month' | 'final_pay';
    status: 'draft' | 'review' | 'approved' | 'paid';
    periodStart: string;
    periodEnd: string;
    payDate: string;
  };
  computation: PayslipComputation;
  finalPay: FinalPayResult | null;
  ytd: {
    gross: string;
    taxableIncome: string;
    withholdingTax: string;
    sssEe: string;
    philhealthEe: string;
    pagibigEe: string;
    net: string;
  };
}

export interface RenderOptions {
  /** pdfkit deflates content streams by default; tests turn it off to read the text. */
  compress: boolean;
}

/**
 * Peso amount for print. pdfkit's built-in Helvetica (WinAnsi) has no ₱ glyph and no TTF with
 * one ships with the app, so the ISO code is printed instead: `PHP 1,234.56`.
 * Pure string formatting: money never goes through JS numbers.
 */
export function formatPeso(amount: string): string {
  const neg = amount.startsWith('-');
  const [intPart = '0', frac = ''] = (neg ? amount.slice(1) : amount).split('.');
  const grouped = (intPart.replace(/^0+(?=\d)/, '') || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}PHP ${grouped}.${`${frac}00`.slice(0, 2)}`;
}

const RUN_KIND_LABEL: Record<PayslipPdfData['run']['kind'], string> = {
  semi_monthly_1: 'Semi-monthly (1st cutoff)',
  semi_monthly_2: 'Semi-monthly (2nd cutoff)',
  monthly: 'Monthly',
  thirteenth_month: '13th month pay',
  final_pay: 'Final pay',
};

const PAY_TYPE_LABEL: Record<PayslipPdfData['employee']['payType'], string> = {
  monthly: 'Monthly-paid',
  semi_monthly: 'Semi-monthly-paid',
  daily: 'Daily-paid',
  hourly: 'Hourly-paid',
};

/** Statutory lines always shown, even when zero for this period. */
const FIXED_DEDUCTIONS: { code: string; label: string }[] = [
  { code: 'sss_ee', label: 'SSS (employee share)' },
  { code: 'philhealth_ee', label: 'PhilHealth (employee share)' },
  { code: 'pagibig_ee', label: 'Pag-IBIG (employee share)' },
  { code: 'withholding_tax', label: 'Withholding tax' },
];
const FIXED_EMPLOYER: { code: string; label: string }[] = [
  { code: 'sss_er', label: 'SSS (employer share)' },
  { code: 'sss_ec', label: 'SSS EC (employer)' },
  { code: 'philhealth_er', label: 'PhilHealth (employer share)' },
  { code: 'pagibig_er', label: 'Pag-IBIG (employer share)' },
];

function withFixed(lines: PayLine[], fixed: { code: string; label: string }[]): PayLine[] {
  const out: PayLine[] = fixed.map(
    (f) =>
      lines.find((l) => l.code === f.code) ?? {
        code: f.code,
        label: f.label,
        category: 'deduction',
        amount: '0.00',
      },
  );
  return [...out, ...lines.filter((l) => !fixed.some((f) => f.code === l.code))];
}

const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const MUTED = '#555555';
const RULE = '#bbbbbb';
const ROW = 13;

/** Render one payslip as a PDF (A4 portrait). */
export function renderPayslipPdf(data: PayslipPdfData, opts: RenderOptions): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    compress: opts.compress,
    bufferPages: true,
    info: {
      Title: `Payslip ${data.employee.employeeNo} ${data.run.periodStart} to ${data.run.periodEnd}`,
      Author: data.employer.name || 'PayrollPH',
      Creator: 'PayrollPH',
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottom = (): number => doc.page.height - doc.page.margins.bottom;
  let y = doc.page.margins.top;

  const ensure = (h: number): void => {
    if (y + h > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  };
  const text = (
    s: string,
    x: number,
    yy: number,
    w: number,
    o: { font?: string; size?: number; align?: 'left' | 'right' | 'center'; color?: string } = {},
  ): void => {
    doc
      .font(o.font ?? FONT)
      .fontSize(o.size ?? 8.5)
      .fillColor(o.color ?? '#000000')
      // A height of one line plus `ellipsis` truncates long labels instead of wrapping them.
      .text(s, x, yy, {
        width: w,
        height: (o.size ?? 8.5) * 1.2,
        align: o.align ?? 'left',
        lineBreak: false,
        ellipsis: true,
      });
  };
  const hr = (yy: number, color = RULE): void => {
    doc.moveTo(left, yy).lineTo(right, yy).lineWidth(0.6).strokeColor(color).stroke();
  };

  // ------------------------------------------------------------ header
  const { employer, employee, run, computation: c } = data;
  text(employer.name || 'Employer', left, y, width * 0.62, { font: BOLD, size: 14 });
  text('PAYSLIP', left + width * 0.62, y, width * 0.38, { font: BOLD, size: 16, align: 'right' });
  y += 18;
  if (employer.address) {
    text(employer.address, left, y, width * 0.62, { color: MUTED });
  }
  text(RUN_KIND_LABEL[run.kind], left + width * 0.62, y, width * 0.38, {
    align: 'right',
    color: MUTED,
  });
  y += ROW;
  if (employer.tin) {
    text(`TIN ${employer.tin}`, left, y, width * 0.62, { color: MUTED });
    y += ROW;
  }
  y += 4;
  hr(y, '#000000');
  y += 8;

  // ------------------------------------------------------------ employee / period
  const half = (width - 16) / 2;
  const kv = (label: string, value: string, x: number, yy: number): void => {
    text(label, x, yy, 92, { color: MUTED });
    text(value, x + 92, yy, half - 92, { font: BOLD });
  };
  const rb = c.rateBasis;
  const infoLeft: [string, string][] = [
    ['Employee', employee.name],
    ['Employee no.', employee.employeeNo],
    ['Position', employee.position ?? '-'],
    ['Pay type', PAY_TYPE_LABEL[employee.payType]],
  ];
  const infoRight: [string, string][] = [
    ['Pay period', `${run.periodStart} to ${run.periodEnd}`],
    ['Pay date', run.payDate],
    ['Run', RUN_KIND_LABEL[run.kind]],
    ['Status', run.status.toUpperCase()],
  ];
  for (let i = 0; i < 4; i += 1) {
    const l = infoLeft[i];
    const r = infoRight[i];
    if (l) kv(l[0], l[1], left, y);
    if (r) kv(r[0], r[1], left + half + 16, y);
    y += ROW;
  }
  text(
    `Rate basis: monthly ${formatPeso(rb.monthly)}  |  daily ${formatPeso(rb.daily)}  |  hourly ${formatPeso(rb.hourly)}` +
      (c.isMinimumWageEarner ? '  |  minimum wage earner' : ''),
    left,
    y,
    width,
    { color: MUTED },
  );
  y += ROW + 6;

  // ------------------------------------------------------------ earnings | deductions
  const colX = [left, left + half + 16];
  const table = (
    x: number,
    yy: number,
    title: string,
    lines: PayLine[],
    withQty: boolean,
  ): number => {
    const amtW = 78;
    const qtyW = withQty ? 44 : 0;
    const labelW = half - amtW - qtyW;
    doc.rect(x, yy, half, ROW + 2).fill('#eeeeee');
    text(title, x + 4, yy + 3, labelW, { font: BOLD });
    if (withQty) text('Qty', x + labelW, yy + 3, qtyW, { font: BOLD, align: 'right' });
    text('Amount', x + labelW + qtyW, yy + 3, amtW - 4, { font: BOLD, align: 'right' });
    let ry = yy + ROW + 5;
    for (const line of lines) {
      text(line.label, x + 4, ry, labelW - 6);
      if (withQty)
        text(line.quantity ?? '', x + labelW, ry, qtyW, { align: 'right', color: MUTED });
      text(formatPeso(line.amount), x + labelW + qtyW, ry, amtW - 4, { align: 'right' });
      ry += ROW;
    }
    if (lines.length === 0) {
      text('None', x + 4, ry, labelW, { color: MUTED });
      ry += ROW;
    }
    return ry;
  };

  const deductions = withFixed(c.employeeDeductions, FIXED_DEDUCTIONS);
  const tableRows = Math.max(c.earnings.length, deductions.length, 1);
  ensure((tableRows + 4) * ROW);
  const top = y;
  const endL = table(colX[0] ?? left, top, 'Earnings', c.earnings, true);
  const endR = table(colX[1] ?? left, top, 'Deductions', deductions, false);
  y = Math.max(endL, endR) + 2;
  hr(y);
  y += 4;
  text('Gross pay', left + 4, y, half - 90, { font: BOLD });
  text(formatPeso(c.grossPay), left, y, half - 4, { font: BOLD, align: 'right' });
  text('Total deductions', left + half + 20, y, half - 90, { font: BOLD });
  text(formatPeso(c.totalDeductions), left + half + 16, y, half - 4, {
    font: BOLD,
    align: 'right',
  });
  y += ROW + 8;

  // ------------------------------------------------------------ net pay
  ensure(34);
  doc.rect(left, y, width, 28).lineWidth(1.2).strokeColor('#000000').stroke();
  text('NET PAY', left + 10, y + 8, width / 2, { font: BOLD, size: 13 });
  text(formatPeso(c.netPay), left + width / 2, y + 8, width / 2 - 10, {
    font: BOLD,
    size: 13,
    align: 'right',
  });
  y += 40;

  // ------------------------------------------------------------ employer shares | YTD
  const box = (
    x: number,
    yy: number,
    title: string,
    rows: [string, string][],
    note?: string,
  ): number => {
    const h = (rows.length + 1) * ROW + 10 + (note ? ROW : 0);
    doc.rect(x, yy, half, h).lineWidth(0.6).strokeColor(RULE).stroke();
    text(title, x + 6, yy + 5, half - 12, { font: BOLD });
    let ry = yy + 5 + ROW;
    for (const [label, value] of rows) {
      text(label, x + 6, ry, half - 100);
      text(value, x + half - 100, ry, 94, { align: 'right' });
      ry += ROW;
    }
    if (note) text(note, x + 6, ry, half - 12, { size: 7, color: MUTED });
    return yy + h;
  };
  const er = withFixed(c.employerShares, FIXED_EMPLOYER);
  ensure(Math.max(er.length + 2, 9) * ROW + 12);
  const boxTop = y;
  const erEnd = box(
    colX[0] ?? left,
    boxTop,
    'Employer contributions (not deducted from pay)',
    er.map((l) => [l.label, formatPeso(l.amount)]),
    c.monthlyContributions.employerShoulderedEe
      ? 'The employer also pays the employee share for this employee.'
      : undefined,
  );
  const ytd = data.ytd;
  const ytdEnd = box(colX[1] ?? left, boxTop, `Year to date (${run.periodEnd.slice(0, 4)})`, [
    ['Gross pay', formatPeso(ytd.gross)],
    ['Taxable income', formatPeso(ytd.taxableIncome)],
    ['Withholding tax', formatPeso(ytd.withholdingTax)],
    ['SSS (employee)', formatPeso(ytd.sssEe)],
    ['PhilHealth (employee)', formatPeso(ytd.philhealthEe)],
    ['Pag-IBIG (employee)', formatPeso(ytd.pagibigEe)],
    ['Net pay', formatPeso(ytd.net)],
  ]);
  y = Math.max(erEnd, ytdEnd) + 12;

  // ------------------------------------------------------------ final pay
  const fp = data.finalPay;
  if (fp) {
    const rows = Math.max(fp.earnings.length, fp.deductions.length, 1);
    ensure((rows + 9) * ROW);
    text('Final pay', left, y, width, { font: BOLD, size: 11 });
    y += ROW + 4;
    const fTop = y;
    const fl = table(colX[0] ?? left, fTop, 'Final pay earnings', fp.earnings, true);
    const fr = table(colX[1] ?? left, fTop, 'Final pay deductions', fp.deductions, false);
    y = Math.max(fl, fr) + 2;
    hr(y);
    y += 4;
    const fRows: [string, string][] = [
      ['13th month (prorated)', formatPeso(fp.thirteenthMonth.amount)],
      ['  of which exempt', formatPeso(fp.thirteenthMonth.exempt)],
      ['  of which taxable', formatPeso(fp.thirteenthMonth.taxable)],
      ['Last salary (net)', formatPeso(fp.lastSalaryNet)],
      ['Total final pay earnings', formatPeso(fp.totalEarnings)],
      ['Total final pay deductions', formatPeso(fp.totalDeductions)],
    ];
    for (const [label, value] of fRows) {
      text(label, left + 4, y, width - 120);
      text(value, left, y, width - 4, { align: 'right' });
      y += ROW;
    }
    y += 4;
    ensure(30);
    doc.rect(left, y, width, 24).lineWidth(1).strokeColor('#000000').stroke();
    text('NET FINAL PAY', left + 10, y + 7, width / 2, { font: BOLD, size: 11 });
    text(formatPeso(fp.netFinalPay), left + width / 2, y + 7, width / 2 - 10, {
      font: BOLD,
      size: 11,
      align: 'right',
    });
  }

  // ------------------------------------------------------------ footer + watermark on every page
  const draft = run.status === 'draft' || run.status === 'review';
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const fy = doc.page.height - doc.page.margins.bottom - 10;
    // Writing inside the bottom margin would auto-add a page; lift the margin while drawing.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    text(
      `This payslip is computer-generated. Amounts in Philippine pesos (PHP). Page ${i - range.start + 1} of ${range.count}`,
      left,
      fy,
      width,
      { size: 7, color: MUTED, align: 'center' },
    );
    if (draft) {
      const cx = doc.page.width / 2;
      const cy = doc.page.height / 2;
      doc.save();
      doc.rotate(-40, { origin: [cx, cy] });
      doc.opacity(0.13);
      text('DRAFT', cx - 300, cy - 60, 600, {
        font: BOLD,
        size: 130,
        align: 'center',
        color: '#cc0000',
      });
      doc.restore();
    }
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  return done;
}
