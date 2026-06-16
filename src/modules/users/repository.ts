import { query, queryOne } from '../../db/pool';
import type { UserRow } from '../auth/repository';
import type { AdminUserListInput, UpdateMeInput } from './schemas';

export interface InstructorProfileRow {
  id: number;
  user_id: number;
  instructor_type: 'internal' | 'external';
  bio: string | null;
  expertise: string[];
  linkedin_url: string | null;
  website_url: string | null;
  kyc_status: 'pending' | 'submitted' | 'approved' | 'rejected';
  kyc_documents: unknown;
  gstin: string | null;
  bank_account_name: string | null;
  bank_account_last4: string | null;
  bank_ifsc: string | null;
  agreement_status: 'pending' | 'sent' | 'signed';
  revenue_share_percent: string;
  rejection_reason: string | null;
  created_at: Date;
}

const USER_COLS = `id, email, phone, password_hash, full_name, avatar_url, status,
  email_verified_at, phone_verified_at, marketing_consent, track, resume_url,
  last_login_at, created_at`;

export const usersRepository = {
  async updateMe(userId: number, input: UpdateMeInput): Promise<UserRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (sql: string, value: unknown): void => {
      params.push(value);
      sets.push(`${sql} = $${params.length}`);
    };
    if (input.fullName !== undefined) push('full_name', input.fullName);
    if (input.avatarUrl !== undefined) push('avatar_url', input.avatarUrl);
    if (input.track !== undefined) push('track', input.track);
    if (input.resumeUrl !== undefined) push('resume_url', input.resumeUrl);
    if (input.marketingConsent !== undefined) push('marketing_consent', input.marketingConsent);
    params.push(userId);
    return queryOne<UserRow>(
      `update users set ${sets.join(', ')} where id = $${params.length} returning ${USER_COLS}`,
      params,
    );
  },

  async adminList(
    input: AdminUserListInput,
  ): Promise<{ rows: (UserRow & { roles: string[] })[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): string => {
      params.push(value);
      return sql.replaceAll('$N', `$${params.length}`);
    };

    if (input.q) {
      where.push(
        add(`(u.full_name ilike $N or u.email::text ilike $N or u.phone ilike $N)`, `%${input.q}%`),
      );
    }
    if (input.status) where.push(add(`u.status = $N`, input.status));
    if (input.track) where.push(add(`u.track = $N`, input.track));
    if (input.role) {
      where.push(
        add(
          `exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                   where ur.user_id = u.id and r.name = $N)`,
          input.role,
        ),
      );
    }
    const whereSql = where.length ? `where ${where.join(' and ')}` : '';

    const totalRow = await queryOne<{ n: number }>(
      `select count(*)::int8 as n from users u ${whereSql}`,
      params,
    );

    const offset = (input.page - 1) * input.limit;
    const rows = await query<UserRow & { roles: string[] }>(
      `select u.id, u.email, u.phone, u.full_name, u.avatar_url, u.status,
              u.email_verified_at, u.phone_verified_at, u.marketing_consent,
              u.track, u.resume_url, u.last_login_at, u.created_at,
              coalesce(array_agg(r.name order by r.name) filter (where r.name is not null), '{}') as roles
       from users u
       left join user_roles ur on ur.user_id = u.id
       left join roles r on r.id = ur.role_id
       ${whereSql}
       group by u.id
       order by u.created_at desc
       limit ${input.limit} offset ${offset}`,
      params,
    );
    return { rows, total: totalRow?.n ?? 0 };
  },

  findInstructorProfileByUserId(userId: number): Promise<InstructorProfileRow | null> {
    return queryOne<InstructorProfileRow>(
      `select id, user_id, instructor_type, bio, expertise, linkedin_url, website_url,
              kyc_status, kyc_documents, gstin, bank_account_name, bank_account_last4,
              bank_ifsc, agreement_status, revenue_share_percent, rejection_reason, created_at
       from instructor_profiles where user_id = $1`,
      [userId],
    );
  },

  createInstructorApplication(input: {
    userId: number;
    bio: string;
    expertise: string[];
    linkedinUrl: string | null;
    websiteUrl: string | null;
    panEncrypted: string;
    gstin: string | null;
    bankAccountName: string;
    bankAccountEncrypted: string;
    bankAccountLast4: string;
    bankIfsc: string;
    kycDocuments: unknown;
  }): Promise<InstructorProfileRow> {
    return queryOne<InstructorProfileRow>(
      `insert into instructor_profiles
         (user_id, instructor_type, bio, expertise, linkedin_url, website_url,
          kyc_status, pan_number_encrypted, gstin, bank_account_name,
          bank_account_number_encrypted, bank_account_last4, bank_ifsc, kyc_documents)
       values ($1, 'external', $2, $3, $4, $5, 'submitted', $6, $7, $8, $9, $10, $11, $12)
       returning id, user_id, instructor_type, bio, expertise, linkedin_url, website_url,
                 kyc_status, kyc_documents, gstin, bank_account_name, bank_account_last4,
                 bank_ifsc, agreement_status, revenue_share_percent, rejection_reason, created_at`,
      [
        input.userId,
        input.bio,
        input.expertise,
        input.linkedinUrl,
        input.websiteUrl,
        input.panEncrypted,
        input.gstin,
        input.bankAccountName,
        input.bankAccountEncrypted,
        input.bankAccountLast4,
        input.bankIfsc,
        JSON.stringify(input.kycDocuments),
      ],
    ) as Promise<InstructorProfileRow>;
  },

  resubmitInstructorApplication(input: {
    profileId: number;
    bio: string;
    expertise: string[];
    linkedinUrl: string | null;
    websiteUrl: string | null;
    panEncrypted: string;
    gstin: string | null;
    bankAccountName: string;
    bankAccountEncrypted: string;
    bankAccountLast4: string;
    bankIfsc: string;
    kycDocuments: unknown;
  }): Promise<InstructorProfileRow> {
    return queryOne<InstructorProfileRow>(
      `update instructor_profiles set
         bio = $2, expertise = $3, linkedin_url = $4, website_url = $5,
         kyc_status = 'submitted', pan_number_encrypted = $6, gstin = $7,
         bank_account_name = $8, bank_account_number_encrypted = $9,
         bank_account_last4 = $10, bank_ifsc = $11, kyc_documents = $12,
         rejection_reason = null
       where id = $1
       returning id, user_id, instructor_type, bio, expertise, linkedin_url, website_url,
                 kyc_status, kyc_documents, gstin, bank_account_name, bank_account_last4,
                 bank_ifsc, agreement_status, revenue_share_percent, rejection_reason, created_at`,
      [
        input.profileId,
        input.bio,
        input.expertise,
        input.linkedinUrl,
        input.websiteUrl,
        input.panEncrypted,
        input.gstin,
        input.bankAccountName,
        input.bankAccountEncrypted,
        input.bankAccountLast4,
        input.bankIfsc,
        JSON.stringify(input.kycDocuments),
      ],
    ) as Promise<InstructorProfileRow>;
  },
};
