import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-zA-Z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const phoneSchema = z
  .string()
  .regex(/^\+?[0-9]{10,15}$/, 'Phone must be 10–15 digits, optional leading +')
  .transform((p) => (p.startsWith('+') ? p : `+91${p}`));

export const signupSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  phone: phoneSchema,
  password: passwordSchema,
  track: z.enum(['education', 'employed']).optional(),
  marketingConsent: z.boolean().optional().default(false),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const otpPurposeSchema = z.enum(['email_verify', 'phone_verify', 'password_reset']);

export const otpRequestSchema = z.object({
  destination: z.string().min(3).toLowerCase(),
  channel: z.enum(['sms', 'email']),
  purpose: otpPurposeSchema,
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  destination: z.string().min(3).toLowerCase(),
  purpose: otpPurposeSchema,
  code: z.string().regex(/^[0-9]{6}$/, 'Code must be 6 digits'),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const loginSchema = z.object({
  /** Email or phone */
  identifier: z.string().min(3).toLowerCase(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20) });
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({ refreshToken: z.string().min(20) });

export const forgotPasswordSchema = z.object({ email: z.string().email().toLowerCase() });

export const resetPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().regex(/^[0-9]{6}$/),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
