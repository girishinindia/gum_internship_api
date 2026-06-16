import { env } from '../../config/env';

/**
 * Notification templates.
 *
 * SMS — EXACT DLT-approved registry (ids + message text MUST NOT change; they
 * are registered with the operator). Verbatim from the approved set.
 *
 * EMAIL — the exact light-blue HTML design provided, with the visible product
 * name driven by BRAND (set to "GI Internship" per the brand decision). The
 * registered SMS text is untouched and still references "Genius ITens (Grow Up
 * More)" because it is the approved template.
 */

const BRAND = 'GI Internship';
const COMPANY = 'Genius ITens';
const WEBSITE = 'growupmore.com';
const CITY = 'Surat, Gujarat, India';

// ── SMS: DLT registry (EXACT — do not edit ids or text) ──────────────────────
export const SMS_TEMPLATES = {
  user_registration: {
    id: '1207176585698936577',
    message: (name: string, otp: string) =>
      `Dear ${name}, OTP is for new user registration is ${otp}. Thank You, Genius ITens (Grow Up More)`,
  },
  forgot_password: {
    id: '1207177626145751532',
    message: (name: string, otp: string) =>
      `Dear ${name}, OTP is for password recovery is ${otp}. Thank You, Genius ITens (Grow Up More)`,
  },
  reset_password: {
    id: '1207177626029356961',
    message: (name: string, otp: string) =>
      `Dear ${name}, OTP to reset password is ${otp}. Thank You, Genius ITens (Grow Up More)`,
  },
  update_email: {
    id: '1207177626254116722',
    message: (name: string, otp: string) =>
      `Dear ${name}, OTP to update email is ${otp}. Thank You, Genius ITens (Grow Up More)`,
  },
  update_mobile: {
    id: '1207177626808992262',
    message: (name: string, otp: string) =>
      `Dear ${name}, OTP to update mobile number is ${otp}. Thank You, Genius ITens (Grow Up More)`,
  },
} as const;
export type SmsTemplateName = keyof typeof SMS_TEMPLATES;

// ── EMAIL: light-blue template system (exact design) ─────────────────────────
export type EmailPurpose =
  | 'registration'
  | 'forgot_password'
  | 'change_password'
  | 'update_email'
  | 'update_mobile'
  | 'welcome'
  | 'account_suspended'
  | 'account_reactivated';

interface EmailMeta {
  subject: (otp?: string) => string;
  heading: string;
  icon: string;
  message: (name: string) => string;
  otpLabel: string;
  footerNote: string;
}

const TEMPLATES: Record<EmailPurpose, EmailMeta> = {
  registration: {
    subject: (otp) => `${otp} — Verify Your Account | ${BRAND}`,
    heading: 'Verify Your Account',
    icon: '🎓',
    message: (name) => `Welcome to <strong>${BRAND}</strong>, ${name}! Please verify your email to complete registration.`,
    otpLabel: 'Verification Code',
    footerNote: 'If you did not create an account, you can safely ignore this email.',
  },
  forgot_password: {
    subject: (otp) => `${otp} — Password Recovery | ${BRAND}`,
    heading: 'Password Recovery',
    icon: '🔑',
    message: (name) => `Hi ${name}, we received a request to reset your password. Use the code below to proceed.`,
    otpLabel: 'Recovery Code',
    footerNote: 'If you did not request a password reset, please secure your account immediately.',
  },
  change_password: {
    subject: (otp) => `${otp} — Password Change Verification | ${BRAND}`,
    heading: 'Confirm Password Change',
    icon: '🔒',
    message: (name) => `Hi ${name}, you are changing your password. Please verify with the code below.`,
    otpLabel: 'Verification Code',
    footerNote: 'If you did not initiate this change, please secure your account and contact support.',
  },
  update_email: {
    subject: (otp) => `${otp} — Verify New Email | ${BRAND}`,
    heading: 'Verify New Email Address',
    icon: '✉️',
    message: (name) => `Hi ${name}, you requested to update your email address to this one. Please verify with the code below.`,
    otpLabel: 'Verification Code',
    footerNote: 'If you did not request this email change, ignore this message. Your account is safe.',
  },
  update_mobile: {
    subject: (otp) => `${otp} — Mobile Update Notification | ${BRAND}`,
    heading: 'Mobile Number Update',
    icon: '📱',
    message: (name) => `Hi ${name}, a mobile number update was initiated on your account. Use the code below to confirm.`,
    otpLabel: 'Verification Code',
    footerNote: 'If you did not request this change, please contact support immediately.',
  },
  welcome: {
    subject: () => `Welcome to ${BRAND}! 🎉`,
    heading: 'Welcome Aboard!',
    icon: '🚀',
    message: (name) => `Congratulations ${name}! Your account has been created successfully. Start learning today!`,
    otpLabel: '',
    footerNote: `Thank you for joining ${BRAND}. Happy learning!`,
  },
  account_suspended: {
    subject: () => `Account Suspended — ${BRAND}`,
    heading: 'Account Suspended',
    icon: '⚠️',
    message: (name) => `Hi ${name}, your ${BRAND} account has been suspended by an administrator. If you believe this is a mistake, please contact support.`,
    otpLabel: '',
    footerNote: `Contact ${env.BREVO_SENDER_EMAIL} for assistance.`,
  },
  account_reactivated: {
    subject: () => `Account Reactivated — ${BRAND}`,
    heading: 'Account Reactivated',
    icon: '✅',
    message: (name) => `Good news ${name}! Your ${BRAND} account has been reactivated. You can sign in now.`,
    otpLabel: '',
    footerNote: `Welcome back to ${BRAND}!`,
  },
};

