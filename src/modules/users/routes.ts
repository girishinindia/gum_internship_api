import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { usersController as c } from './controller';
import { adminUserListSchema, instructorApplicationSchema, updateMeSchema } from './schemas';

const router = Router();

router.get('/users/me', requireAuth, asyncHandler(c.getMe));
router.patch('/users/me', requireAuth, zodValidate(updateMeSchema), asyncHandler(c.updateMe));

// Instructor onboarding (FR-INST-01); moderator decision lands in module 2.12.
router.post(
  '/users/instructor-application',
  requireAuth,
  zodValidate(instructorApplicationSchema),
  asyncHandler(c.applyAsInstructor),
);
router.get('/users/instructor-application', requireAuth, asyncHandler(c.getInstructorApplication));

// Admin user listing lives here with the rest of user querying; the /admin/*
// console endpoints (suspend, roles) arrive with module 2.12.
router.get(
  '/admin/users',
  requireAuth,
  requireRoles('moderator', 'support'),
  zodValidate(adminUserListSchema, 'query'),
  asyncHandler(c.adminList),
);

export default router;
