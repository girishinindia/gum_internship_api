import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { logger } from '../core/logger';

/**
 * Bunny Storage facade. Two zones: public (avatars/thumbnails) and private
 * (offer letters, invoices, submissions, certificates — served only via
 * signed URLs). With STORAGE_DRY_RUN=true files land in ./var/storage so dev
 * and tests can assert real bytes without Bunny credentials.
 */

export type StorageZone = 'public' | 'private';

interface ZoneConfig {
  zone: string;
  apiKey: string;
  cdnUrl: string;
}

function zoneConfig(zone: StorageZone): ZoneConfig {
  return zone === 'public'
    ? {
        zone: env.BUNNY_STORAGE_PUBLIC_ZONE,
        apiKey: env.BUNNY_STORAGE_PUBLIC_API_KEY,
        cdnUrl: env.BUNNY_STORAGE_PUBLIC_CDN_URL,
      }
    : {
        zone: env.BUNNY_STORAGE_PRIVATE_ZONE,
        apiKey: env.BUNNY_STORAGE_PRIVATE_API_KEY,
        cdnUrl: env.BUNNY_STORAGE_PRIVATE_CDN_URL,
      };
}

export const storageService = {
  /** Upload a buffer; returns the storage path you should persist. */
  async upload(zone: StorageZone, filePath: string, data: Buffer, contentType: string): Promise<string> {
    if (env.STORAGE_DRY_RUN) {
      const local = path.join(process.cwd(), 'var', 'storage', zone, filePath);
      await mkdir(path.dirname(local), { recursive: true });
      await writeFile(local, data);
      logger.info({ local, bytes: data.length }, '[DRY RUN] storage upload');
      return filePath;
    }
    const cfg = zoneConfig(zone);
    const res = await fetch(`https://storage.bunnycdn.com/${cfg.zone}/${filePath}`, {
      method: 'PUT',
      headers: { AccessKey: cfg.apiKey, 'content-type': contentType },
      body: new Uint8Array(data),
    });
    if (!res.ok) {
      throw new Error(`Bunny Storage upload failed: ${res.status}`);
    }
    return filePath;
  },

  /** Public zone files are plain CDN URLs. */
  publicUrl(filePath: string): string {
    return `${env.BUNNY_STORAGE_PUBLIC_CDN_URL}/${filePath}`;
  },

  /**
   * Private zone: Bunny token authentication — sha256(token_key + path + expires),
   * base64url, as ?token=&expires=. TTL from BUNNY_SIGNED_URL_TTL_MINUTES.
   */
  signedPrivateUrl(filePath: string): { url: string; expiresAt: string } {
    const expires = Math.floor(Date.now() / 1000) + env.BUNNY_SIGNED_URL_TTL_MINUTES * 60;
    const pathWithSlash = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const token = createHash('sha256')
      .update(`${env.BUNNY_PRIVATE_URL_TOKEN_KEY}${pathWithSlash}${expires}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return {
      url: `${env.BUNNY_STORAGE_PRIVATE_CDN_URL}${pathWithSlash}?token=${token}&expires=${expires}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  },
};
