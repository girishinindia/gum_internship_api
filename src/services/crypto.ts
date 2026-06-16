import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
} from 'node:crypto';
import bcrypt from 'bcrypt';
import { env } from '../config/env';

const ENC_KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex'); // 32 bytes, validated at boot
const ALGO = 'aes-256-gcm';

/** AES-256-GCM. Output format: iv:authTag:ciphertext (hex). For PAN/bank fields. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = createDecipheriv(ALGO, ENC_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 6-digit OTP via crypto-secure RNG (never Math.random). */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** OTP hashes are salted with the destination so codes can't be replayed cross-identifier. */
export function hashOtp(destination: string, code: string): string {
  return sha256(`${destination.toLowerCase()}:${code}`);
}

/** Opaque refresh token (sent to client once; only its sha256 is stored). */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
