import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { aiService } from './service';
import type { AskInput, StartInterviewInput } from './schemas';

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export const aiController = {
  async ask(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await aiService.ask(uid(req), req.body as AskInput));
  },
  async listThreads(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await aiService.listThreads(uid(req)));
  },
  async threadMessages(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await aiService.threadMessages(uid(req), Number(req.params.threadId)));
  },
  async startInterview(req: Request, res: Response): Promise<void> {
    ApiResponse.created(res, await aiService.startInterview(uid(req), req.body as StartInterviewInput));
  },
  async answerInterview(req: Request, res: Response): Promise<void> {
    const { answer } = req.body as { answer: string };
    ApiResponse.ok(res, await aiService.answerInterview(uid(req), Number(req.params.attemptId), answer));
  },
  async translate(req: Request, res: Response): Promise<void> {
    const { lessonId, language } = req.body as { lessonId: number; language: string };
    ApiResponse.ok(res, await aiService.translateLesson(uid(req), lessonId, language));
  },
  async reindex(req: Request, res: Response): Promise<void> {
    const { internshipId } = req.body as { internshipId: number };
    ApiResponse.ok(res, await aiService.reindex(internshipId, uid(req)));
  },
  /** Student-facing: read a stored lesson translation (no generation). */
  async readTranslation(req: Request, res: Response): Promise<void> {
    const language = String(req.query.language ?? '');
    ApiResponse.ok(res, await aiService.readTranslation(uid(req), Number(req.params.lessonId), language));
  },
};
