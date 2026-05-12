const SUPABASE_URL = 'https://fgaukbpinknkiluvgzdq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6pu7euAl4FBbVgj1_O2BkA_Kynq6Bot';

export const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,  // ← CRITICAL: This exchanges the auth code!
    flowType: 'pkce'             // ← Explicit PKCE flow
  }
});