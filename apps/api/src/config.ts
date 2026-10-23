import { resolve } from 'node:path';
import { databaseUrl, env } from './env';

/** Everything the app needs from the environment, passed explicitly so tests can override it. */
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  sessionSecret: string;
  encryptionKey: string;
  /** Send cookies with the Secure flag (true behind HTTPS in production). */
  cookieSecure: boolean;
  sessionTtlHours: number;
  uploadDir: string;
  backupDir: string;
  databaseUrl: string;
  /** Pre-fills the setup wizard. */
  adminEmail: string | null;
  /** Global and auth-route rate limits; disabled in tests. */
  rateLimit: boolean;
}

export function configFromEnv(): AppConfig {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  return {
    nodeEnv: env.NODE_ENV,
    sessionSecret: env.SESSION_SECRET,
    encryptionKey: env.ENCRYPTION_KEY,
    cookieSecure: env.NODE_ENV === 'production',
    sessionTtlHours: 12,
    uploadDir: process.env.UPLOAD_DIR ?? resolve(repoRoot, 'uploads'),
    backupDir: process.env.BACKUP_DIR ?? resolve(repoRoot, 'backups'),
    databaseUrl: databaseUrl(),
    adminEmail: process.env.ADMIN_EMAIL ?? null,
    rateLimit: env.NODE_ENV !== 'test',
  };
}
