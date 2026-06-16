import { env } from '../../config/env';
import { logger } from '../../core/logger';
import { SMS_TEMPLATES } from './templates';
import type { SmsTemplateName } from './templates';

/**
 * SMS Gateway Hub DLT sender — request shape matches the project's approved
 * integration exactly (route/channel/DCS/flashsms/EntityId/dlttemplateid).
 * Each flow uses its own pre-approved template id + verbatim text.
 */
export async function sendSmsDirect(
  mobile: string,
  name: string,
  otp: string,
  templateName: SmsTemplateName = 'user_registration',
): Promise<void> {
  const tpl = SMS_TEMPLATES[templateName];
  const phone = mobile.replace('+', '');
  const params = new URLSearchParams({
    APIKey: env.SMS_GATEWAY_HUB_API_KEY,
    senderid: env.SMS_GATEWAY_HUB_SENDER_ID,
    channel: env.SMS_CHANNEL,
    DCS: env.SMS_DCS,
    flashsms: env.SMS_FLASH,
    number: phone,
    text: tpl.message(name, otp),
    route: env.SMS_ROUTE,
    EntityId: env.SMS_DLT_ENTITY_ID,
    dlttemplateid: tpl.id,
  });
  const res = await fetch(`${env.SMS_GATEWAY_HUB_BASE_URL}?${params}`);
  const data = (await res.json().catch(() => ({}))) as { ErrorCode?: string; ErrorMessage?: string };
  if (data.ErrorCode && data.ErrorCode !== '000') {
    throw new Error('SMS failed: ' + (data.ErrorMessage || JSON.stringify(data)));
  }
  logger.info({ to: phone, templateName, dlt: tpl.id }, 'SMS dispatched');
}
