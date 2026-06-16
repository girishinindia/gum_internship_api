import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { assessmentService } from './service';
import type { SubmitInput } from './schemas';

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export const assessmentController = {
  async tracks(_req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await assessmentService.listTracks());
  },
  async diagnostic(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await assessmentService.getDiagnostic(String(req.params.track)));
  },
  async submit(req: Request, res: Response): Promise<void> {
    const b = req.body as SubmitInput;
    ApiResponse.created(res, await assessmentService.submit(uid(req), b.track, b.answers));
  },
  async myAttempts(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await assessmentService.myAttempts(uid(req)));
  },
};
