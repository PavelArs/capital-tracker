import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

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

  constructor(settings: ResetMailSettings) {
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

  async sendPasswordReset(to: string, link: string): Promise<void> {
    if (!this.transport || !this.from) {
      this.logger.warn('Password reset email is not configured; set SMTP_USER and SMTP_PASSWORD');
      return;
    }
    const { subject, text } = resetMessage(link);
    try {
      await this.transport.sendMail({ from: this.from, to, subject, text, textEncoding: 'base64' });
    } catch (error) {
      const code = (error as { code?: unknown; responseCode?: unknown }) ?? {};
      this.logger.warn(
        `Password reset email was not sent (${String(code.code ?? 'error')}${
          code.responseCode ? ` ${String(code.responseCode)}` : ''
        })`,
      );
    }
  }
}
