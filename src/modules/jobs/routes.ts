import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { jobsController as c } from './controller';
import {
  applicantStatusSchema, applySchema, boardQuery, createJobSchema, jobDecisionSchema,
  registerEmployerSchema, updateEmployerSchema, updateJobSchema, verifyEmployerSchema,
} from './schemas';

const router = Router();
const jobIdParam = z.object({ jobId: z.coerce.number().int().positive() });
const appIdParam = z.object({ appId: z.coerce.number().int().positive() });
const employerIdParam = z.object({ employerId: z.coerce.number().int().positive() });

// ---- Employer onboarding ---------------------------------------------------
router.post('/employers/register', requireAuth, zodValidate(registerEmployerSchema), asyncHandler(c.register));
router.get('/employers/me', requireAuth, asyncHandler(c.myEmployer));
router.patch('/employers/me', requireAuth, zodValidate(updateEmployerSchema), asyncHandler(c.updateEmployer));
router.post('/employers/me/submit', requireAuth, asyncHandler(c.submitEmployer));

// ---- Jobs: employer management ---------------------------------------------
router.post('/jobs', requireAuth, zodValidate(createJobSchema), asyncHandler(c.createJob));
router.get('/employer/jobs', requireAuth, asyncHandler(c.myJobs));
router.patch('/jobs/:jobId', requireAuth, zodValidate(jobIdParam, 'params'), zodValidate(updateJobSchema), asyncHandler(c.updateJob));
router.post('/jobs/:jobId/submit', requireAuth, zodValidate(jobIdParam, 'params'), asyncHandler(c.submitJob));
router.post('/jobs/:jobId/close', requireAuth, zodValidate(jobIdParam, 'params'), asyncHandler(c.closeJob));
router.get('/employer/jobs/:jobId/applicants', requireAuth, zodValidate(jobIdParam, 'params'), asyncHandler(c.jobApplicants));
router.patch('/employer/applications/:appId', requireAuth, zodValidate(appIdParam, 'params'), zodValidate(applicantStatusSchema), asyncHandler(c.setApplicantStatus));

// ---- Public board + applicant ----------------------------------------------
router.get('/jobs', requireAuth, zodValidate(boardQuery, 'query'), asyncHandler(c.board));
router.get('/jobs/:jobId', requireAuth, zodValidate(jobIdParam, 'params'), asyncHandler(c.getJob));
router.post('/jobs/:jobId/apply', requireAuth, zodValidate(jobIdParam, 'params'), zodValidate(applySchema), asyncHandler(c.apply));
router.get('/me/applications', requireAuth, asyncHandler(c.myApplications));
router.post('/me/applications/:appId/withdraw', requireAuth, zodValidate(appIdParam, 'params'), asyncHandler(c.withdraw));

// ---- Admin moderation ------------------------------------------------------
router.get('/admin/employers', requireAuth, requireRoles('moderator', 'super_admin'), asyncHandler(c.adminEmployers));
router.post('/admin/employers/:employerId/verify', requireAuth, requireRoles('moderator', 'super_admin'),
  zodValidate(employerIdParam, 'params'), zodValidate(verifyEmployerSchema), asyncHandler(c.verifyEmployer));
router.post('/admin/jobs/:jobId/decision', requireAuth, requireRoles('moderator', 'super_admin'),
  zodValidate(jobIdParam, 'params'), zodValidate(jobDecisionSchema), asyncHandler(c.jobDecision));

export default router;
