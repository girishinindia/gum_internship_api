import jwt from 'jsonwebtoken';
import { env, isProd } from '../../config/env';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import type { RoleName } from '../../middlewares/auth';
import {
  generateOtp,
  generateRefreshToken,
  hashOtp,
  hashPassword,
  sha256,
  verifyPassword,
} from '../../services/crypto';
import { notifyService } from '../../services/notify';
import type { UserRow } from './repository';
import { authRepository as repo } from './repository';
import type {
  ChangePasswordInput,
  LoginInput,
  OtpRequestInput,
  OtpVerifyInput,
  ResetPasswordInput,
  SignupInput,
} from './schemas';

const OTP_HOURLY_LIMIT = 3; // per identifier per purpose (prompt 2.2 requirement)

export interface PublicUser {
  id: number;
  email: string | null;
  phone: string | null;
  fullName: string;
  avatarUrl: string | null;
  status: UserRow['status'];
  emailVerified: boolean;
  phoneVerified: boolean;
  track: UserRow['track'];
  resumeUrl: string | null;
  marketingConsent: boolean;
  roles: RoleName[];
  createdAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

/** Only when OTPs can't actually be delivered (dry run, non-prod) do we echo them. */
function devOtpMeta(codes: Record<string, string>): Record<string, unknown> | undefined {
  return env.NOTIFY_DRY_RUN && !isProd ? { dev: { otp: codes } } : undefined;
}

export async function toPublicUser(user: UserRow): Promise<PublicUser> {
  const roles = await repo.getUserRoles(user.id);
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    fullName: user.full_name,
    avatarUrl: user.avatar_url,
    status: user.status,
    emailVerified: user.email_verified_at !== null,
    phoneVerified: user.phone_verified_at !== null,
    track: user.track,
    resumeUrl: user.resume_url,
    marketingConsent: user.marketing_consent,
    roles,
    createdAt: user.created_at,
  };
}

function signAccessToken(userId: number, roles: RoleName[]): { token: string; expiresIn: number } {
  const expiresIn = env.JWT_ACCESS_TTL_MINUTES * 60;
  const token = jwt.sign({ roles }, env.JWT_ACCESS_SECRET, {
    subject: String(userId),
    expiresIn,
  });
  return { token, expiresIn };
}

async function issueTokens(
  user: UserRow,
  ctx: { userAgent: string | null; ip: string | null },
): Promise<AuthTokens> {
  const roles = await repo.getUserRoles(user.id);
  const { token: accessToken, expiresIn } = signAccessToken(user.id, roles);
  const refreshToken = generateRefreshToken();
  await repo.createSession({
    userId: user.id,
    refreshTokenHash: sha256(refreshToken),
    ttlDays: env.JWT_REFRESH_TTL_DAYS,
    userAgent: ctx.userAgent,
    ip: ctx.ip,
  });
  return { accessToken, refreshToken, expiresIn, user: await toPublicUser(user) };
}

async function issueOtp(input: {
  userId: number | null;
  destination: string;
  channel: 'sms' | 'email';
  purpose: OtpRequestInput['purpose'];
  fullName: string;
}): Promise<string> {
  const recent = await repo.countOtpsLastHour(input.destination, input.purpose);
  if ((recent?.n ?? 0) >= OTP_HOURLY_LIMIT) {
    throw new AppError(
      ErrorCodes.RATE_LIMITED,
      'Too many codes requested for this identifier — try again in an hour',
    );
  }
  const last = await repo.latestOtp(input.destination, input.purpose);
  if (last && Date.now() - new Date(last.created_at).getTime() < env.OTP_RESEND_COOLDOWN_SECONDS * 1000) {
    throw new AppError(
      ErrorCodes.RATE_LIMITED,
      `Please wait ${env.OTP_RESEND_COOLDOWN_SECONDS}s before requesting another code`,
    );
  }

  const code = generateOtp();
  await repo.insertOtp({
    userId: input.userId,
    destination: input.destination,
    channel: input.channel,
    purpose: input.purpose,
    codeHash: hashOtp(input.destination, code),
    ttlMinutes: env.OTP_TTL_MINUTES,
  });

  // purpose ('email_verify' | 'phone_verify' | 'password_reset') selects the
  // exact branded email template + DLT-approved SMS template downstream.
  if (input.channel === 'email') {
    await notifyService.sendOtpEmail(input.destination, input.fullName, code, input.purpose);
  } else {
    await notifyService.sendOtpSms(input.destination, input.fullName, code, input.purpose);
  }
  return code;
}

