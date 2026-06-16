import { env } from '../../config/env';
import { notificationTemplates } from '../../config/notificationTemplates';
import { buildPagination } from '../../core/apiResponse';
import type { PaginationMeta } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { logger } from '../../core/logger';
import { query, queryOne } from '../../db/pool';
import { eventBus } from '../../services/eventBus';
import { notifyService } from '../../services/notify';
import { sendPush } from '../../services/notify/fcmPush';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Unified notifications (module 2.10): prefs → templates → channels, retry once, dead-letter. */

function render(tpl: string, payload: Row): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(payload[k] ?? ''));
}

async function channelEnabled(userId: number, channel: string, category: string): Promise<boolean> {
  if (category === 'transactional') return true; // never mutable (FR-NOTIF-03)
  const pref = await queryOne<{ enabled: boolean }>(
    `select enabled from notification_preferences where user_id = $1 and channel = $2::notification_channel and category = $3::notification_category`,
    [userId, channel, category],
  );
  return pref?.enabled ?? category !== 'marketing'; // reminders default on, marketing default off
}

async function withRetry(userId: number, event: string, channel: string, payload: Row, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (first) {
    try {
      await fn(); // retry once
    } catch (second) {
      const error = second instanceof Error ? second.message : String(second);
      logger.error({ event, channel, userId, error }, 'notification failed after retry');
      await query(
        `insert into notification_failures (user_id, event, channel, error, payload)
         values ($1, $2, $3::notification_channel, $4, $5)`,
        [userId, event, channel, error, JSON.stringify(payload)],
      ).catch(() => undefined);
    }
  }
}

export interface SendInput {
  userId: number;
  event: keyof typeof notificationTemplates | string;
  payload: Row;
  /** Restrict channels; default = every channel the template defines. */
  channels?: ('email' | 'sms' | 'push' | 'in_app')[];
}

