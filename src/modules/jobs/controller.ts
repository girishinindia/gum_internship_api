import type { Request, Response } from 'express';
import { ApiResponse, buildPagination } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { jobsService } from './service';

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export const jobsController = {
  // employer onboarding
  async register(req: Request, res: Response): Promise<void> {
    ApiResponse.created(res, await jobsService.register(uid(req), req.body as Record<string, unknown>));
  },
  async myEmployer(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await jobsService.myEmployer(uid(req)));
  },
  async updateEmployer(req: Request, res: Response): Promise<void> {
    await jobsService.updateEmployer(uid(req), req.body as Record<string, unknown>);
    ApiResponse.ok(res, { message: 'Employer profile updated' });
  },
  async submitEmployer(req: Request, res: Response): Promise<void> {
    await jobsService.submitForVerification(uid(req));
    ApiResponse.ok(res, { message: 'Submitted for verification' });
  },
  // jobs (employer)
  async createJob(req: Request, res: Response): Promise<void> {
    ApiResponse.created(res, await jobsService.createJob(uid(req), req.body as Record<string, unknown>));
  },
  async updateJob(req: Request, res: Response): Promise<void> {
    await jobsService.updateJob(uid(req), Number(req.params.jobId), req.body as Record<string, unknown>);
    ApiResponse.ok(res, { message: 'Job updated' });
  },
  async submitJob(req: Request, res: Response): Promise<void> {
    await jobsService.submitJob(uid(req), Number(req.params.jobId));
    ApiResponse.ok(res, { message: 'Job submitted for review' });
  },
  async closeJob(req: Request, res: Response): Promise<void> {
    await jobsService.closeJob(uid(req), Number(req.params.jobId));
    ApiResponse.ok(res, { message: 'Job closed' });
  },
  async myJobs(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await jobsService.myJobs(uid(req)));
  },
  async jobApplicants(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await jobsService.jobApplicants(uid(req), Number(req.params.jobId)));
  },
  async setApplicantStatus(req: Request, res: Response): Promise<void> {
    await jobsService.setApplicantStatus(uid(req), Number(req.params.appId), (req.body as { status: string }).status);
    ApiResponse.ok(res, { message: 'Application updated' });
  },
  // public board + apply
  async board(req: Request, res: Response): Promise<void> {
    const q = req.query as Record<string, string>;
    const page = Number(q.page ?? 1); const limit = Number(q.limit ?? 20);
    const { items, total } = await jobsService.board({ q: q.q, workMode: q.workMode }, page, limit);
    ApiResponse.paginated(res, items, buildPagination(page, limit, total));
  },
  async getJob(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await jobsService.getJob(Number(req.params.jobId)));
  },
  async apply(req: Request, res: Response): Promise<void> {
    const { coverNote } = req.body as { coverNote?: string };
    ApiResponse.created(res, await jobsService.apply(uid(req), Number(req.params.jobId), coverNote ?? null));
  },
  async myApplications(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await jobsService.myApplications(uid(req)));
  },
  async withdraw(req: Request, res: Response): Promise<void> {
    await jobsService.withdraw(uid(req), Number(req.params.appId));
    ApiResponse.ok(res, { message: 'Application withdrawn' });
  },
  // admin moderation
  async adminEmployers(req: Request, res: Response): Promise<void> {
    const q = req.query as Record<string, string>;
    const page = Number(q.page ?? 1); const limit = Number(q.limit ?? 20);
    const { items, total } = await jobsService.adminListEmployers(q.kycStatus ?? null, page, limit);
    ApiResponse.paginated(res, items, buildPagination(page, limit, total));
  },
  async verifyEmployer(req: Request, res: Response): Promise<void> {
    const b = req.body as { decision: 'verified' | 'rejected'; reason?: string };
    await jobsService.verifyEmployer(Number(req.params.employerId), b.decision, b.reason);
    ApiResponse.ok(res, { message: `Employer ${b.decision}` });
  },
  async jobDecision(req: Request, res: Response): Promise<void> {
    const b = req.body as { decision: 'published' | 'rejected'; reason?: string };
    await jobsService.moderateJob(Number(req.params.jobId), b.decision, b.reason);
    ApiResponse.ok(res, { message: `Job ${b.decision}` });
  },
};