export const authService = {
  /** Signup → pending_verification + OTP on BOTH channels. */
  async signup(
    input: SignupInput,
  ): Promise<{ data: { userId: number; verificationRequired: true }; meta?: Record<string, unknown> }> {
    if (await repo.findUserByEmail(input.email)) {
      throw AppError.conflict('Email already registered');
    }
    if (await repo.findUserByPhone(input.phone)) {
      throw AppError.conflict('Phone already registered');
    }

    const user = await repo.createStudent({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      track: input.track ?? null,
      marketingConsent: input.marketingConsent,
    });

    const emailOtp = await issueOtp({
      userId: user.id,
      destination: input.email,
      channel: 'email',
      purpose: 'email_verify',
      fullName: input.fullName,
    });
    const phoneOtp = await issueOtp({
      userId: user.id,
      destination: input.phone,
      channel: 'sms',
      purpose: 'phone_verify',
      fullName: input.fullName,
    });

    return {
      data: { userId: user.id, verificationRequired: true },
      meta: devOtpMeta({ email: emailOtp, phone: phoneOtp }),
    };
  },

  /** Request/resend an OTP (rate limited: 60s cooldown + 3/hour per identifier). */
  async requestOtp(
    input: OtpRequestInput,
  ): Promise<{ data: { message: string }; meta?: Record<string, unknown> }> {
    const user =
      input.purpose === 'phone_verify'
        ? await repo.findUserByPhone(input.destination)
        : await repo.findUserByEmail(input.destination);

    // Never disclose whether an identifier exists (enumeration safety):
    if (!user) {
      return { data: { message: 'If the account exists, a code has been sent' } };
    }

    const code = await issueOtp({
      userId: user.id,
      destination: input.destination,
      channel: input.channel,
      purpose: input.purpose,
      fullName: user.full_name,
    });
    return {
      data: { message: 'Code sent' },
      meta: devOtpMeta({ [input.channel]: code }),
    };
  },

  /** Shared OTP check used by verify + password reset. Throws on any failure. */
  async assertValidOtp(input: OtpVerifyInput): Promise<void> {
    const otp = await repo.latestOtp(input.destination, input.purpose);
    if (!otp) {
      throw new AppError(ErrorCodes.OTP_INVALID, 'No active code — request a new one');
    }
    if (new Date(otp.expires_at).getTime() < Date.now()) {
      throw new AppError(ErrorCodes.OTP_EXPIRED, 'Code expired — request a new one');
    }
    if (otp.attempts >= env.OTP_MAX_VERIFY_ATTEMPTS) {
      throw new AppError(
        ErrorCodes.OTP_ATTEMPTS_EXHAUSTED,
        'Too many wrong attempts — request a new code',
      );
    }
    if (otp.code_hash !== hashOtp(input.destination, input.code)) {
      await repo.incrementOtpAttempts(otp.id);
      throw new AppError(ErrorCodes.OTP_INVALID, 'Incorrect code');
    }
    await repo.consumeOtp(otp.id);
  },

  /** Verify email/phone; first verified channel activates the account. */
  async verifyOtp(input: OtpVerifyInput): Promise<{ verified: 'email' | 'phone' }> {
    if (input.purpose === 'password_reset') {
      throw AppError.validation('Use /auth/password/reset for password reset codes');
    }
    const user =
      input.purpose === 'phone_verify'
        ? await repo.findUserByPhone(input.destination)
        : await repo.findUserByEmail(input.destination);
    if (!user) {
      throw new AppError(ErrorCodes.OTP_INVALID, 'Incorrect code');
    }

    await this.assertValidOtp(input);

    if (input.purpose === 'email_verify') {
      await repo.markEmailVerified(user.id);
      return { verified: 'email' };
    }
    await repo.markPhoneVerified(user.id);
    return { verified: 'phone' };
  },

  async login(
    input: LoginInput,
    ctx: { userAgent: string | null; ip: string | null },
  ): Promise<AuthTokens> {
    const user = input.identifier.includes('@')
      ? await repo.findUserByEmail(input.identifier)
      : await repo.findUserByPhone(
          input.identifier.startsWith('+') ? input.identifier : `+91${input.identifier}`,
        );

    if (!user?.password_hash || !(await verifyPassword(input.password, user.password_hash))) {
      throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Invalid email/phone or password');
    }
    if (user.status === 'pending_verification') {
      throw new AppError(
        ErrorCodes.VERIFICATION_PENDING,
        'Verify your email or phone before logging in',
      );
    }
    if (user.status === 'suspended' || user.status === 'deleted') {
      throw new AppError(ErrorCodes.ACCOUNT_SUSPENDED, 'This account is not active');
    }

    await repo.touchLastLogin(user.id);
    return issueTokens(user, ctx);
  },

  /** Rotation with reuse detection: a revoked token presented again nukes every session. */
  async refresh(
    refreshToken: string,
    ctx: { userAgent: string | null; ip: string | null },
  ): Promise<AuthTokens> {
    const session = await repo.findSessionByTokenHash(sha256(refreshToken));
    if (!session) {
      throw AppError.unauthorized('Invalid refresh token');
    }
    if (session.revoked_at) {
      await repo.revokeAllSessions(session.user_id);
      throw AppError.unauthorized('Refresh token reuse detected — all sessions revoked');
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      throw new AppError(ErrorCodes.TOKEN_EXPIRED, 'Refresh token expired — log in again');
    }

    const user = await repo.findUserById(session.user_id);
    if (!user || user.status === 'suspended' || user.status === 'deleted') {
      await repo.revokeAllSessions(session.user_id);
      throw new AppError(ErrorCodes.ACCOUNT_SUSPENDED, 'This account is not active');
    }

    await repo.revokeSession(session.id);
    return issueTokens(user, ctx);
  },

  async logout(refreshToken: string): Promise<void> {
    const session = await repo.findSessionByTokenHash(sha256(refreshToken));
    if (session && !session.revoked_at) {
      await repo.revokeSession(session.id);
    }
    // Idempotent: unknown/already-revoked tokens still return 200.
  },

  async logoutAll(userId: number): Promise<void> {
    await repo.revokeAllSessions(userId);
  },

  async forgotPassword(
    email: string,
  ): Promise<{ data: { message: string }; meta?: Record<string, unknown> }> {
    return this.requestOtp({ destination: email, channel: 'email', purpose: 'password_reset' });
  },

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const user = await repo.findUserByEmail(input.email);
    if (!user) {
      throw new AppError(ErrorCodes.OTP_INVALID, 'Incorrect code');
    }
    await this.assertValidOtp({
      destination: input.email,
      purpose: 'password_reset',
      code: input.code,
    });
    await repo.setPassword(user.id, await hashPassword(input.newPassword));
    await repo.revokeAllSessions(user.id); // every device must re-login
  },

  async changePassword(userId: number, input: ChangePasswordInput): Promise<void> {
    const user = await repo.findUserById(userId);
    if (!user?.password_hash || !(await verifyPassword(input.currentPassword, user.password_hash))) {
      throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Current password is incorrect');
    }
    await repo.setPassword(userId, await hashPassword(input.newPassword));
    await repo.revokeAllSessions(userId); // simplest safe policy in v1: re-login everywhere
  },
};
