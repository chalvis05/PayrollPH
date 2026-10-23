import type { FastifyInstance } from 'fastify';
import cron from 'node-cron';
import { backupAndPrune } from '../lib/backup';

/** Every day at 02:00 Manila time. */
export const NIGHTLY_BACKUP_CRON = '0 2 * * *';

/** Run one nightly backup + retention prune. Never throws: failures are logged. */
export async function runNightlyBackup(app: FastifyInstance): Promise<void> {
  try {
    const { backup, pruned } = await backupAndPrune(app.db, {
      backupDir: app.config.backupDir,
      databaseUrl: app.config.databaseUrl,
      actorId: null,
      trigger: 'nightly',
    });
    app.log.info({ backup: backup.name, size: backup.size, pruned }, 'nightly backup done');
  } catch (err) {
    app.log.error({ err }, 'nightly backup failed');
  }
}

/** Schedule the nightly backup. Returns a function that stops the schedule. */
export function startNightlyBackup(app: FastifyInstance): () => Promise<void> {
  const task = cron.schedule(NIGHTLY_BACKUP_CRON, () => runNightlyBackup(app), {
    name: 'nightly-backup',
    timezone: 'Asia/Manila',
    noOverlap: true,
  });
  return async () => {
    await task.stop();
    await task.destroy();
  };
}
