import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly transporter: Transporter;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EmailService.name);

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: this.configService.get<boolean>('SMTP_SECURE', false),
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASSWORD'),
      },
    });
  }

  private get frontendUrl(): string {
    return this.configService.get<string>('FRONTEND_URL', 'http://localhost:3001');
  }

  private get fromAddress(): string {
    return `"Capital Tracker" <${this.configService.get<string>('SMTP_FROM') || this.configService.get<string>('SMTP_USER')}>`;
  }

  async sendEmailVerification(
    email: string,
    firstName: string | null,
    verificationToken: string,
  ): Promise<void> {
    const verificationUrl = `${this.frontendUrl}/verify-email?token=${verificationToken}`;

    const mailOptions = {
      from: this.fromAddress,
      to: email,
      subject: 'Verify Your Email - Capital Tracker',
      html: this.buildEmailTemplate({
        title: 'Welcome to Capital Tracker!',
        greeting: `Hi ${firstName || 'there'},`,
        content: `
          <p>Thank you for registering with Capital Tracker. To complete your registration and start managing your finances, please verify your email address.</p>
          <p>Click the button below to verify your email:</p>
        `,
        buttonText: 'Verify Email',
        buttonUrl: verificationUrl,
        buttonColor: '#4CAF50',
        footer: "If you didn't create an account, please ignore this email.",
      }),
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.info({ email }, 'Email verification sent');
    } catch (error) {
      this.logger.error({ error, email }, 'Failed to send verification email');
      throw new Error('Failed to send verification email');
    }
  }

  async sendWelcomeEmail(email: string, firstName: string | null): Promise<void> {
    const mailOptions = {
      from: this.fromAddress,
      to: email,
      subject: 'Welcome to Capital Tracker',
      html: this.buildEmailTemplate({
        title: 'Welcome to Capital Tracker!',
        greeting: `Hi ${firstName || 'there'},`,
        content: `
          <p>Thank you for registering with Capital Tracker. We're excited to help you manage your finances!</p>
          <p>You can now log in to your account and start tracking your capital:</p>
        `,
        buttonText: 'Go to Dashboard',
        buttonUrl: `${this.frontendUrl}/login`,
        buttonColor: '#4CAF50',
        footer: 'If you have any questions, feel free to reach out to us.',
      }),
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.info({ email }, 'Welcome email sent');
    } catch (error) {
      this.logger.error({ error, email }, 'Failed to send welcome email');
      // Don't throw error - email failure shouldn't block registration
    }
  }

  async sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
    const resetUrl = `${this.frontendUrl}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: this.fromAddress,
      to: email,
      subject: 'Password Reset Request',
      html: this.buildEmailTemplate({
        title: 'Password Reset Request',
        greeting: '',
        content: `
          <p>You requested to reset your password for Capital Tracker.</p>
          <p>Click the button below to reset your password. This link will expire in 1 hour.</p>
        `,
        buttonText: 'Reset Password',
        buttonUrl: resetUrl,
        buttonColor: '#2196F3',
        footer:
          "If you didn't request this, please ignore this email and your password will remain unchanged. For security reasons, the link will expire in 1 hour.",
      }),
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.info({ email }, 'Password reset email sent');
    } catch (error) {
      this.logger.error({ error, email }, 'Failed to send password reset email');
      throw new Error('Failed to send password reset email');
    }
  }

  async sendPasswordChangedEmail(email: string): Promise<void> {
    const mailOptions = {
      from: this.fromAddress,
      to: email,
      subject: 'Password Changed Successfully',
      html: this.buildEmailTemplate({
        title: 'Password Changed',
        greeting: '',
        content: `
          <p>Your password has been successfully changed.</p>
          <p>If you didn't make this change, please contact us immediately.</p>
        `,
        buttonText: 'Go to Login',
        buttonUrl: `${this.frontendUrl}/login`,
        buttonColor: '#4CAF50',
        footer: '',
      }),
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.info({ email }, 'Password changed confirmation sent');
    } catch (error) {
      this.logger.error({ error, email }, 'Failed to send password changed email');
      // Don't throw error - just log it
    }
  }

  private buildEmailTemplate(options: {
    title: string;
    greeting: string;
    content: string;
    buttonText: string;
    buttonUrl: string;
    buttonColor: string;
    footer: string;
  }): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">${options.title}</h1>
        ${options.greeting ? `<p>${options.greeting}</p>` : ''}
        ${options.content}
        <a href="${options.buttonUrl}" style="display: inline-block; background-color: ${options.buttonColor}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 20px 0;">${options.buttonText}</a>
        ${options.footer ? `<p style="color: #999; font-size: 14px; margin-top: 30px;">${options.footer}</p>` : ''}
        <p>Best regards,<br>Capital Tracker Team</p>
      </div>
    `;
  }
}
