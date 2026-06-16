import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Dependency-free TOTP (RFC 6238, SHA-1, 6 digits, 30s) — compatible with Google
 * Authenticator, Authy, 1Password, etc. No third-party library so there's nothing
 * to install or keep patched. Secrets are base32 strings; store them ENCRYPTED.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD = 30;
const DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** A fresh base32 secret (default 160 bits, the RFC-recommended SHA-1 length). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** Verify a 6-digit code against the secret, allowing ±`window` 30s steps (clock skew). */
export function verifyTotp(secretB32: string, token: string, window = 1): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const secret = base32Decode(secretB32);
  const counter = Math.floor(Date.now() / 1000 / PERIOD);
  const provided = Buffer.from(token);
  for (let i = -window; i <= window; i += 1) {
    const candidate = Buffer.from(hotp(secret, counter + i));
    if (candidate.length === provided.length && timingSafeEqual(candidate, provided)) return true;
  }
  return false;
}

/** The current 6-digit code for a secret (used by tests; not used in request paths). */
export function totpToken(secretB32: string): string {
  return hotp(base32Decode(secretB32), Math.floor(Date.now() / 1000 / PERIOD));
}

/** otpauth:// URI for the QR code / manual entry in an authenticator app. */
export function otpauthUrl(secretB32: string, account: string, issuer = 'GI Internship'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Human-friendly one-time backup codes (plaintext shown once; store the hashes). */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const n = randomInt(0, 1_0000_0000); // 8 digits
    const s = String(n).padStart(8, '0');
    codes.push(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return codes;
}
