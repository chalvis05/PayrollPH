import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';

/** SMTP settings as stored in settings.smtp (password encrypted). */
export const StoredSmtpSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  secure: z.boolean(),
  username: z.string().nullable(),
  passwordEnc: z.string().nullable(),
  fromAddress: z.string(),
});
export type StoredSmtp = z.infer<typeof StoredSmtpSchema>;

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Builds a Mailer from decrypted SMTP settings. Injectable so tests can capture mail. */
export type MailerFactory = (smtp: StoredSmtp & { password: string | null }) => Mailer;

export const smtpMailerFactory: MailerFactory = (smtp) => {
  const transport: Transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.username ? { auth: { user: smtp.username, pass: smtp.password ?? '' } } : {}),
  });
  return {
    async send(message) {
      await transport.sendMail({ from: smtp.fromAddress, ...message });
    },
  };
};