export function buildEmail(purpose: EmailPurpose, name: string, otp?: string): { subject: string; html: string } {
  const t = TEMPLATES[purpose];
  const year = new Date().getFullYear();
  const expiryMin = env.OTP_TTL_MINUTES;

  const otpBlock = otp
    ? `
    <div style="margin:28px 0;">
      <div style="text-align:center;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#64748b;">${t.otpLabel}</span>
      </div>
      <div style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border:2px dashed #7dd3fc;border-radius:16px;padding:24px;text-align:center;">
        <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#0284c7;font-family:'Courier New',monospace;">${otp}</span>
      </div>
      <div style="text-align:center;margin-top:12px;">
        <span style="display:inline-flex;align-items:center;gap:4px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;">
          ⏱ Valid for ${expiryMin} minutes
        </span>
      </div>
    </div>`
    : '';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="height:4px;background:linear-gradient(90deg,#0284c7,#0ea5e9,#38bdf8);border-radius:4px 4px 0 0;"></div>
    <div style="background:#ffffff;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.06);overflow:hidden;">
      <div style="background:linear-gradient(135deg,#0284c7 0%,#0ea5e9 50%,#38bdf8 100%);padding:32px 40px;text-align:center;">
        <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:16px;display:inline-flex;align-items:center;justify-content:center;font-size:28px;border:1px solid rgba(255,255,255,0.3);">${t.icon}</div>
        <h1 style="color:#ffffff;font-size:24px;font-weight:700;margin:16px 0 0;letter-spacing:-0.5px;">${t.heading}</h1>
      </div>
      <div style="padding:36px 40px;">
        <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 4px;">${t.message(name)}</p>
        ${otpBlock}
        <div style="background:#f8fafc;border-left:3px solid #0ea5e9;border-radius:0 8px 8px 0;padding:14px 16px;margin-top:24px;">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            <span style="font-size:14px;margin-top:1px;">🛡️</span>
            <div>
              <span style="font-size:13px;font-weight:600;color:#0f172a;display:block;margin-bottom:2px;">Security Notice</span>
              <span style="font-size:12px;color:#64748b;line-height:1.5;">Never share this code with anyone. ${BRAND} team will never ask for your OTP via call, SMS, or email.</span>
            </div>
          </div>
        </div>
      </div>
      <div style="height:1px;background:linear-gradient(90deg,transparent,#e2e8f0,transparent);margin:0 40px;"></div>
      <div style="padding:24px 40px 32px;text-align:center;">
        <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0 0 16px;">${t.footerNote}</p>
        <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border-radius:24px;">
          <span style="font-size:16px;">🎓</span>
          <span style="font-size:13px;font-weight:700;color:#0284c7;letter-spacing:-0.3px;">${BRAND}</span>
          <span style="color:#cbd5e1;">|</span>
          <span style="font-size:11px;color:#64748b;">by ${COMPANY}</span>
        </div>
        <div style="margin-top:16px;">
          <a href="https://${WEBSITE}" style="color:#0ea5e9;font-size:12px;text-decoration:none;font-weight:500;">${WEBSITE}</a>
          <span style="color:#e2e8f0;margin:0 8px;">·</span>
          <span style="color:#94a3b8;font-size:11px;">${CITY}</span>
        </div>
        <p style="color:#cbd5e1;font-size:11px;margin:12px 0 0;">&copy; ${year} ${COMPANY}. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`.trim();

  return { subject: otp ? t.subject(otp) : t.subject(), html };
}
