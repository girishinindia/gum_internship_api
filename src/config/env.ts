import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment loader for the Grow Up More / GI Internship deployment.
 *
 * The live .env uses the project's own variable names (SMS_API_KEY,
 * BUNNY_STORAGE_KEY, a single storage zone, PORT 8001, "15m"/"7d" TTLs, …).
 * To avoid touching the whole codebase, we ALIAS those onto the internal
 * field names the app already reads, then validate. Exact values are
 * preserved — this only maps names and fills operational defaults.
 */
const P = process.env;
const setDefault = (key: string, value: string): void => {
  if (P[key] === undefined || P[key] === '') P[key] = value;
};
const aliasFrom = (target: string, ...sources: string[]): void => {
  if (P[target] !== undefined && P[target] !== '') return;
  for (const s of sources) if (P[s] !== undefined && P[s] !== '') { P[target] = P[s]; return; }
};
const minutesFrom = (v: string | undefined, fallback: number): number => {
  if (!v) return fallback;
  const m = v.match(/^(\d+)\s*m$/i); if (m) return Number(m[1]);
  const h = v.match(/^(\d+)\s*h$/i); if (h) return Number(h[1]) * 60;
  const n = Number(v); return Number.isFinite(n) ? n : fallback;
};
const daysFrom = (v: string | undefined, fallback: number): number => {
  if (!v) return fallback;
  const d = v.match(/^(\d+)\s*d$/i); if (d) return Number(d[1]);
  const n = Number(v); return Number.isFinite(n) ? n : fallback;
};

// --- App / URLs ---
setDefault('API_BASE_URL', P.APP_URL ?? 'http://localhost:8001');
setDefault('WEB_APP_URL', 'http://localhost:3000');
setDefault('ADMIN_APP_URL', 'http://localhost:3100');
setDefault('DB_SCHEMA', 'intern');

// --- Auth ---
setDefault('JWT_ACCESS_TTL_MINUTES', String(minutesFrom(P.JWT_ACCESS_EXPIRES_IN, 15)));
setDefault('JWT_REFRESH_TTL_DAYS', String(daysFrom(P.JWT_REFRESH_EXPIRES_IN, 7)));
aliasFrom('BCRYPT_ROUNDS', 'BCRYPT_SALT_ROUNDS');
setDefault('BCRYPT_ROUNDS', '12');

// --- OTP ---
aliasFrom('OTP_TTL_MINUTES', 'OTP_EXPIRY_MINUTES');
aliasFrom('OTP_MAX_VERIFY_ATTEMPTS', 'OTP_MAX_ATTEMPTS');

// --- Email (Brevo) ---
aliasFrom('BREVO_SENDER_EMAIL', 'EMAIL_FROM');
aliasFrom('BREVO_SENDER_NAME', 'EMAIL_FROM_NAME');

// --- SMS (SMS Gateway Hub) ---
setDefault('SMS_GATEWAY_HUB_BASE_URL', 'https://www.smsgatewayhub.com/api/mt/SendSMS');
aliasFrom('SMS_GATEWAY_HUB_API_KEY', 'SMS_API_KEY');
aliasFrom('SMS_GATEWAY_HUB_SENDER_ID', 'SMS_SENDER_ID');
aliasFrom('SMS_DLT_ENTITY_ID', 'SMS_ENTITY_ID');
aliasFrom('SMS_DLT_TEMPLATE_ID_OTP', 'SMS_DLT_TEMPLATE_ID');

// --- FCM (not configured in this deployment yet) ---
setDefault('FCM_PROJECT_ID', 'unset');
setDefault('FCM_CLIENT_EMAIL', 'unset@example.com');
setDefault('FCM_PRIVATE_KEY', 'unset');

