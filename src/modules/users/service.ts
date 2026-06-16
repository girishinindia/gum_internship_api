import { AppError } from '../../core/appError';
import { buildPagination } from '../../core/apiResponse';
import type { PaginationMeta } from '../../core/apiResponse';
import { encryptSecret } from '../../services/crypto';
import { authRepository } from '../auth/repository';
import { toPublicUser } from '../auth/service';
import type { PublicUser } from '../auth/service';
import type { InstructorProfileRow } from './repository';
import { usersRepository as repo } from './repository';
import type { AdminUserListInput, InstructorApplicationInput, UpdateMeInput } from './schemas';

export interface PublicInstructorProfile {
  id: number;
  instructorType: 'internal' | 'external';
  bio: string | null;
  expertise: string[];
  linkedinUrl: string | null;
  websiteUrl: string | null;
  kycStatus: InstructorProfileRow['kyc_status'];
  agreementStatus: InstructorProfileRow['agreement_status'];
  revenueSharePercent: number;
  bankAccountMasked: string | null;
  bankIfsc: string | null;
  gstin: string | null;
  rejectionReason: string | null;
  createdAt: Date;
}

function toPublicProfile(row: InstructorProfileRow): PublicInstructorProfile {
  return {
    id: row.id,
    instructorType: row.instructor_type,
    bio: row.bio,
    expertise: row.expertise,
    linkedinUrl: row.linkedin_url,
    websiteUrl: row.website_url,
    kycStatus: row.kyc_status,
    agreementStatus: row.agreement_status,
    revenueSharePercent: Number(row.revenue_share_percent),
    bankAccountMasked: row.bank_account_last4 ? `••••${row.bank_account_last4}` : null,
    bankIfsc: row.bank_ifsc,
    gstin: row.gstin,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}

export const usersService = {
  async getMe(userId: number): Promise<PublicUser & { instructorProfile: PublicInstructorProfile | null }> {
    const user = await authRepository.findUserById(userId);
    if (!user) throw AppError.notFound('User');
    const profile = await repo.findInstructorProfileByUserId(userId);
    return { ...(await toPublicUser(user)), instructorProfile: profile ? toPublicProfile(profile) : null };
  },

  async updateMe(userId: number, input: UpdateMeInput): Promise<PublicUser> {
    const updated = await repo.updateMe(userId, input);
    if (!updated) throw AppError.notFound('User');
    return toPublicUser(updated);
  },

  async adminList(
    input: AdminUserListInput,
  ): Promise<{ users: unknown[]; pagination: PaginationMeta }> {
    const { rows, total } = await repo.adminList(input);
    return {
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        fullName: u.full_name,
        status: u.status,
        track: u.track,
        roles: u.roles,
        emailVerified: u.email_verified_at !== null,
        phoneVerified: u.phone_verified_at !== null,
        lastLoginAt: u.last_login_at,
        createdAt: u.created_at,
      })),
      pagination: buildPagination(input.page, input.limit, total),
    };
  },

  /** FR-INST-01: apply (or re-apply after rejection) as external instructor. */
  async applyAsInstructor(
    userId: number,
    input: InstructorApplicationInput,
  ): Promise<PublicInstructorProfile> {
    const existing = await repo.findInstructorProfileByUserId(userId);
    if (existing && existing.kyc_status !== 'rejected') {
      throw AppError.conflict(
        existing.kyc_status === 'approved'
          ? 'You are already an approved instructor'
          : 'Your application is already under review',
      );
    }

    const shared = {
      bio: input.bio,
      expertise: input.expertise,
      linkedinUrl: input.linkedinUrl ?? null,
      websiteUrl: input.websiteUrl ?? null,
      panEncrypted: encryptSecret(input.panNumber),
      gstin: input.gstin ?? null,
      bankAccountName: input.bankAccountName,
      bankAccountEncrypted: encryptSecret(input.bankAccountNumber),
      bankAccountLast4: input.bankAccountNumber.slice(-4),
      bankIfsc: input.bankIfsc,
      kycDocuments: input.kycDocuments,
    };

    const row = existing
      ? await repo.resubmitInstructorApplication({ profileId: existing.id, ...shared })
      : await repo.createInstructorApplication({ userId, ...shared });
    return toPublicProfile(row);
  },

  async getInstructorApplication(userId: number): Promise<PublicInstructorProfile> {
    const profile = await repo.findInstructorProfileByUserId(userId);
    if (!profile) throw AppError.notFound('Instructor application');
    return toPublicProfile(profile);
  },
};
