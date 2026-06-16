export interface SendEmailParams {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
}

export interface SendSmsParams {
  /** E.164-ish Indian mobile, e.g. +91980… */
  to: string;
  /** Message matching the registered DLT template exactly. */
  message: string;
  dltTemplateId: string;
}

/** Every channel provider implements this and stays swappable. */
export interface EmailChannel {
  sendEmail(params: SendEmailParams): Promise<void>;
}

export interface SmsChannel {
  sendSms(params: SendSmsParams): Promise<void>;
}
