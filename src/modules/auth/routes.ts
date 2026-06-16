import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth } from '../../middlewares/auth';
import { authLimiter, otpLimiter } from '../../middlewares/rateLimiter';
import { zodValidate } from '../../middlewares/zodValidate';
import { authController as c } from './controller';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshSchema,
  resetPasswordSchema,
  signupSchema,
} from './schemas';

const router = Router();

router.post('/auth/register', authLimiter, zodValidate(signupSchema), asyncHandler(c.signup));
router.post('/auth/otp/request', otpLimiter, zodValidate(otpRequestSchema), asyncHandler(c.requestOtp));
router.post('/auth/otp/verify', authLimiter, zodValidate(otpVerifySchema), asyncHandler(c.verifyOtp));
router.post('/auth/login', authLimiter, zodValidate(loginSchema), asyncHandler(c.login));
router.post('/auth/refresh', authLimiter, zodValidate(refreshSchema), asyncHandler(c.refresh));
router.post('/auth/logout', zodValidate(logoutSchema), asyncHandler(c.logout));
router.post('/auth/logout-all', requireAuth, asyncHandler(c.logoutAll));
router.post('/auth/password/forgot', otpLimiter, zodValidate(forgotPasswordSchema), asyncHandler(c.forgotPassword));
router.post('/auth/password/reset', authLimiter, zodValidate(resetPasswordSchema), asyncHandler(c.resetPassword));
router.post('/auth/password/change', requireAuth, zodValidate(changePasswordSchema), asyncHandler(c.changePassword));

export default router;