// --- Bunny: ONE storage zone in this deployment → fill both public+private slots ---
aliasFrom('BUNNY_STORAGE_PUBLIC_ZONE', 'BUNNY_STORAGE_ZONE');
aliasFrom('BUNNY_STORAGE_PUBLIC_API_KEY', 'BUNNY_STORAGE_KEY');
aliasFrom('BUNNY_STORAGE_PUBLIC_CDN_URL', 'BUNNY_CDN_URL');
aliasFrom('BUNNY_STORAGE_PRIVATE_ZONE', 'BUNNY_STORAGE_ZONE');
aliasFrom('BUNNY_STORAGE_PRIVATE_API_KEY', 'BUNNY_STORAGE_KEY');
aliasFrom('BUNNY_STORAGE_PRIVATE_CDN_URL', 'BUNNY_CDN_URL');
aliasFrom('BUNNY_PRIVATE_URL_TOKEN_KEY', 'BUNNY_STREAM_TOKEN_KEY');
// Bunny Stream
aliasFrom('BUNNY_STREAM_TOKEN_AUTH_KEY', 'BUNNY_STREAM_TOKEN_KEY');
if (!P.BUNNY_STREAM_CDN_HOSTNAME && P.BUNNY_STREAM_CDN) {
  P.BUNNY_STREAM_CDN_HOSTNAME = P.BUNNY_STREAM_CDN.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}
setDefault('BUNNY_STREAM_WEBHOOK_SECRET', 'set-me-when-bunny-webhook-configured');

// --- Razorpay (LIVE keys in this deployment — webhook secret set in dashboard) ---
setDefault('RAZORPAY_WEBHOOK_SECRET', 'set-me-when-razorpay-webhook-configured');

// trim CDN URLs to no-trailing-slash for predictable joins
for (const k of ['BUNNY_STORAGE_PUBLIC_CDN_URL', 'BUNNY_STORAGE_PRIVATE_CDN_URL']) {
  if (P[k]) P[k] = (P[k] as string).replace(/\/+$/, '');
}

