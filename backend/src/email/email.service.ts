import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get("SMTP_HOST"),
      port: this.configService.get("SMTP_PORT"),
      secure: this.configService.get("SMTP_PORT") === 465,
      auth: {
        user: this.configService.get("SMTP_USER"),
        pass: this.configService.get("SMTP_PASSWORD"),
      },
    });
  }

  async sendEmailVerification(
    email: string,
    firstName: string,
    verificationToken: string
  ) {
    const appUrl = this.configService.get("FRONTEND_URL");
    const verificationUrl = `${appUrl}/verify-email?token=${verificationToken}`;

    const mailOptions = {
      from: `"Capital Tracker" <${this.configService.get("SMTP_USER")}>`,
      to: email,
      subject: "Verify Your Email - Capital Tracker",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Welcome to Capital Tracker!</h1>
          <p>Hi ${firstName || "there"},</p>
          <p>Thank you for registering with Capital Tracker. To complete your registration and start managing your finances, please verify your email address.</p>
          <p>Click the button below to verify your email:</p>
          <a href="${verificationUrl}" style="display: inline-block; background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Verify Email</a>
          <p>Or copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
          <p style="color: #999; font-size: 14px; margin-top: 30px;">If you didn't create an account, please ignore this email.</p>
          <p>Best regards,<br>Capital Tracker Team</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Email verification sent to ${email}`);
    } catch (error) {
      console.error(`Failed to send verification email to ${email}:`, error);
      throw new Error("Failed to send verification email");
    }
  }

  async sendWelcomeEmail(email: string, firstName: string) {
    const appUrl = this.configService.get(
      "FRONTEND_URL",
      "http://localhost:3001"
    );

    const mailOptions = {
      from: `"Capital Tracker" <${this.configService.get("SMTP_USER")}>`,
      to: email,
      subject: "Welcome to Capital Tracker",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Welcome to Capital Tracker!</h1>
          <p>Hi ${firstName || "there"},</p>
          <p>Thank you for registering with Capital Tracker. We're excited to help you manage your finances!</p>
          <p>You can now log in to your account and start tracking your capital:</p>
          <a href="${appUrl}/login" style="display: inline-block; background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Go to Dashboard</a>
          <p>If you have any questions, feel free to reach out to us.</p>
          <p>Best regards,<br>Capital Tracker Team</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Welcome email sent to ${email}`);
    } catch (error) {
      console.error(`Failed to send welcome email to ${email}:`, error);
      // Don't throw error, just log it - email failure shouldn't block registration
    }
  }

  async sendPasswordResetEmail(email: string, resetToken: string) {
    const appUrl = this.configService.get(
      "FRONTEND_URL",
      "http://localhost:3001"
    );
    const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"Capital Tracker" <${this.configService.get("SMTP_USER")}>`,
      to: email,
      subject: "Password Reset Request",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Password Reset Request</h1>
          <p>You requested to reset your password for Capital Tracker.</p>
          <p>Click the button below to reset your password. This link will expire in 1 hour.</p>
          <a href="${resetUrl}" style="display: inline-block; background-color: #2196F3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Reset Password</a>
          <p>If you didn't request this, please ignore this email and your password will remain unchanged.</p>
          <p>For security reasons, the link will expire in 1 hour.</p>
          <p>Best regards,<br>Capital Tracker Team</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Password reset email sent to ${email}`);
    } catch (error) {
      console.error(`Failed to send password reset email to ${email}:`, error);
      throw new Error("Failed to send password reset email");
    }
  }

  async sendPasswordChangedEmail(email: string) {
    const appUrl = this.configService.get(
      "FRONTEND_URL",
      "http://localhost:3001"
    );

    const mailOptions = {
      from: `"Capital Tracker" <${this.configService.get("SMTP_USER")}>`,
      to: email,
      subject: "Password Changed Successfully",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Password Changed</h1>
          <p>Your password has been successfully changed.</p>
          <p>If you didn't make this change, please contact us immediately.</p>
          <a href="${appUrl}/login" style="display: inline-block; background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Go to Login</a>
          <p>Best regards,<br>Capital Tracker Team</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Password changed confirmation sent to ${email}`);
    } catch (error) {
      console.error(
        `Failed to send password changed email to ${email}:`,
        error
      );
      // Don't throw error, just log it
    }
  }
}
