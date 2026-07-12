import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Email behind an adapter (tech-stack.md). Dev uses Mailpit's SMTP sink
 * (localhost:1025 by default) so receipts are inspectable at Mailpit's web UI;
 * prod swaps SMTP_URL for Resend/SES at deploy. All config is env-driven.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly from = process.env.MAIL_FROM ?? 'receipts@retailos.local';
  private transporter: Transporter | null = null;

  private transport(): Transporter {
    if (!this.transporter) {
      const url = process.env.SMTP_URL ?? 'smtp://localhost:1025';
      this.transporter = createTransport(url);
    }
    return this.transporter;
  }

  async send(message: { to: string; subject: string; html: string; text: string }): Promise<void> {
    await this.transport().sendMail({ from: this.from, ...message });
    this.logger.log(`receipt email sent to ${message.to}`);
  }
}
