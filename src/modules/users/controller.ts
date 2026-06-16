import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { usersService } from './service';
import type { AdminUserListInput, InstructorApplicationInput, UpdateMeInput } from './schemas';

function userId(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export const usersController = {
  async getMe(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await usersService.getMe(userId(req)));
  },

  async updateMe(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await usersService.updateMe(userId(req), req.body as UpdateMeInput));
  },

  async adminList(req: Request, res: Response): Promise<void> {
    const input = req.query as unknown as AdminUserListInput;
    const { users, pagination } = await usersService.adminList(input);
    ApiResponse.paginated(res, users, pagination);
  },

  async applyAsInstructor(req: Request, res: Response): Promise<void> {
    const profile = await usersService.applyAsInstructor(
      userId(req),
      req.body as InstructorApplicationInput,
    );
    ApiResponse.created(res, profile);
  },

  async getInstructorApplication(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await usersService.getInstructorApplication(userId(req)));
  },
};
