import { env } from '../../config/env';
import { logger } from '../../core/logger';
import type { EmailChannel, SendEmailParams } from './types';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

/** Brevo transactional email over HTTPS API v3. */
export class BrevoEmailChannel implements EmailChannel {
  async sendEmail(params: SendEmailParams): Promise<void> {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
        to: [{ email: params.to, ...(params.toName ? { name: params.toName } : {}) }],
        subject: params.subject,
        htmlContent: params.htmlContent,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ status: res.status, body }, 'Brevo send failed');
      throw new Error(`Brevo responded ${res.status}`);
    }
  }
}
