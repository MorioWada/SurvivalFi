const SUPABASE_URL = 'https://fgaukbpinknkiluvgzdq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6pu7euAl4FBbVgj1_O2BkA_Kynq6Bot';

export const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,  // Prevents auto-exchange that fails due to tracking prevention
    flowType: 'pkce',           // Explicit PKCE flow
    storage: {
      // Custom storage using localStorage to bypass cookie blocking from tracking prevention
      getItem: (key) => {
        try { return localStorage.getItem(key); } 
        catch (e) { return null; }
      },
      setItem: (key, value) => {
        try { localStorage.setItem(key, value); } 
        catch (e) {}
      },
      removeItem: (key) => {
        try { localStorage.removeItem(key); } 
        catch (e) {}
      },
    }
  },
  global: {
    headers: {
      'x-client-info': 'survivalfi-web'
    }
  }
});