import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { logger } from '../../core/logger';

/**
 * FCM HTTP v1 push sender (R0-S2).
 *
 * Auth: sign a short-lived JWT with the service-account private key, exchange
 * it at Google's OAuth token endpoint for an access token, then POST the
 * message to fcm.googleapis.com/v1. No extra SDK needed (jsonwebtoken is
 * already a dependency).
 *
 * INERT until configured: the deployment's .env carries placeholders
 * (FCM_PROJECT_ID='unset'), so isConfigured() is false and send() logs-and-
 * skips. Drop a real service account into the env and it activates with no
 * code change.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export function isFcmConfigured(): boolean {
  return (
    env.FCM_PROJECT_ID !== 'unset' &&
    env.FCM_CLIENT_EMAIL !== 'unset@example.com' &&
    env.FCM_PRIVATE_KEY !== 'unset' &&
    env.FCM_PRIVATE_KEY.includes('PRIVATE KEY')
  );
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { scope: SCOPE },
    env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'),
    {
      algorithm: 'RS256',
      issuer: env.FCM_CLIENT_EMAIL,
      audience: TOKEN_URL,
      subject: env.FCM_CLIENT_EMAIL,
      expiresIn: 3600,
      notBefore: 0,
      keyid: undefined,
      header: { alg: 'RS256', typ: 'JWT' },
      // iat is added automatically
    },
  );
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status} ${await res.text().catch(() => '')}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: now * 1000 + body.expires_in * 1000 };
  return body.access_token;
}

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Returns 'sent' | 'skipped' | 'unregistered' (caller prunes dead tokens). */
export async function sendPush(msg: PushMessage): Promise<'sent' | 'skipped' | 'unregistered'> {
  if (!isFcmConfigured()) {
    logger.info({ to: msg.token.slice(0, 8), title: msg.title }, '[FCM not configured] push skipped');
    return 'skipped';
  }
  const token = await accessToken();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: msg.token,
        notification: { title: msg.title, body: msg.body },
        ...(msg.data ? { data: msg.data } : {}),
      },
    }),
  });
  if (res.status === 404 || res.status === 410) return 'unregistered';
  if (!res.ok) {
    logger.error({ status: res.status, body: await res.text().catch(() => '') }, 'FCM send failed');
    throw new Error(`FCM send failed: ${res.status}`);
  }
  return 'sent';
}
