import { env, isProd } from '../../config/env';
import { logger } from '../../core/logger';
import { BrevoEmailChannel } from './emailBrevo';
import { sendSmsDirect } from './smsGatewayHub';
import { buildEmail } from './templates';
import type { EmailPurpose, SmsTemplateName } from './templates';
import type { EmailChannel } from './types';

const email: EmailChannel = new BrevoEmailChannel();

/** OTP purpose (internal) → email + SMS DLT template names. */
type OtpPurpose = 'email_verify' | 'phone_verify' | 'password_reset';
const EMAIL_PURPOSE: Record<OtpPurpose, EmailPurpose> = {
  email_verify: 'registration',
  phone_verify: 'registration',
  password_reset: 'forgot_password',
};
const SMS_PURPOSE: Record<OtpPurpose, SmsTemplateName> = {
  email_verify: 'user_registration',
  phone_verify: 'user_registration',
  password_reset: 'forgot_password',
};

const emailDry = (): boolean => env.NOTIFY_DRY_RUN || env.EMAIL_DRY_RUN;
// SMS sends for real only when not dry AND (master not dry) — SMS_FORCE_SEND
// can override the safe-off default once a real test number is in play.
const smsDry = (): boolean => env.NOTIFY_DRY_RUN || (env.SMS_DRY_RUN && !env.SMS_FORCE_SEND);

export const notifyService = {
  /** OTP email using the exact branded template, keyed by purpose. */
  async sendOtpEmail(to: string, name: string, code: string, purpose: OtpPurpose | string = 'email_verify'): Promise<void> {
    const p = (EMAIL_PURPOSE[purpose as OtpPurpose] ?? 'registration') as EmailPurpose;
    const { subject, html } = buildEmail(p, name, code);
    if (emailDry()) {
      logger.info({ to, subject, ...(isProd ? {} : { code }) }, '[DRY RUN] OTP email');
      return;
    }
    try {
      await email.sendEmail({ to, toName: name, subject, htmlContent: html });
      logger.info({ to, purpose: p }, 'OTP email sent');
    } catch (err) {
      logger.error({ err, to }, 'OTP email failed (non-fatal)');
    }
  },

  /** OTP SMS using the exact DLT-approved template, keyed by purpose. */
  async sendOtpSms(to: string, name: string, code: string, purpose: OtpPurpose | string = 'phone_verify'): Promise<void> {
    const tpl = SMS_PURPOSE[purpose as OtpPurpose] ?? 'user_registration';
    if (smsDry()) {
      logger.info({ to, tpl, ...(isProd ? {} : { code }) }, '[DRY RUN] OTP sms');
      return;
    }
    try {
      await sendSmsDirect(to, name, code, tpl);
    } catch (err) {
      logger.error({ err, to }, 'OTP sms failed (non-fatal)');
    }
  },

  /** Generic transactional email (offer letters, invoices, certificates…). */
  async sendEmail(to: string, toName: string, subject: string, htmlContent: string): Promise<void> {
    if (emailDry()) {
      logger.info({ to, subject }, '[DRY RUN] email');
      return;
    }
    try {
      await email.sendEmail({ to, toName, subject, htmlContent });
    } catch (err) {
      logger.error({ err, to, subject }, 'email failed (non-fatal)');
    }
  },

  /** Branded non-OTP notification email (welcome / suspended / reactivated). */
  async sendBrandedEmail(to: string, name: string, purpose: EmailPurpose): Promise<void> {
    const { subject, html } = buildEmail(purpose, name);
    return this.sendEmail(to, name, subject, html);
  },
};
