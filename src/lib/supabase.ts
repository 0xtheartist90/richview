// The database, from the server only: the service role key bypasses RLS, so it must never reach the browser.
import 'server-only';

import { type SupabaseClient, createClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

export function db(): SupabaseClient {
    if (client) return client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    return client;
}
