import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { notificationsService } from './service';

const router = Router();
const listQuery = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const idParam = z.object({ notificationId: z.coerce.number().int().positive() });
const deviceSchema = z.object({ token: z.string().min(10), platform: z.enum(['android', 'ios', 'web']) });
const prefSchema = z.object({
  channel: z.enum(['email', 'sms', 'push', 'in_app']),
  category: z.enum(['reminders', 'marketing']),
  enabled: z.boolean(),
});

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

router.get(
  '/notifications',
  requireAuth,
  zodValidate(listQuery, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const { items, pagination, unreadCount } = await notificationsService.list(uid(req), q.unreadOnly, q.page, q.limit);
    ApiResponse.ok(res, items, { pagination, unreadCount });
  }),
);

router.post(
  '/notifications/:notificationId/read',
  requireAuth,
  zodValidate(idParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    await notificationsService.markRead(uid(req), Number(req.params.notificationId));
    ApiResponse.ok(res, { message: 'Read' });
  }),
);

router.post(
  '/notifications/read-all',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    await notificationsService.markRead(uid(req), null);
    ApiResponse.ok(res, { message: 'All read' });
  }),
);

router.post(
  '/users/me/device-tokens',
  requireAuth,
  zodValidate(deviceSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { token, platform } = req.body as z.infer<typeof deviceSchema>;
    await notificationsService.registerDevice(uid(req), token, platform);
    ApiResponse.ok(res, { message: 'Device registered' });
  }),
);

router.delete(
  '/users/me/device-tokens',
  requireAuth,
  zodValidate(deviceSchema.pick({ token: true })),
  asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.body as { token: string };
    await notificationsService.unregisterDevice(uid(req), token);
    ApiResponse.ok(res, { message: 'Device removed' });
  }),
);

router.put(
  '/users/me/notification-preferences',
  requireAuth,
  zodValidate(prefSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const p = req.body as z.infer<typeof prefSchema>;
    await notificationsService.setPreference(uid(req), p.channel, p.category, p.enabled);
    ApiResponse.ok(res, { message: 'Preference saved' });
  }),
);

export default router;
