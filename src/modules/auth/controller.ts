import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { authService } from './service';
import type {
  ChangePasswordInput,
  LoginInput,
  OtpRequestInput,
  OtpVerifyInput,
  RefreshInput,
  ResetPasswordInput,
  SignupInput,
} from './schemas';

function clientCtx(req: Request): { userAgent: string | null; ip: string | null } {
  return { userAgent: req.headers['user-agent'] ?? null, ip: req.ip ?? null };
}

export const authController = {
  async signup(req: Request, res: Response): Promise<void> {
    const result = await authService.signup(req.body as SignupInput);
    ApiResponse.ok(res, result.data, result.meta, 201);
  },

  async requestOtp(req: Request, res: Response): Promise<void> {
    const result = await authService.requestOtp(req.body as OtpRequestInput);
    ApiResponse.ok(res, result.data, result.meta);
  },

  async verifyOtp(req: Request, res: Response): Promise<void> {
    const result = await authService.verifyOtp(req.body as OtpVerifyInput);
    ApiResponse.ok(res, { message: `Your ${result.verified} is verified`, ...result });
  },

  async login(req: Request, res: Response): Promise<void> {
    const tokens = await authService.login(req.body as LoginInput, clientCtx(req));
    ApiResponse.ok(res, tokens);
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body as RefreshInput;
    const tokens = await authService.refresh(refreshToken, clientCtx(req));
    ApiResponse.ok(res, tokens);
  },

  async logout(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body as RefreshInput;
    await authService.logout(refreshToken);
    ApiResponse.ok(res, { message: 'Logged out' });
  },

  async logoutAll(req: Request, res: Response): Promise<void> {
    if (!req.user) throw AppError.unauthorized();
    await authService.logoutAll(req.user.id);
    ApiResponse.ok(res, { message: 'Logged out from all devices' });
  },

  async forgotPassword(req: Request, res: Response): Promise<void> {
    const { email } = req.body as { email: string };
    const result = await authService.forgotPassword(email);
    ApiResponse.ok(res, result.data, result.meta);
  },

  async resetPassword(req: Request, res: Response): Promise<void> {
    await authService.resetPassword(req.body as ResetPasswordInput);
    ApiResponse.ok(res, { message: 'Password reset — log in with your new password' });
  },

  async changePassword(req: Request, res: Response): Promise<void> {
    if (!req.user) throw AppError.unauthorized();
    await authService.changePassword(req.user.id, req.body as ChangePasswordInput);
    ApiResponse.ok(res, { message: 'Password changed — other devices were logged out' });
  },
};
