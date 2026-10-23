import { stringify } from 'csv-stringify/sync';
import type { FastifyReply } from 'fastify';
import { renderTablePdf } from '../../lib/pdf/table';
import type { ReportDoc } from './common';

export type ReportFormat = 'csv' | 'pdf';

/** UTF-8 CSV with a header row (and a BOM so Excel shows ñ correctly). */
export function toCsv(doc: ReportDoc): string {
  return stringify([doc.csv.header, ...doc.csv.rows], { bom: true });
}

/** Send a report as a file download. */
export async function sendReport(
  reply: FastifyReply,
  doc: ReportDoc,
  format: ReportFormat,
): Promise<FastifyReply> {
  const safe = doc.fileBase.replace(/[^A-Za-z0-9._-]/g, '_');
  if (format === 'csv') {
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${safe}.csv"`)
      .send(toCsv(doc));
  }
  const pdf = await renderTablePdf(doc.pdf);
  return reply
    .type('application/pdf')
    .header('content-disposition', `attachment; filename="${safe}.pdf"`)
    .send(pdf);
}