const bool = (def: 'true' | 'false'): z.ZodEffects<z.ZodDefault<z.ZodString>, boolean, string | undefined> =>
  z.string().default(def).transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_BASE_URL: z.string().url(),
  WEB_APP_URL: z.string().url(),
  ADMIN_APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1).transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  // Database
  DATABASE_URL: z.string().min(1),
  DB_SCHEMA: z.string().min(1).default('intern'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Auth / security
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars'),

  // Notification behaviour (master + per-channel; SMS defaults safe-off)
  NOTIFY_DRY_RUN: bool('false'),
  EMAIL_DRY_RUN: bool('false'),
  SMS_DRY_RUN: bool('true'),
  SMS_FORCE_SEND: bool('false'),

  // OTP
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(3),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  SMS_GATEWAY_HUB_BASE_URL: z.string().url(),
  SMS_GATEWAY_HUB_API_KEY: z.string().min(1),
  SMS_GATEWAY_HUB_SENDER_ID: z.string().min(1),
  SMS_DLT_ENTITY_ID: z.string().min(1),
  SMS_DLT_TEMPLATE_ID_OTP: z.string().min(1),
  SMS_ROUTE: z.string().default('clickhere'),
  SMS_CHANNEL: z.string().default('2'),
  SMS_DCS: z.string().default('0'),
  SMS_FLASH: z.string().default('0'),

  // Email
  BREVO_API_KEY: z.string().min(1),
  BREVO_SENDER_EMAIL: z.string().email(),
  BREVO_SENDER_NAME: z.string().min(1),
  EMAIL_ADMIN_NOTIFY: z.string().email().optional(),

  // Push (optional in this deployment)
  FCM_PROJECT_ID: z.string().min(1),
  FCM_CLIENT_EMAIL: z.string().email(),
  FCM_PRIVATE_KEY: z.string().min(1),

  // Bunny Storage (single zone mapped onto both slots)
  BUNNY_STORAGE_PUBLIC_ZONE: z.string().min(1),
  BUNNY_STORAGE_PUBLIC_API_KEY: z.string().min(1),
  BUNNY_STORAGE_PUBLIC_CDN_URL: z.string().url(),
  BUNNY_STORAGE_PRIVATE_ZONE: z.string().min(1),
  BUNNY_STORAGE_PRIVATE_API_KEY: z.string().min(1),
  BUNNY_STORAGE_PRIVATE_CDN_URL: z.string().url(),
  BUNNY_SIGNED_URL_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  BUNNY_PRIVATE_URL_TOKEN_KEY: z.string().min(1),

  // Bunny Stream
  BUNNY_STREAM_LIBRARY_ID: z.string().min(1),
  BUNNY_STREAM_API_KEY: z.string().min(1),
  BUNNY_STREAM_CDN_HOSTNAME: z.string().min(1),
  BUNNY_STREAM_TOKEN_AUTH_KEY: z.string().min(1),
  BUNNY_STREAM_PLAYBACK_TTL_HOURS: z.coerce.number().int().positive().default(4),
  BUNNY_STREAM_WEBHOOK_SECRET: z.string().min(1),
  STORAGE_DRY_RUN: bool('false'),

  // Razorpay (LIVE)
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  PAYMENTS_DRY_RUN: bool('false'),

  // Live providers (Zoom optional)
  LIVE_DRY_RUN: bool('true'),
  SEQUENTIAL_UNLOCK: bool('true'),
  BUNNY_TOKEN_IP_LOCK: bool('false'),
  ZOOM_ACCOUNT_ID: z.string().optional().default(''),
  ZOOM_CLIENT_ID: z.string().optional().default(''),
  ZOOM_CLIENT_SECRET: z.string().optional().default(''),

  // Business config
  GST_HOME_STATE: z.string().min(2).default('Gujarat'),
  GATEWAY_FEE_PERCENT: z.coerce.number().min(0).max(10).default(2),
  GST_RATE_PERCENT: z.coerce.number().min(0).max(100).default(18),
  REFUND_WINDOW_DAYS: z.coerce.number().int().min(0).default(7),
  SEAT_HOLD_MINUTES: z.coerce.number().int().positive().default(30),
  INVOICE_SERIES_PREFIX: z.string().min(1).default('GI'),
  CERTIFICATE_NO_PREFIX: z.string().min(1).default('GUM'),
  CERTIFICATE_VERIFY_BASE_URL: z.string().url(),

  // Rate limiting
  RATE_LIMIT_GENERAL_PER_MINUTE: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_OTP_PER_MINUTE: z.coerce.number().int().positive().default(5),

  // --- AI layer (R2) ---------------------------------------------------
  // Keys ship in the deployment .env. When a key is 'unset' the matching
  // provider is treated as not configured and the feature degrades safely
  // (AI_DRY_RUN behaviour). Chat = Anthropic; embeddings = OpenAI.
  ANTHROPIC_API_KEY: z.string().min(1).default('unset'),
  OPENAI_API_KEY: z.string().min(1).default('unset'),
  GOOGLE_API_KEY: z.string().min(1).default('unset'),
  AI_DRY_RUN: bool('false'),
  AI_CHAT_MODEL: z.string().min(1).default('claude-3-5-haiku-20241022'),
  AI_CHAT_MODEL_FALLBACK: z.string().min(1).default('gpt-4o-mini'),
  AI_EMBED_MODEL: z.string().min(1).default('text-embedding-3-small'),
  AI_EMBED_DIM: z.coerce.number().int().positive().default(1536),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1024),
  // Per-user daily spend ceiling across all AI features (USD). 0 = unlimited.
  AI_DAILY_COST_CAP_USD: z.coerce.number().min(0).default(0.5),
  AI_TRANSLATE_MODEL: z.string().min(1).default('claude-3-5-haiku-20241022'),

  // --- Observability (Sentry) — all optional; unset = disabled (dev/test no-op) ---
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // --- Redis (optional) — distributed rate-limiting + cache. Unset = in-memory. ---
  REDIS_URL: z.string().optional(),

  // --- Background jobs ---
  // 'inproc' = the original in-process serial queue (default, unchanged behaviour).
  // 'pg'     = durable Postgres-backed queue (survives restarts, retries on failure).
  JOB_QUEUE_DRIVER: z.enum(['inproc', 'pg']).default('inproc'),
  JOB_QUEUE_POLL_MS: z.coerce.number().int().positive().default(2000),
  JOB_QUEUE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ✗ ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`\nFATAL: invalid environment configuration\n${issues}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
