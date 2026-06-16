import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { gamificationService } from './service';

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export const gamificationController = {
  async myXp(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await gamificationService.myStats(uid(req)));
  },
  async myBadges(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await gamificationService.myBadges(uid(req)));
  },
  async leaderboard(req: Request, res: Response): Promise<void> {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    ApiResponse.ok(res, await gamificationService.leaderboard(limit));
  },
};
