const SUPABASE_URL = 'https://fgaukbpinknkiluvgzdq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6pu7euAl4FBbVgj1_O2BkA_Kynq6Bot';

export const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);