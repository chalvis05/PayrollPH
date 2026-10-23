import type { AppConfig } from './config';
import type { Db } from './db/client';
import type { FieldCipher } from './lib/crypto';
import type { MailerFactory } from './lib/mailer';
import type { SessionUser } from './lib/session';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
    cipher: FieldCipher;
    mailerFactory: MailerFactory;
  }
  interface FastifyRequest {
    /** Set by the session hook when a valid session cookie is present. */
    user: SessionUser | null;
    /** Raw session token from the cookie (for logout). */
    sessionToken: string | null;
  }
}
