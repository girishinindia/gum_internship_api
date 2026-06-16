import { randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../core/logger';

/** LiveProvider abstraction (module 2.7) — providers are swappable. */
export interface CreateMeetingInput {
  title: string;
  startsAt: Date;
  durationMinutes: number;
  manualJoinUrl?: string;
}
export interface MeetingRef {
  meetingId: string;
  joinUrl: string;
  passcode: string | null;
}
export interface LiveProvider {
  createMeeting(input: CreateMeetingInput): Promise<MeetingRef>;
}

/** Zoom server-to-server OAuth (account_credentials grant) → POST /users/me/meetings. */
class ZoomProvider implements LiveProvider {
  private token: { value: string; expiresAt: number } | null = null;

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${env.ZOOM_ACCOUNT_ID}`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`).toString('base64')}`,
        },
      },
    );
    if (!res.ok) throw new Error(`Zoom OAuth failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  async createMeeting(input: CreateMeetingInput): Promise<MeetingRef> {
    if (env.LIVE_DRY_RUN) {
      const id = String(90000000000 + Math.floor(Math.random() * 9999999));
      logger.info({ id, title: input.title }, '[DRY RUN] zoom meeting');
      return { meetingId: id, joinUrl: `https://zoom.us/j/${id}`, passcode: randomBytes(3).toString('hex') };
    }
    const token = await this.accessToken();
    const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: input.title,
        type: 2, // scheduled
        start_time: input.startsAt.toISOString(),
        duration: input.durationMinutes,
        timezone: 'Asia/Kolkata',
        settings: { join_before_host: false, waiting_room: true, approval_type: 2 },
      }),
    });
    if (!res.ok) throw new Error(`Zoom create meeting failed: ${res.status}`);
    const m = (await res.json()) as { id: number; join_url: string; password?: string };
    return { meetingId: String(m.id), joinUrl: m.join_url, passcode: m.password ?? null };
  }
}

/** Google Meet stub (v1): instructor pastes the link; API call lands in P2. */
class MeetProvider implements LiveProvider {
  async createMeeting(input: CreateMeetingInput): Promise<MeetingRef> {
    if (!input.manualJoinUrl) {
      throw new Error('MEET_MANUAL_LINK_REQUIRED'); // surfaced as validation error by caller
    }
    return {
      meetingId: `meet-${randomBytes(4).toString('hex')}`,
      joinUrl: input.manualJoinUrl,
      passcode: null,
    };
  }
}

export const liveProviders: Record<'zoom' | 'google_meet', LiveProvider> = {
  zoom: new ZoomProvider(),
  google_meet: new MeetProvider(),
};
