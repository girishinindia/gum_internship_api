import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

/**
 * Service-role Supabase client — BYPASSES RLS by design (see 0003_rls.sql).
 * Used for Storage-adjacent helpers and admin operations; day-to-day SQL goes
 * through src/db/pool.ts. NEVER expose this key or client to a browser/app.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