export const notificationsService = {
  async send(input: SendInput): Promise<void> {
    const tpl = notificationTemplates[input.event as string];
    if (!tpl) {
      logger.warn({ event: input.event }, 'no template for event — skipped');
      return;
    }
    const user = await queryOne<{ email: string | null; phone: string | null; full_name: string }>(
      `select email, phone, full_name from users where id = $1`,
      [input.userId],
    );
    if (!user) return;
    const payload = { name: user.full_name, ...input.payload };
    const want = (c: 'email' | 'sms' | 'push' | 'in_app'): boolean =>
      !input.channels || input.channels.includes(c);

    if (tpl.inApp && want('in_app')) {
      await query(
        `insert into notifications (user_id, channel, template_key, title, body, data, status)
         values ($1, 'in_app', $2, $3, $4, $5, 'sent')`,
        [input.userId, input.event, render(tpl.inApp.title, payload), render(tpl.inApp.body, payload), JSON.stringify(input.payload)],
      );
    }
    if (tpl.email && user.email && want('email') && (await channelEnabled(input.userId, 'email', tpl.category))) {
      await withRetry(input.userId, String(input.event), 'email', payload, () =>
        notifyService.sendEmail(user.email as string, user.full_name, render(tpl.email!.subject, payload), render(tpl.email!.html, payload)),
      );
    }
    if (tpl.sms && user.phone && want('sms') && (await channelEnabled(input.userId, 'sms', tpl.category))) {
      // DLT compliance: only the 5 pre-approved OTP templates may be sent over
      // SMS Gateway Hub. Event-driven transactional SMS (review/cert/etc.) has
      // no approved template, so we record intent and rely on email/in-app for
      // those events. Approve more DLT templates to enable real SMS here.
      logger.info({ userId: input.userId, event: input.event }, 'SMS skipped — no approved DLT template for this event');
    }
    if (tpl.push && want('push') && (await channelEnabled(input.userId, 'push', tpl.category))) {
      const tokens = await query<{ token: string }>(`select token from device_tokens where user_id = $1`, [input.userId]);
      const title = render(tpl.push.title, payload);
      const pushBody = render(tpl.push.body, payload);
      if (env.NOTIFY_DRY_RUN) {
        if (tokens.length) logger.info({ userId: input.userId, devices: tokens.length, title }, '[DRY RUN] push');
      } else {
        for (const { token } of tokens) {
          await withRetry(input.userId, String(input.event), 'push', payload, async () => {
            const r = await sendPush({ token, title, body: pushBody, data: { event: String(input.event) } });
            if (r === 'unregistered') {
              await query(`delete from device_tokens where token = $1`, [token]); // prune dead token
            }
          });
        }
      }
    }
  },

  async list(userId: number, unreadOnly: boolean, page: number, limit: number): Promise<{ items: unknown[]; pagination: PaginationMeta; unreadCount: number }> {
    const rows = await query<Row>(
      `select id, template_key, title, body, data, read_at, created_at, count(*) over()::int8 as total_count
       from notifications
       where user_id = $1 and channel = 'in_app' and ($2 = false or read_at is null)
       order by created_at desc limit ${limit} offset ${(page - 1) * limit}`,
      [userId, unreadOnly],
    );
    const unread = await queryOne<{ n: number }>(
      `select count(*)::int8 as n from notifications where user_id = $1 and channel = 'in_app' and read_at is null`,
      [userId],
    );
    return {
      items: rows.map((r) => ({ id: r.id, templateKey: r.template_key, title: r.title, body: r.body, data: r.data, readAt: r.read_at, createdAt: r.created_at })),
      pagination: buildPagination(page, limit, Number(rows[0]?.total_count ?? 0)),
      unreadCount: unread?.n ?? 0,
    };
  },

  async markRead(userId: number, notificationId: number | null): Promise<void> {
    if (notificationId) {
      const r = await query(
        `update notifications set read_at = now(), status = 'read' where id = $1 and user_id = $2 and read_at is null`,
        [notificationId, userId],
      );
      void r;
    } else {
      await query(
        `update notifications set read_at = now(), status = 'read' where user_id = $1 and channel = 'in_app' and read_at is null`,
        [userId],
      );
    }
  },

  async registerDevice(userId: number, token: string, platform: string): Promise<void> {
    await query(
      `insert into device_tokens (user_id, token, platform)
       values ($1, $2, $3)
       on conflict (token) do update set user_id = $1, last_seen_at = now()`,
      [userId, token, platform],
    );
  },

  async unregisterDevice(userId: number, token: string): Promise<void> {
    await query(`delete from device_tokens where token = $1 and user_id = $2`, [token, userId]);
  },

  async setPreference(userId: number, channel: string, category: string, enabled: boolean): Promise<void> {
    if (category === 'transactional') throw AppError.validation('Transactional notifications cannot be disabled');
    await query(
      `insert into notification_preferences (user_id, channel, category, enabled)
       values ($1, $2::notification_channel, $3::notification_category, $4)
       on conflict (user_id, channel, category) do update set enabled = $4`,
      [userId, channel, category, enabled],
    );
  },
};

/** Event-bus subscriptions (module 2.8 emits these). Registered at import time via app.ts. */
export function registerNotificationSubscribers(): void {
  eventBus.on('submission.received', async (p) => {
    await notificationsService.send({
      userId: p.studentUserId,
      event: 'submission.received',
      payload: { taskTitle: p.taskTitle, version: p.version },
    });
  });
  eventBus.on('review.completed', async (p) => {
    await notificationsService.send({
      userId: p.studentUserId,
      event: 'review.completed',
      payload: {
        taskTitle: p.taskTitle,
        decision: p.decision,
        totalScore: p.totalScore ?? '—',
        feedbackLine: p.resubmitDueOn ? `Resubmit by ${p.resubmitDueOn}.` : 'Great work!',
      },
    });
  });
  eventBus.on('certificate.issued', async (p) => {
    await notificationsService.send({
      userId: p.userId,
      event: 'certificate.issued',
      payload: {
        certificateNo: p.certificateNo,
        internshipTitle: p.internshipTitle,
        verifyUrl: `${env.CERTIFICATE_VERIFY_BASE_URL}/${p.certificateNo}`,
      },
    });
  });
  logger.info('notification subscribers registered');
}
