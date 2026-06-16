import { Router } from 'express';
import authRoutes from '../modules/auth/routes';
import usersRoutes from '../modules/users/routes';
import catalogRoutes from '../modules/catalog/routes';
import internshipsRoutes from '../modules/internships/routes';
import enrollmentsRoutes from '../modules/enrollments/routes';
import paymentsRoutes from '../modules/payments/routes';
import mediaRoutes from '../modules/media/routes';
import liveRoutes from '../modules/live/routes';
import projectsRoutes from '../modules/projects/routes';
import quizzesRoutes from '../modules/quizzes/routes';
import certificatesRoutes from '../modules/certificates/routes';
import notificationsRoutes from '../modules/notifications/routes';
import earningsRoutes from '../modules/earnings/routes';
import adminRoutes from '../modules/admin/routes';
import portfolioRoutes from '../modules/portfolio/routes';
import aiRoutes from '../modules/ai/routes';
import gamificationRoutes from '../modules/gamification/routes';
import forumRoutes from '../modules/forum/routes';
import mentorshipRoutes from '../modules/mentorship/routes';
import assessmentRoutes from '../modules/assessment/routes';
import jobsRoutes from '../modules/jobs/routes';
import orgsRoutes from '../modules/orgs/routes';
import cpdRoutes from '../modules/cpd/routes';
import bundlesRoutes from '../modules/bundles/routes';
import privacyRoutes from '../modules/privacy/routes';

/**
 * All module routers mount at the /v1 root; each module defines its FULL
 * paths (matching docs/openapi.yaml) when it is built. Ownership map:
 *
 *  auth          /auth/*
 *  users         /users/me*, /instructor/profile, /instructor/agreement/*
 *  catalog       /catalog/* (public)
 *  internships   /internships/*, /sections/*, /lessons/* (authoring), /batches/* (mgmt)
 *  enrollments   /enrollments/*, /lessons/:id/play|progress (learning)
 *  payments      /orders/*, /payments/razorpay/webhook, /coupons/validate
 *  media         upload-url endpoints (avatar, submissions, documents)
 *  live          /batches/:id/live-sessions, /live-sessions/*
 *  projects      /internships/:id/projects, /projects/*, /tasks/*, /submissions/*, /instructor/review-queue
 *  quizzes       /internships/:id/quizzes, /quizzes/*, /questions/*, /attempts/*
 *  certificates  /certificates/*, /enrollments/:id/certificate, /verify/:certificateNo (public)
 *  notifications /notifications/*
 *  earnings      /instructor/earnings*, /instructor/payouts*
 *  admin         /admin/*
 */
export const apiRouter = Router();

apiRouter.use(authRoutes);
apiRouter.use(usersRoutes);
apiRouter.use(catalogRoutes);
apiRouter.use(internshipsRoutes);
apiRouter.use(enrollmentsRoutes);
apiRouter.use(paymentsRoutes);
apiRouter.use(mediaRoutes);
apiRouter.use(liveRoutes);
apiRouter.use(projectsRoutes);
apiRouter.use(quizzesRoutes);
apiRouter.use(certificatesRoutes);
apiRouter.use(notificationsRoutes);
apiRouter.use(earningsRoutes);
apiRouter.use(adminRoutes);
apiRouter.use(portfolioRoutes);
apiRouter.use(aiRoutes);
apiRouter.use(gamificationRoutes);
apiRouter.use(forumRoutes);
apiRouter.use(mentorshipRoutes);
apiRouter.use(assessmentRoutes);
apiRouter.use(jobsRoutes);
apiRouter.use(orgsRoutes);
apiRouter.use(cpdRoutes);
apiRouter.use(bundlesRoutes);
apiRouter.use(privacyRoutes);
