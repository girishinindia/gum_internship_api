import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { buildResume } from './resume';
import { portfolioService } from './service';
import type { UpsertPortfolioInput } from './schemas';

function userId(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export const portfolioController = {
  async getMine(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await portfolioService.getMine(userId(req)));
  },

  async upsertMine(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await portfolioService.upsertMine(userId(req), req.body as UpsertPortfolioInput));
  },

  async resume(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await buildResume(userId(req)));
  },

  /** PUBLIC — privacy-aware credential wallet. */
  async getPublic(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await portfolioService.getPublic(String(req.params.handle)));
  },
};
