import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../core/logger';

/**
 * Bunny Stream facade (module 2.6). STORAGE_DRY_RUN fabricates video ids so
 * the lesson pipeline runs locally; token signing is REAL in both modes.
 */
const API = 'https://video.bunnycdn.com/library';

export const bunnyStreamService = {
  async createVideo(title: string): Promise<{
    videoId: string;
    tusEndpoint: string;
    libraryId: string;
    authorizationSignature: string;
    authorizationExpire: number;
  }> {
    let videoId: string;
    if (env.STORAGE_DRY_RUN) {
      videoId = `vid-dev-${randomBytes(8).toString('hex')}`;
      logger.info({ videoId, title }, '[DRY RUN] bunny stream create video');
    } else {
      const res = await fetch(`${API}/${env.BUNNY_STREAM_LIBRARY_ID}/videos`, {
        method: 'POST',
        headers: { AccessKey: env.BUNNY_STREAM_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error(`Bunny Stream create failed: ${res.status}`);
      videoId = ((await res.json()) as { guid: string }).guid;
    }
    // TUS resumable upload auth: sha256(library_id + api_key + expire + video_id)
    const authorizationExpire = Math.floor(Date.now() / 1000) + 6 * 3600;
    const authorizationSignature = createHash('sha256')
      .update(
        `${env.BUNNY_STREAM_LIBRARY_ID}${env.BUNNY_STREAM_API_KEY}${authorizationExpire}${videoId}`,
      )
      .digest('hex');
    return {
      videoId,
      tusEndpoint: 'https://video.bunnycdn.com/tusupload',
      libraryId: env.BUNNY_STREAM_LIBRARY_ID,
      authorizationSignature,
      authorizationExpire,
    };
  },

  async deleteVideo(videoId: string): Promise<void> {
    if (env.STORAGE_DRY_RUN) {
      logger.info({ videoId }, '[DRY RUN] bunny stream delete video');
      return;
    }
    const res = await fetch(`${API}/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`, {
      method: 'DELETE',
      headers: { AccessKey: env.BUNNY_STREAM_API_KEY },
    });
    if (!res.ok && res.status !== 404) throw new Error(`Bunny Stream delete failed: ${res.status}`);
  },

  /**
   * Is this video actually present and playable on Bunny? Used to avoid handing
   * the classroom an embed URL that renders Bunny's own 404 page. Only an
   * EXPLICIT 404 marks it unavailable; transient errors fall through to "let the
   * player try" so a hiccup never hides a real video. Dry-run assumes ok.
   */
  async videoExists(videoId: string): Promise<boolean> {
    if (env.STORAGE_DRY_RUN || !videoId) return env.STORAGE_DRY_RUN;
    try {
      const res = await fetch(`${API}/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`, {
        headers: { AccessKey: env.BUNNY_STREAM_API_KEY, accept: 'application/json' },
      });
      return res.status !== 404;
    } catch {
      return true;
    }
  },

  /**
   * Token-authenticated playback (Bunny "Embed View Token Authentication"):
   * token = sha256hex(token_auth_key + video_id + expires [+ ip when locked]).
   * Short TTL (env, default 4h). Returns both the iframe embed URL and the
   * direct HLS playlist URL — both honor the same token.
   */
  signedPlayback(videoId: string, clientIp?: string | null): {
    embedUrl: string;
    hlsUrl: string;
    expiresAt: string;
  } {
    const expires = Math.floor(Date.now() / 1000) + env.BUNNY_STREAM_PLAYBACK_TTL_HOURS * 3600;
    const ipPart = env.BUNNY_TOKEN_IP_LOCK && clientIp ? clientIp : '';
    const token = createHash('sha256')
      .update(`${env.BUNNY_STREAM_TOKEN_AUTH_KEY}${videoId}${expires}${ipPart}`)
      .digest('hex');
    const qs = `token=${token}&expires=${expires}`;
    return {
      embedUrl: `https://iframe.mediadelivery.net/embed/${env.BUNNY_STREAM_LIBRARY_ID}/${videoId}?${qs}`,
      hlsUrl: `https://${env.BUNNY_STREAM_CDN_HOSTNAME}/${videoId}/playlist.m3u8?${qs}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  },
};
