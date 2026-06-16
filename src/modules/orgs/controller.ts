import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { orgsService } from './service';

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}
function orgId(req: Request): number {
  return Number(req.params.orgId);
}

export const orgsController = {
  async register(req: Request, res: Response): Promise<void> {
    ApiResponse.created(res, await orgsService.register(uid(req), req.body as Record<string, unknown>));
  },
  async myOrgs(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await orgsService.myOrgs(uid(req)));
  },
  async addMember(req: Request, res: Response): Promise<void> {
    const b = req.body as { email: string; role: 'admin' | 'member' };
    ApiResponse.created(res, await orgsService.addMemberByEmail(orgId(req), uid(req), b.email, b.role));
  },
  async purchaseSeats(req: Request, res: Response): Promise<void> {
    const b = req.body as { seats: number; unitPrice: number };
    ApiResponse.created(res, await orgsService.purchaseSeats(orgId(req), uid(req), b.seats, b.unitPrice));
  },
  async assignSeat(req: Request, res: Response): Promise<void> {
    const b = req.body as { memberUserId: number; internshipId: number };
    ApiResponse.created(res, await orgsService.assignSeat(orgId(req), uid(req), b.memberUserId, b.internshipId));
  },
  async team(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await orgsService.team(orgId(req), uid(req)));
  },
};
