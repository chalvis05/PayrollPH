import PDFDocument from 'pdfkit';

/**
 * Generic landscape table PDF (pdfkit): title, subtitle lines, column headers repeated on every
 * page, right-aligned money columns, optional bold rows and a totals row, page numbers.
 * Values are passed as strings; money columns are only re-formatted (thousands separators),
 * never re-computed.
 */

export interface PdfColumn {
  header: string;
  /** Money columns are right-aligned and shown with thousands separators. */
  money?: boolean;
  align?: 'left' | 'right';
  /** Relative width (default 1). */
  width?: number;
}

export interface PdfRow {
  cells: readonly string[];
  bold?: boolean;
}

export interface PdfSection {
  heading?: string;
  subtitle?: readonly string[];
  columns: readonly PdfColumn[];
  rows: readonly (readonly string[] | PdfRow)[];
  /** Totals row, drawn bold with a rule above it. */
  totals?: readonly string[];
  /** Start this section on a fresh page (e.g. one page per employee). */
  newPage?: boolean;
  /** Shown when there are no rows. */
  emptyText?: string;
}

export interface TablePdfSpec {
  title: string;
  subtitle?: readonly string[];
  sections: readonly PdfSection[];
  pageSize?: 'A4' | 'LETTER' | 'LEGAL';
  fontSize?: number;
  /** Printed at the bottom-left of every page. */
  footer?: string;
}

const MARGIN = 36;
const MONEY_RE = /^-?\d+(\.\d+)?$/;

/** 1234567.5 → "1,234,567.50" using string manipulation only (no float math). */
export function formatMoney(value: string): string {
  if (!MONEY_RE.test(value)) return value;
  const negative = value.startsWith('-');
  const [intPart = '0', frac = ''] = (negative ? value.slice(1) : value).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

const isPdfRow = (r: readonly string[] | PdfRow): r is PdfRow => !Array.isArray(r);

export function renderTablePdf(spec: TablePdfSpec): Promise<Buffer> {
  const fontSize = spec.fontSize ?? 8;
  const doc = new PDFDocument({
    size: spec.pageSize ?? 'A4',
    layout: 'landscape',
    margin: MARGIN,
    bufferPages: true,
    // Plain ASCII metadata so the title stays readable in every viewer's document properties.
    info: {
      Title: spec.title.replace(/—/g, '-').replace(/[^\x20-\x7E]/g, ''),
      Producer: 'PayrollPH',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = MARGIN;
  const usable = doc.page.width - MARGIN * 2;
  // Leave room for the page footer.
  const bottom = () => doc.page.height - MARGIN - fontSize * 2;
  const rowH = fontSize + 6;
  let y = MARGIN;

  const fit = (text: string, width: number): string => {
    if (doc.widthOfString(text) <= width) return text;
    let t = text;
    while (t.length > 0 && doc.widthOfString(`${t}…`) > width) t = t.slice(0, -1);
    return `${t}…`;
  };

  const drawTitle = (continued: boolean): void => {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('black');
    doc.text(continued ? `${spec.title} (continued)` : spec.title, left, y, {
      width: usable,
      lineBreak: false,
    });
    y += 18;
    if (!continued) {
      doc.font('Helvetica').fontSize(9);
      for (const line of spec.subtitle ?? []) {
        doc.text(fit(line, usable), left, y, { width: usable, lineBreak: false });
        y += 12;
      }
    }
    y += 4;
  };

  const widthsFor = (cols: readonly PdfColumn[]): number[] => {
    const total = cols.reduce((a, c) => a + (c.width ?? 1), 0);
    return cols.map((c) => (usable * (c.width ?? 1)) / total);
  };

  const drawCells = (
    cols: readonly PdfColumn[],
    widths: readonly number[],
    cells: readonly string[],
    bold: boolean,
  ): void => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
    let x = left;
    cols.forEach((col, i) => {
      const w = widths[i] ?? 0;
      const raw = cells[i] ?? '';
      const value = col.money ? formatMoney(raw) : raw;
      const align = col.align ?? (col.money ? 'right' : 'left');
      doc.text(fit(value, w - 4), x + 2, y + 3, { width: w - 4, align, lineBreak: false });
      x += w;
    });
    y += rowH;
  };

  const drawHeader = (cols: readonly PdfColumn[], widths: readonly number[]): void => {
    // Headers may wrap onto a second line when the column is narrow.
    doc.font('Helvetica-Bold').fontSize(fontSize);
    const wraps = cols.some((c, i) => doc.widthOfString(c.header) > (widths[i] ?? 0) - 4);
    const h = wraps ? rowH + fontSize + 1 : rowH;
    doc.rect(left, y, usable, h).fill('#e6e6e6');
    doc.fillColor('black');
    let x = left;
    cols.forEach((col, i) => {
      const w = widths[i] ?? 0;
      doc.text(col.header, x + 2, y + 3, {
        width: w - 4,
        height: h - 3,
        align: col.align ?? (col.money ? 'right' : 'left'),
        ellipsis: true,
      });
      x += w;
    });
    y += h;
  };

  const newPage = (): void => {
    doc.addPage();
    y = MARGIN;
    drawTitle(true);
  };

  drawTitle(false);
  spec.sections.forEach((section, si) => {
    if (section.newPage && si > 0) newPage();
    const widths = widthsFor(section.columns);
    const headLines = (section.heading ? 1 : 0) + (section.subtitle?.length ?? 0);
    if (y + headLines * 12 + rowH * 2 > bottom()) newPage();
    if (section.heading) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('black');
      doc.text(fit(section.heading, usable), left, y, { width: usable, lineBreak: false });
      y += 14;
    }
    for (const line of section.subtitle ?? []) {
      doc.font('Helvetica').fontSize(9);
      doc.text(fit(line, usable), left, y, { width: usable, lineBreak: false });
      y += 12;
    }
    drawHeader(section.columns, widths);
    if (section.rows.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(fontSize);
      doc.text(section.emptyText ?? 'No records.', left + 2, y + 3, {
        width: usable,
        lineBreak: false,
      });
      y += rowH;
    }
    for (const r of section.rows) {
      if (y + rowH > bottom()) {
        newPage();
        drawHeader(section.columns, widths);
      }
      const row = isPdfRow(r) ? r : { cells: r };
      drawCells(section.columns, widths, row.cells, row.bold ?? false);
    }
    if (section.totals) {
      if (y + rowH > bottom()) {
        newPage();
        drawHeader(section.columns, widths);
      }
      doc
        .moveTo(left, y)
        .lineTo(left + usable, y)
        .lineWidth(0.75)
        .stroke();
      drawCells(section.columns, widths, section.totals, true);
    }
    y += 10;
  });

  // Page numbers (and footer) on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const page = doc.page;
    page.margins.bottom = 0;
    const fy = page.height - MARGIN - fontSize;
    doc
      .font('Helvetica')
      .fontSize(Math.max(fontSize - 1, 6))
      .fillColor('#555555');
    if (spec.footer) {
      doc.text(fit(spec.footer, usable / 2), left, fy, { width: usable / 2, lineBreak: false });
    }
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + usable / 2, fy, {
      width: usable / 2,
      align: 'right',
      lineBreak: false,
    });
  }
  doc.end();
  return done;
}
