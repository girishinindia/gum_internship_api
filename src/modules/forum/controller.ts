import type { Request, Response } from 'express';
import { ApiResponse, buildPagination } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { forumService } from './service';
import type { CreateThreadInput, ListThreadsQuery } from './schemas';

function actor(req: Request): { id: number; roles: string[] } {
  if (!req.user) throw AppError.unauthorized();
  return { id: req.user.id, roles: req.user.roles };
}

export const forumController = {
  async create(req: Request, res: Response): Promise<void> {
    const a = actor(req);
    ApiResponse.created(res, await forumService.createThread(a.id, a.roles, req.body as CreateThreadInput));
  },
  async list(req: Request, res: Response): Promise<void> {
    const q = req.query as unknown as ListThreadsQuery;
    const { items, total } = await forumService.listThreads(q.internshipId, q.page, q.limit);
    ApiResponse.paginated(res, items, buildPagination(q.page, q.limit, total));
  },
  async get(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await forumService.getThread(Number(req.params.threadId)));
  },
  async reply(req: Request, res: Response): Promise<void> {
    const a = actor(req);
    const { body } = req.body as { body: string };
    ApiResponse.created(res, await forumService.reply(a.id, a.roles, Number(req.params.threadId), body));
  },
  async accept(req: Request, res: Response): Promise<void> {
    const a = actor(req);
    await forumService.acceptAnswer(a.id, a.roles, Number(req.params.threadId), Number(req.params.replyId));
    ApiResponse.ok(res, { message: 'Answer accepted' });
  },
  async moderate(req: Request, res: Response): Promise<void> {
    await forumService.moderateThread(Number(req.params.threadId), req.body as Record<string, boolean>);
    ApiResponse.ok(res, { message: 'Thread updated' });
  },
  async deleteReply(req: Request, res: Response): Promise<void> {
    await forumService.deleteReply(Number(req.params.replyId));
    ApiResponse.ok(res, { message: 'Reply removed' });
  },
};
