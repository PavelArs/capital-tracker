import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { recordResetMail } from '../observability/metrics';

const RETRY_DELAY_MS = 5_000;
const TRANSIENT_REPLIES = new Set([421, 450, 451, 452]);
const TRANSIENT_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED']);

interface SmtpError {
  code?: unknown;
  responseCode?: unknown;
}

/** A refusal worth one more try: a dropped connection or a 4xx "try again later" reply. */
function transient({ code, responseCode }: SmtpError): boolean {
  if (code === 'EAUTH') return false;
  if (typeof responseCode === 'number') return TRANSIENT_REPLIES.has(responseCode);
  return typeof code === 'string' && TRANSIENT_CODES.has(code);
}

export interface ResetMailSettings {
  host: string;
  port: number;
  user: string | null;
  password: string | null;
  from: string | null;
}

// Yandex SMTP (Q5) with implicit TLS; credentials only ever come from the server environment.
export function resetMailSettings(env: (key: string) => string | undefined): ResetMailSettings {
  const text = (key: string) => {
    const value = env(key)?.trim();
    return value ? value : null;
  };
  const port = Number(text('SMTP_PORT') ?? 465);
  return {
    host: text('SMTP_HOST') ?? 'smtp.yandex.ru',
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 465,
    user: text('SMTP_USER'),
    password: text('SMTP_PASSWORD'),
    from: text('SMTP_FROM'),
  };
}

export function resetMessage(link: string): { subject: string; text: string } {
  return {
    subject: 'Reset your Capital Tracker password',
    text: [
      'Someone asked to reset the password of your Capital Tracker account.',
      '',
      'Set a new password here:',
      link,
      '',
      'The link works once and expires in 30 minutes. Signing in still needs your',
      'authenticator code, and every device signed in now will be signed out.',
      '',
      "If you didn't ask for this, ignore this email: your password stays the same.",
      '',
    ].join('\n'),
  };
}

/** Sends the reset link. Never logs the address, the link or the SMTP credentials. */
export class PasswordResetMailer {
  private readonly logger = new Logger(PasswordResetMailer.name);
  private readonly transport: Transporter | null;
  private readonly from: string | null;

  constructor(
    settings: ResetMailSettings,
    private readonly retryDelayMs = RETRY_DELAY_MS,
  ) {
    this.from = settings.from ?? settings.user;
    this.transport =
      settings.user && settings.password
        ? createTransport({
            host: settings.host,
            port: settings.port,
            secure: true,
            auth: { user: settings.user, pass: settings.password },
            tls: { minVersion: 'TLSv1.2', servername: settings.host },
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 20_000,
          })
        : null;
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  /**
   * Sends once and, after a transient refusal, once more. Never throws: the outcome is
   * visible only in logs and `ct_password_reset_mail_total`, never to the reset request.
   */
  async sendPasswordReset(to: string, link: string): Promise<void> {
    if (!this.transport || !this.from) {
      recordResetMail('unconfigured');
      this.logger.warn('Password reset email is not configured; set SMTP_USER and SMTP_PASSWORD');
      return;
    }
    const { subject, text } = resetMessage(link);
    const mail = { from: this.from, to, subject, text, textEncoding: 'base64' as const };
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.transport.sendMail(mail);
        recordResetMail('sent');
        return;
      } catch (error) {
        const code: SmtpError = (error as SmtpError) ?? {};
        const retry = attempt === 1 && transient(code);
        this.logger.warn(
          `Password reset email was not sent (${String(code.code ?? 'error')}${
            code.responseCode ? ` ${String(code.responseCode)}` : ''
          })${retry ? '; retrying once' : ''}`,
        );
        if (!retry) {
          recordResetMail('failed');
          return;
        }
        recordResetMail('retried');
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    }
  }
}
