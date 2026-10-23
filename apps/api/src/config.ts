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
  /**
   * Reverse proxies in front of the API. Production has two (aaPanel nginx, then the web
   * container's nginx); trusting exactly that many stops clients spoofing X-Forwarded-For to
   * dodge rate limits. `true` trusts every hop (local development only).
   */
  trustProxy: number | boolean;
  /** Global and auth-route rate limits; disabled in tests. */
  rateLimit: boolean;
}

export function configFromEnv(): AppConfig {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  return {
    nodeEnv: env.NODE_ENV,
    sessionSecret: env.SESSION_SECRET,
    encryptionKey: env.ENCRYPTION_KEY,
    // Secure cookies by default in production (aaPanel terminates HTTPS); COOKIE_SECURE overrides.
    cookieSecure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : env.NODE_ENV === 'production',
    sessionTtlHours: 12,
    uploadDir: process.env.UPLOAD_DIR ?? resolve(repoRoot, 'uploads'),
    backupDir: process.env.BACKUP_DIR ?? resolve(repoRoot, 'backups'),
    databaseUrl: databaseUrl(),
    adminEmail: process.env.ADMIN_EMAIL ?? null,
    trustProxy: process.env.TRUST_PROXY_HOPS ? Number(process.env.TRUST_PROXY_HOPS) : true,
    rateLimit: env.NODE_ENV !== 'test',
  };
}
