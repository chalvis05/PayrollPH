import { buildApp } from './app';
import { configFromEnv } from './config';
import { createDb } from './db/client';
import { startNightlyBackup } from './jobs/nightlyBackup';

/** Production entry point: API on 0.0.0.0:$PORT plus the nightly backup job. */
async function main(): Promise<void> {
  const { db, sql } = createDb();
  const app = await buildApp({ db, config: configFromEnv(), logger: true });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ host: '0.0.0.0', port });
  const stopNightly = startNightlyBackup(app);

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await stopNightly();
      await app.close();
      await sql.end({ timeout: 5 });
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
