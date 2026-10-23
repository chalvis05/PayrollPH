/**
 * Backup CLI used by deploy/deploy.sh inside the API container:
 *   node dist/backup.js list
 *   node dist/backup.js create
 *   node dist/backup.js restore <payrollph-YYYYMMDD-HHmmss.dump>
 * Same code paths as the API routes: same files, retention, audit entries, and a restore
 * signs everyone out.
 */
import { stat } from 'node:fs/promises';
import { configFromEnv } from '../config';
import { createDb } from '../db/client';
import { sessions } from '../db/schema';
import { writeAudit } from '../lib/audit';
import {
  backupAndPrune,
  backupPath,
  exclusive,
  isBackupName,
  isCustomDump,
  listBackups,
  restoreBackup,
} from '../lib/backup';

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  const config = configFromEnv();
  const { db, sql } = createDb(config.databaseUrl);
  try {
    if (command === 'list') {
      const rows = await listBackups(config.backupDir);
      if (rows.length === 0) console.log('No backups yet.');
      for (const b of rows) console.log(`${b.name}  ${b.size} bytes  ${b.createdAt}`);
      return;
    }
    if (command === 'create') {
      const { backup, pruned } = await backupAndPrune(db, {
        backupDir: config.backupDir,
        databaseUrl: config.databaseUrl,
        actorId: null,
        trigger: 'manual',
      });
      console.log(`Created ${backup.name} (${backup.size} bytes).`);
      if (pruned.length > 0) console.log(`Deleted old backups: ${pruned.join(', ')}`);
      return;
    }
    if (command === 'restore') {
      if (!arg || !isBackupName(arg)) {
        throw new Error(
          'Usage: restore <payrollph-YYYYMMDD-HHmmss.dump> (a file in the backups volume)',
        );
      }
      const file = backupPath(config.backupDir, arg);
      if (!(await stat(file).catch(() => null))?.isFile())
        throw new Error(`Backup ${arg} not found.`);
      if (!(await isCustomDump(file)))
        throw new Error(`${arg} is not a pg_dump custom-format file.`);
      await exclusive(() => restoreBackup(file, config.databaseUrl));
      // The dump carries sessions; never let them come back after a restore.
      await db.delete(sessions);
      await writeAudit(db, {
        actorId: null,
        action: 'backup.restore',
        entity: 'backup',
        entityId: arg,
        after: { source: arg, restoredBy: 'deploy.sh' },
      });
      console.log(`Restored ${arg}. Everyone has been signed out.`);
      return;
    }
    throw new Error('Usage: backup.js list | create | restore <file>');
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
