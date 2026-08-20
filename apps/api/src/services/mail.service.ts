import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../lib/logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: (env.SMTP_PORT ?? 587) === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends mail when SMTP is configured; otherwise logs so development still works. */
export async function sendMail(input: MailInput): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    logger.info({ to: input.to, subject: input.subject }, 'SMTP not configured - mail skipped');
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, ...input });
}
