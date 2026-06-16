import type { PoolClient } from 'pg';
import { query, queryOne, tx } from '../../db/pool';
import type { RoleName } from '../../middlewares/auth';

export interface UserRow {
  id: number;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  full_name: string;
  avatar_url: string | null;
  status: 'active' | 'suspended' | 'deleted' | 'pending_verification';
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  marketing_consent: boolean;
  track: 'education' | 'employed' | null;
  resume_url: string | null;
  last_login_at: Date | null;
  totp_enabled: boolean;
  created_at: Date;
}

export interface OtpRow {
  id: number;
  user_id: number | null;
  destination: string;
  channel: 'sms' | 'email';
  purpose: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

export interface SessionRow {
  id: number;
  user_id: number;
  refresh_token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

const USER_COLS = `id, email, phone, password_hash, full_name, avatar_url, status,
  email_verified_at, phone_verified_at, marketing_consent, track, resume_url,
  last_login_at, totp_enabled, created_at`;

export const authRepository = {
  findUserByEmail(email: string): Promise<UserRow | null> {
    return queryOne<UserRow>(`select ${USER_COLS} from users where email = $1`, [email]);
  },

  findUserByPhone(phone: string): Promise<UserRow | null> {
    return queryOne<UserRow>(`select ${USER_COLS} from users where phone = $1`, [phone]);
  },

  findUserById(id: number): Promise<UserRow | null> {
    return queryOne<UserRow>(`select ${USER_COLS} from users where id = $1`, [id]);
  },

  async getUserRoles(userId: number): Promise<RoleName[]> {
    const rows = await query<{ name: RoleName }>(
      `select r.name from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1`,
      [userId],
    );
    return rows.map((r) => r.name);
  },

  // --- 2FA (TOTP) ---
  findTotp(userId: number): Promise<{ totp_secret: string | null; totp_enabled: boolean; totp_backup_codes: string[] } | null> {
    return queryOne(`select totp_secret, totp_enabled, totp_backup_codes from users where id = $1`, [userId]);
  },
  /** Store a pending (not-yet-enabled) encrypted secret, clearing any old codes. */
  setTotpSecret(userId: number, encryptedSecret: string): Promise<unknown> {
    return query(`update users set totp_secret = $2, totp_enabled = false, totp_backup_codes = '{}' where id = $1`, [userId, encryptedSecret]);
  },
  enableTotp(userId: number, backupHashes: string[]): Promise<unknown> {
    return query(`update users set totp_enabled = true, totp_backup_codes = $2 where id = $1`, [userId, backupHashes]);
  },
  disableTotp(userId: number): Promise<unknown> {
    return query(`update users set totp_secret = null, totp_enabled = false, totp_backup_codes = '{}' where id = $1`, [userId]);
  },
  /** Atomically spend a one-time backup code (hash). Returns true if it matched. */
  async consumeBackupCode(userId: number, hash: string): Promise<boolean> {
    const r = await queryOne<{ id: number }>(
      `update users set totp_backup_codes = array_remove(totp_backup_codes, $2)
       where id = $1 and $2 = any(totp_backup_codes) returning id`,
      [userId, hash],
    );
    return r !== null;
  },

  /** Signup: user + student role, atomically. */
  createStudent(input: {
    fullName: string;
    email: string;
    phone: string;
    passwordHash: string;
    track: 'education' | 'employed' | null;
    marketingConsent: boolean;
  }): Promise<UserRow> {
    return tx(async (c: PoolClient) => {
      const userRes = await c.query<UserRow>(
        `insert into users (full_name, email, phone, password_hash, status, track, marketing_consent)
         values ($1, $2, $3, $4, 'pending_verification', $5, $6)
         returning ${USER_COLS}`,
        [input.fullName, input.email, input.phone, input.passwordHash, input.track, input.marketingConsent],
      );
      const user = userRes.rows[0];
      if (!user) throw new Error('insert users returned no row');
      await c.query(
        `insert into user_roles (user_id, role_id)
         select $1, id from roles where name = 'student'`,
        [user.id],
      );
      return user;
    });
  },

  countOtpsLastHour(destination: string, purpose: string): Promise<{ n: number } | null> {
    return queryOne<{ n: number }>(
      `select count(*)::int8 as n from otp_codes
       where destination = $1 and purpose = $2 and created_at > now() - interval '1 hour'`,
      [destination, purpose],
    );
  },

  latestOtp(destination: string, purpose: string): Promise<OtpRow | null> {
    return queryOne<OtpRow>(
      `select * from otp_codes
       where destination = $1 and purpose = $2 and consumed_at is null
       order by created_at desc limit 1`,
      [destination, purpose],
    );
  },

  /** Issue a new OTP and supersede any previous unconsumed one for the pair. */
  insertOtp(input: {
    userId: number | null;
    destination: string;
    channel: 'sms' | 'email';
    purpose: string;
    codeHash: string;
    ttlMinutes: number;
  }): Promise<OtpRow> {
    return tx(async (c) => {
      await c.query(
        `update otp_codes set consumed_at = now()
         where destination = $1 and purpose = $2 and consumed_at is null`,
        [input.destination, input.purpose],
      );
      const res = await c.query<OtpRow>(
        `insert into otp_codes (user_id, destination, channel, purpose, code_hash, expires_at)
         values ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)
         returning *`,
        [input.userId, input.destination, input.channel, input.purpose, input.codeHash, input.ttlMinutes],
      );
      const row = res.rows[0];
      if (!row) throw new Error('insert otp_codes returned no row');
      return row;
    });
  },

  incrementOtpAttempts(id: number): Promise<unknown> {
    return query(`update otp_codes set attempts = attempts + 1 where id = $1`, [id]);
  },

  consumeOtp(id: number): Promise<unknown> {
    return query(`update otp_codes set consumed_at = now() where id = $1`, [id]);
  },

  markEmailVerified(userId: number): Promise<unknown> {
    return query(
      `update users set email_verified_at = now(),
         status = case when status = 'pending_verification' then 'active'::user_status else status end
       where id = $1`,
      [userId],
    );
  },

  markPhoneVerified(userId: number): Promise<unknown> {
    return query(
      `update users set phone_verified_at = now(),
         status = case when status = 'pending_verification' then 'active'::user_status else status end
       where id = $1`,
      [userId],
    );
  },

  touchLastLogin(userId: number): Promise<unknown> {
    return query(`update users set last_login_at = now() where id = $1`, [userId]);
  },

  createSession(input: {
    userId: number;
    refreshTokenHash: string;
    ttlDays: number;
    userAgent: string | null;
    ip: string | null;
  }): Promise<SessionRow> {
    return queryOne<SessionRow>(
      `insert into user_sessions (user_id, refresh_token_hash, expires_at, user_agent, ip_address)
       values ($1, $2, now() + ($3 || ' days')::interval, $4, $5)
       returning id, user_id, refresh_token_hash, expires_at, revoked_at`,
      [input.userId, input.refreshTokenHash, input.ttlDays, input.userAgent, input.ip],
    ) as Promise<SessionRow>;
  },

  findSessionByTokenHash(hash: string): Promise<SessionRow | null> {
    return queryOne<SessionRow>(
      `select id, user_id, refresh_token_hash, expires_at, revoked_at
       from user_sessions where refresh_token_hash = $1`,
      [hash],
    );
  },

  revokeSession(id: number): Promise<unknown> {
    return query(`update user_sessions set revoked_at = now() where id = $1 and revoked_at is null`, [id]);
  },

  revokeAllSessions(userId: number, exceptSessionId?: number): Promise<unknown> {
    if (exceptSessionId !== undefined) {
      return query(
        `update user_sessions set revoked_at = now()
         where user_id = $1 and id <> $2 and revoked_at is null`,
        [userId, exceptSessionId],
      );
    }
    return query(
      `update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`,
      [userId],
    );
  },

  setPassword(userId: number, passwordHash: string): Promise<unknown> {
    return query(`update users set password_hash = $1 where id = $2`, [passwordHash, userId]);
  },
};
