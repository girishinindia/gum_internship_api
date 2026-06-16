import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { query } from '../../db/pool';
import { jobsRepository as repo } from './repository';

async function grantEmployerRole(userId: number): Promise<void> {
  // Role becomes active on the user's next token refresh; employer endpoints
  // here gate on the employer PROFILE, not the JWT role, so it works immediately.
  await query(
    `insert into user_roles (user_id, role_id)
     select $1, id from roles where name = 'employer'::role_name
     on conflict (user_id, role_id) do nothing`,
    [userId],
  );
}

async function requireEmployer(userId: number, opts?: { verified?: boolean }): Promise<{ id: number; kyc_status: string }> {
  const e = await repo.employerByUser(userId);
  if (!e) throw new AppError(ErrorCodes.FORBIDDEN, 'Register as an employer first.');
  if (opts?.verified && e.kyc_status !== 'verified') {
    throw AppError.conflict('Your employer account must be verified before publishing jobs.');
  }
  return e;
}

export const jobsService = {
  // ---- Employer onboarding -------------------------------------------------
  async register(userId: number, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (await repo.employerByUser(userId)) throw AppError.conflict('You already have an employer profile.');
    const profile = await repo.createEmployer(userId, input);
    await grantEmployerRole(userId);
    return profile;
  },

  async myEmployer(userId: number): Promise<Record<string, unknown>> {
    const p = await repo.employerProfile(userId);
    if (!p) throw AppError.notFound('Employer profile');
    return p;
  },

  async updateEmployer(userId: number, fields: Record<string, unknown>): Promise<void> {
    await requireEmployer(userId);
    await repo.updateEmployer(userId, fields);
  },

  /** Accept agreement + submit for verification. */
  async submitForVerification(userId: number): Promise<void> {
    await requireEmployer(userId);
    await repo.acceptAgreementAndSubmit(userId);
  },

  // ---- Jobs (employer) -----------------------------------------------------
  async createJob(userId: number, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const e = await requireEmployer(userId);
    return repo.createJob(e.id, input);
  },

  async updateJob(userId: number, jobId: number, fields: Record<string, unknown>): Promise<void> {
    const e = await requireEmployer(userId);
    const job = await repo.jobById(jobId);
    if (!job || Number(job.employer_id) !== e.id) throw AppError.notFound('Job');
    if (!['draft', 'rejected'].includes(String(job.status))) throw AppError.conflict('Only draft or rejected jobs can be edited.');
    await repo.updateJob(jobId, fields);
  },

  /** Submit a draft job for admin review (employer must be verified). */
  async submitJob(userId: number, jobId: number): Promise<void> {
    const e = await requireEmployer(userId, { verified: true });
    const job = await repo.jobById(jobId);
    if (!job || Number(job.employer_id) !== e.id) throw AppError.notFound('Job');
    if (!['draft', 'rejected'].includes(String(job.status))) throw AppError.conflict(`Job is ${String(job.status)}.`);
    await repo.setJobStatus(jobId, 'pending_review', { reason: null });
  },

  async closeJob(userId: number, jobId: number): Promise<void> {
    const e = await requireEmployer(userId);
    const job = await repo.jobById(jobId);
    if (!job || Number(job.employer_id) !== e.id) throw AppError.notFound('Job');
    await repo.setJobStatus(jobId, 'closed');
  },

  async myJobs(userId: number): Promise<unknown[]> {
    const e = await requireEmployer(userId);
    return repo.myJobs(e.id);
  },

  async jobApplicants(userId: number, jobId: number): Promise<unknown[]> {
    const e = await requireEmployer(userId);
    const job = await repo.jobById(jobId);
    if (!job || Number(job.employer_id) !== e.id) throw AppError.notFound('Job');
    return repo.applicationsForJob(jobId);
  },

  async setApplicantStatus(userId: number, appId: number, status: string): Promise<void> {
    const e = await requireEmployer(userId);
    const app = await repo.applicationById(appId);
    if (!app || Number(app.employer_id) !== e.id) throw AppError.notFound('Application');
    await repo.setApplicationStatus(appId, status);
  },

  // ---- Public board + applicants -------------------------------------------
  async board(filters: { q?: string; workMode?: string }, page: number, limit: number): Promise<{ items: unknown[]; total: number }> {
    return repo.publicBoard(filters, page, limit);
  },

  async getJob(jobId: number): Promise<Record<string, unknown>> {
    const job = await repo.publicJob(jobId);
    if (!job || job.status !== 'published') throw AppError.notFound('Job');
    return job;
  },

  /** Apply with the learner's portfolio handle + resume (auto-attached). */
  async apply(userId: number, jobId: number, coverNote: string | null): Promise<Record<string, unknown>> {
    const job = await repo.jobById(jobId);
    if (!job || job.status !== 'published') throw AppError.notFound('Job');
    const employer = await repo.employerByUser(userId);
    if (employer && Number(job.employer_id) === employer.id) throw AppError.validation('You cannot apply to your own job.');
    const { handle, resumeUrl } = await repo.applicantPortfolio(userId);
    const created = await repo.apply(jobId, userId, handle, resumeUrl, coverNote);
    if (!created) throw AppError.conflict('You have already applied to this job.');
    return { applicationId: created.id, status: 'applied', portfolioHandle: handle, resumeAttached: resumeUrl !== null };
  },

  async myApplications(userId: number): Promise<unknown[]> {
    return repo.myApplications(userId);
  },

  async withdraw(userId: number, appId: number): Promise<void> {
    const app = await repo.applicationById(appId);
    if (!app || Number(app.user_id) !== userId) throw AppError.notFound('Application');
    await repo.setApplicationStatus(appId, 'withdrawn');
  },

  // ---- Admin moderation ----------------------------------------------------
  async adminListEmployers(status: string | null, page: number, limit: number): Promise<{ items: unknown[]; total: number }> {
    return repo.listEmployersByKyc(status, page, limit);
  },

  async verifyEmployer(employerId: number, decision: 'verified' | 'rejected', reason?: string): Promise<void> {
    if (decision === 'rejected' && !reason) throw AppError.validation('reason required when rejecting');
    await repo.setEmployerKycStatus(employerId, decision, decision === 'rejected' ? (reason ?? null) : null);
  },

  async moderateJob(jobId: number, decision: 'published' | 'rejected', reason?: string): Promise<void> {
    const job = await repo.jobById(jobId);
    if (!job) throw AppError.notFound('Job');
    if (decision === 'rejected') {
      if (!reason) throw AppError.validation('reason required when rejecting');
      await repo.setJobStatus(jobId, 'rejected', { reason });
    } else {
      await repo.setJobStatus(jobId, 'published', { publish: true, reason: null });
    }
  },
};
