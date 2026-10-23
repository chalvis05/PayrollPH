import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EmployeeDocumentSchema } from '@payrollph/shared';
import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { employeeDocuments, employees } from '../db/schema';
import { writeAudit } from '../lib/audit';
import {
  badRequest,
  ErrorResponseSchema,
  errorResponses,
  HttpError,
  IdParamsSchema,
  notFound,
  OkSchema,
} from '../lib/http';
import { requireOwner } from '../plugins/auth';

type DocumentRow = typeof employeeDocuments.$inferSelect;

/** Allowed types, recognised by their leading bytes (the client's mime type is ignored). */
const SIGNATURES: { mime: string; ext: string; magic: number[] }[] = [
  { mime: 'application/pdf', ext: 'pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mime: 'image/png', ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
];

export function sniffType(buf: Buffer): { mime: string; ext: string } | null {
  for (const s of SIGNATURES) {
    if (buf.length >= s.magic.length && s.magic.every((b, i) => buf[i] === b)) {
      return { mime: s.mime, ext: s.ext };
    }
  }
  return null;
}

/** Keep only the base name, drop control/quote/path characters, cap the length. */
export function sanitiseFileName(raw: string | undefined): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|:*?;]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 200);
  return cleaned === '' ? 'document' : cleaned;
}

/** RFC 6266 header: ASCII fallback plus the UTF-8 name. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/[\\%]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function toDto(d: DocumentRow): z.infer<typeof EmployeeDocumentSchema> {
  return {
    id: d.id,
    employeeId: d.employeeId,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    uploadedAt: d.uploadedAt.toISOString(),
  };
}

const auditMeta = (d: DocumentRow) => ({
  employeeId: d.employeeId,
  fileName: d.fileName,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
});

export const documentRoutes: FastifyPluginAsyncZod = async (app) => {
  const pathFor = (storedName: string) => join(app.config.uploadDir, storedName);

  const assertEmployee = async (id: string) => {
    const [emp] = await app.db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.id, id));
    if (!emp) throw notFound('Employee');
  };

  app.get(
    '/employees/:id/documents',
    {
      schema: {
        tags: ['documents'],
        summary: "An employee's documents (newest first)",
        params: IdParamsSchema,
        response: { 200: z.array(EmployeeDocumentSchema), ...errorResponses },
      },
    },
    async (request) => {
      await assertEmployee(request.params.id);
      const rows = await app.db
        .select()
        .from(employeeDocuments)
        .where(eq(employeeDocuments.employeeId, request.params.id))
        .orderBy(desc(employeeDocuments.uploadedAt));
      return rows.map(toDto);
    },
  );

  app.post(
    '/employees/:id/documents',
    {
      schema: {
        tags: ['documents'],
        summary: 'Upload a PDF, PNG or JPEG (multipart field "file", max 10 MB)',
        consumes: ['multipart/form-data'],
        params: IdParamsSchema,
        response: { 201: EmployeeDocumentSchema, ...errorResponses, 415: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const employeeId = request.params.id;
      await assertEmployee(employeeId);
      const file = await request.file();
      if (!file) throw badRequest('NO_FILE', 'Attach a file.');
      const buffer = await file.toBuffer();
      if (buffer.length === 0) throw badRequest('EMPTY_FILE', 'The file is empty.');
      const type = sniffType(buffer);
      if (!type) {
        throw new HttpError(
          415,
          'UNSUPPORTED_FILE_TYPE',
          'Only PDF, PNG and JPEG files can be uploaded.',
        );
      }
      const fileName = sanitiseFileName(file.filename);
      const storedName = `${randomUUID()}.${type.ext}`;
      await mkdir(app.config.uploadDir, { recursive: true });
      await writeFile(pathFor(storedName), buffer, { flag: 'wx' });
      try {
        const row = await app.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(employeeDocuments)
            .values({
              employeeId,
              fileName,
              storedName,
              mimeType: type.mime,
              sizeBytes: buffer.length,
            })
            .returning();
          if (!created) throw new Error('Document insert returned no row');
          await writeAudit(tx, {
            actorId: me.id,
            action: 'document.upload',
            entity: 'employee_document',
            entityId: created.id,
            after: auditMeta(created),
          });
          return created;
        });
        return reply.status(201).send(toDto(row));
      } catch (err) {
        await unlink(pathFor(storedName)).catch(() => undefined);
        throw err;
      }
    },
  );

  app.get(
    '/documents/:id',
    {
      schema: {
        tags: ['documents'],
        summary: 'Download a document',
        produces: ['application/pdf', 'image/png', 'image/jpeg'],
        params: IdParamsSchema,
        response: { 200: z.unknown().describe('The file bytes'), ...errorResponses },
      },
    },
    async (request, reply) => {
      const [doc] = await app.db
        .select()
        .from(employeeDocuments)
        .where(eq(employeeDocuments.id, request.params.id));
      if (!doc) throw notFound('Document');
      let data: Buffer;
      try {
        data = await readFile(pathFor(doc.storedName));
      } catch {
        throw notFound('Document file');
      }
      return reply
        .header('content-type', doc.mimeType)
        .header('content-disposition', contentDisposition(doc.fileName))
        .header('cache-control', 'private, no-store')
        .send(data);
    },
  );

  app.delete(
    '/documents/:id',
    {
      schema: {
        tags: ['documents'],
        summary: 'Delete a document and its file',
        params: IdParamsSchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const doc = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(employeeDocuments)
          .where(eq(employeeDocuments.id, request.params.id))
          .for('update');
        if (!row) throw notFound('Document');
        await tx.delete(employeeDocuments).where(eq(employeeDocuments.id, row.id));
        await writeAudit(tx, {
          actorId: me.id,
          action: 'document.delete',
          entity: 'employee_document',
          entityId: row.id,
          before: auditMeta(row),
        });
        return row;
      });
      // Remove the file only after the row is gone for good; a missing file is fine.
      await unlink(pathFor(doc.storedName)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') request.log.warn({ err }, 'Could not remove document file');
      });
      return { ok: true as const };
    },
  );
};
