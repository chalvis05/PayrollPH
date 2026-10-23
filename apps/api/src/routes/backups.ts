import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { BackupSchema } from '@payrollph/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sessions, users } from '../db/schema';
import { writeAudit } from '../lib/audit';
import {
  BACKUP_NAME_RE,
  backupAndPrune,
  backupPath,
  deleteBackup,
  exclusive,
  listBackups,
  restoreBackup,
} from '../lib/backup';
import { badRequest, errorResponses, notFound, OkSchema } from '../lib/http';
import { SESSION_COOKIE } from '../lib/session';
import { ownerOnly, requireOwner } from '../plugins/auth';

const FileParamsSchema = z.object({
  file: z.string().regex(BACKUP_NAME_RE, 'Not a backup file name'),
});

const RestoreJsonSchema = z.object({
  file: z.string().regex(BACKUP_NAME_RE, 'Not a backup file name'),
  confirm: z.literal('RESTORE'),
});

/** Restored dumps can be large; the app-wide multipart limit is for documents. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export const backupRoutes: FastifyPluginAsyncZod = async (app) => {
  // Backups contain everything (incl. encrypted gov IDs): owner only, reads included.
  app.addHook('onRequest', ownerOnly);
  const dir = (): string => app.config.backupDir;

  app.get(
    '/',
    {
      schema: {
        tags: ['backups'],
        summary: 'Backup files, newest first',
        response: { 200: z.array(BackupSchema), ...errorResponses },
      },
    },
    async () => listBackups(dir()),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['backups'],
        summary: 'Back up the database now (pg_dump custom format), then apply retention',
        response: { 201: BackupSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const { backup } = await backupAndPrune(app.db, {
        backupDir: dir(),
        databaseUrl: app.config.databaseUrl,
        actorId: me.id,
        trigger: 'manual',
      });
      return reply.status(201).send(backup);
    },
  );

  app.get(
    '/:file',
    {
      schema: {
        tags: ['backups'],
        summary: 'Download a backup file',
        params: FileParamsSchema,
        produces: ['application/octet-stream'],
        response: { 200: z.unknown().describe('Backup file'), ...errorResponses },
      },
    },
    async (request, reply) => {
      const path = backupPath(dir(), request.params.file);
      const st = await stat(path).catch(() => null);
      if (!st?.isFile()) throw notFound('Backup');
      return reply
        .type('application/octet-stream')
        .header('content-length', st.size)
        .header('content-disposition', `attachment; filename="${request.params.file}"`)
        .header('cache-control', 'private, no-store')
        .send(createReadStream(path));
    },
  );

  app.delete(
    '/:file',
    {
      schema: {
        tags: ['backups'],
        summary: 'Delete a backup file',
        params: FileParamsSchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const removed = await deleteBackup(dir(), request.params.file);
      if (!removed) throw notFound('Backup');
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'backup.delete',
        entity: 'backup',
        entityId: request.params.file,
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/restore',
    {
      schema: {
        tags: ['backups'],
        summary:
          'Replace ALL data with a backup. JSON `{file, confirm: "RESTORE"}` for a stored backup, or multipart with a `file` upload and a `confirm` field.',
        // Not declared as `body`: multipart requests would fail JSON validation. Parsed below.
        response: { 200: z.object({ ok: z.literal(true), source: z.string() }), ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      let file: string;
      let source: string;
      let tempDir: string | null = null;

      try {
        if (request.isMultipart()) {
          tempDir = await mkdtemp(join(tmpdir(), 'payrollph-restore-'));
          let confirm: string | null = null;
          let uploaded: string | null = null;
          let uploadName = 'upload';
          for await (const part of request.parts({
            limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
          })) {
            if (part.type === 'file') {
              uploaded = join(tempDir, `${randomUUID()}.dump`);
              uploadName = part.filename || uploadName;
              await pipeline(part.file, createWriteStream(uploaded));
              if (part.file.truncated)
                throw badRequest('FILE_TOO_LARGE', 'The backup file is too large.');
            } else if (part.fieldname === 'confirm' && typeof part.value === 'string') {
              confirm = part.value;
            }
          }
          if (confirm !== 'RESTORE') {
            throw badRequest('CONFIRM_REQUIRED', 'Type RESTORE to confirm replacing all data.');
          }
          if (!uploaded) throw badRequest('FILE_REQUIRED', 'Attach a backup file.');
          file = uploaded;
          source = `upload:${uploadName}`;
        } else {
          const parsed = RestoreJsonSchema.safeParse(request.body);
          if (!parsed.success) {
            throw badRequest(
              'VALIDATION_ERROR',
              'Send {file, confirm: "RESTORE"} for a stored backup, or upload one with confirm=RESTORE.',
              parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            );
          }
          const body = parsed.data;
          file = backupPath(dir(), body.file);
          if (!(await stat(file).catch(() => null))?.isFile()) throw notFound('Backup');
          source = body.file;
        }

        await exclusive(() => restoreBackup(file, app.config.databaseUrl));
      } finally {
        if (tempDir) await rm(tempDir, { recursive: true, force: true });
      }

      // The dump carries the `sessions` table, so a restore would revive sessions that were
      // signed out or revoked since the backup. Sign everyone out instead.
      await app.db.delete(sessions);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });

      // Audit AFTER the restore so the entry survives. The acting user may not exist in the
      // restored data; then record them by email instead of a dangling foreign key.
      const [stillThere] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, me.id));
      await writeAudit(app.db, {
        actorId: stillThere ? me.id : null,
        action: 'backup.restore',
        entity: 'backup',
        entityId: source.startsWith('upload:') ? null : source,
        after: { source, restoredBy: me.email },
      });
      return { ok: true as const, source };
    },
  );
};
