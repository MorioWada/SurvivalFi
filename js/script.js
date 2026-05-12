// ===== SurvivalFi - Main Application (Supabase Edition v5) =====
// Dual mode: localStorage (offline) | Supabase (signed in)
// Fixes: PKCE code verifier stored in localStorage (not cookies), manual token exchange,
// expense_subtype type handling, Edge tracking prevention compatibility

import { supabaseClient } from './supabase.js';

(function () {
  'use strict';

  // ===== Early Error Handler =====
  window.addEventListener('error', function(e) {
    console.error('Global error:', e.message, e.filename, e.lineno);
    const debugDiv = document.getElementById('debug-output');
    if (debugDiv) {
      debugDiv.innerHTML += '<div style="color:red;font-size:12px;">ERROR: ' + e.message + '</div>';
    }
  });

  // ===== Check Supabase Availability =====
  if (typeof supabase === 'undefined') {
    console.error('Supabase library not loaded! Check that https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 is accessible.');
    document.body.innerHTML = '<div style="padding:2rem;text-align:center;"><h2>Loading Error</h2><p>The Supabase library failed to load. This may be due to tracking prevention blocking the CDN.</p><p>Try disabling tracking prevention for this site or use a different browser.</p></div>';
    return;
  }

  // ===== State =====
  const state = {
    user: null,
    transactions: [],
    notifications: [],
    settings: {
      survivalThreshold: 20,
      impulsiveThreshold: 10,
      monthlyIncome: 0,
      monthlyFixed: 0,
      monthlyBudget: 0,
      theme: 'dark',
    },
    isRegistering: false,
    isLocalMode: false,
    supabaseCategories: [],
  };

  // ===== Constants =====
  const SUPABASE_URL = 'https://fgaukbpinknkiluvgzdq.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_6pu7euAl4FBbVgj1_O2BkA_Kynq6Bot';
  const PKCE_STORAGE_KEY = 'survivalfi_pkce_verifier';
  const SESSION_STORAGE_KEY = 'survivalfi_session';

  // ===== Category Config (local fallback) =====
  const CATEGORIES = {
    food:            { emoji: '\ud83c\udf5c', label: 'Food',             color: '#f59e0b', type: 'expense', expenseSubtype: ['variable', 'fixed'] },
    transportation:  { emoji: '\ud83d\ude97', label: 'Transportation',   color: '#3b82f6', type: 'expense', expenseSubtype: ['variable', 'fixed'] },
    housing:         { emoji: '\ud83c\udfe0', label: 'Housing',          color: '#8b5cf6', type: 'expense', expenseSubtype: ['fixed'] },
    utilities:       { emoji: '\ud83d\udca1', label: 'Utilities',        color: '#eab308', type: 'expense', expenseSubtype: ['fixed', 'variable'] },
    entertainment:   { emoji: '\ud83c\udfac', label: 'Entertainment',    color: '#ec4899', type: 'expense', expenseSubtype: ['variable'] },
    healthcare:      { emoji: '\ud83c\udfe5', label: 'Healthcare',       color: '#ef4444', type: 'expense', expenseSubtype: ['fixed', 'variable'] },
    shopping:        { emoji: '\ud83d\udecd\ufe0f', label: 'Shopping',         color: '#14b8a6', type: 'expense', expenseSubtype: ['variable'] },
    education:       { emoji: '\ud83d\udcda', label: 'Education',        color: '#6366f1', type: 'expense', expenseSubtype: ['fixed'] },
    salary:          { emoji: '\ud83d\udcbc', label: 'Salary',           color: '#22c55e', type: 'income' },
    freelance:       { emoji: '\ud83d\udcbb', label: 'Freelance',        color: '#06b6d4', type: 'income' },
    investment:      { emoji: '\ud83d\udcc8', label: 'Investment',       color: '#a855f7', type: 'income' },
    other:           { emoji: '\ud83d\udce6', label: 'Other',            color: '#94a3b8', type: 'both',    expenseSubtype: ['variable', 'fixed'] },
  };

  const IMPULSIVE_CATEGORIES = ['entertainment', 'shopping'];

  // ===== DOM Helpers =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ===== PKCE Helpers (manual, bypassing cookie storage blocks) =====
  function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const array = Array.from(new Uint8Array(digest));
    return btoa(String.fromCharCode.apply(null, array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  function storePkceVerifier(verifier) {
    try {
      localStorage.setItem(PKCE_STORAGE_KEY, verifier);
      debugLog('PKCE verifier stored (' + verifier.substring(0, 8) + '...)');
    } catch (e) {
      debugLog('Failed to store PKCE verifier: ' + e.message);
      console.error('Failed to store PKCE verifier:', e);
    }
  }

  function getPkceVerifier() {
    try {
      const v = localStorage.getItem(PKCE_STORAGE_KEY);
      if (v) {
        debugLog('PKCE verifier retrieved (' + v.substring(0, 8) + '...)');
      } else {
        debugLog('PKCE verifier NOT found in localStorage');
      }
      return v;
    } catch (e) {
      debugLog('Failed to get PKCE verifier: ' + e.message);
      console.error('Failed to get PKCE verifier:', e);
      return null;
    }
  }

  function clearPkceVerifier() {
    try {
      localStorage.removeItem(PKCE_STORAGE_KEY);
    } catch (e) {
      console.error('Failed to clear PKCE verifier:', e);
    }
  }

  // ===== Manual Token Exchange (bypasses cookie-based verifier issues) =====
  async function manualExchangeCodeForSession(authCode, codeVerifier) {
    debugLog('Manual token exchange starting...');
    try {
      const requestBody = {
        auth_code: authCode,
        code_verifier: codeVerifier,
      };
      debugLog('Sending token request to Supabase...');

      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog('Token exchange HTTP error: ' + response.status + ' - ' + errorText);
        throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
      }

      const tokenData = await response.json();
      debugLog('Token exchange HTTP success, got tokens');

      if (!tokenData.access_token) {
        debugLog('No access_token in response: ' + JSON.stringify(tokenData));
        throw new Error('No access_token in token response');
      }

      // Set session in supabase client
      debugLog('Setting session in Supabase client...');
      const { data, error } = await supabaseClient.auth.setSession({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
      });

      if (error) {
        debugLog('setSession error: ' + error.message);
        throw error;
      }

      debugLog('Session set successfully');
      return { session: data.session, user: data.session?.user };
    } catch (err) {
      debugLog('Manual exchange error: ' + err.message);
      console.error('Manual exchange error:', err);
      throw err;
    }
  }

  // ===== Session Persistence (manual, bypassing blocked localStorage) =====
  function storeSession(session) {
    try {
      const sessionData = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: {
          id: session.user.id,
          email: session.user.email,
        },
      };
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
      debugLog('Session stored in localStorage');
    } catch (e) {
      debugLog('Failed to store session: ' + e.message);
      console.error('Failed to store session:', e);
    }
  }

  async function restoreSession() {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!saved) {
        debugLog('No saved session in localStorage');
        return false;
      }

      const sessionData = JSON.parse(saved);
      if (!sessionData.access_token || !sessionData.refresh_token) {
        debugLog('Saved session missing tokens');
        return false;
      }

      debugLog('Restoring session from localStorage...');
      const { data, error } = await supabaseClient.auth.setSession({
        access_token: sessionData.access_token,
        refresh_token: sessionData.refresh_token,
      });

      if (error) {
        debugLog('Session restore failed: ' + error.message);
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return false;
      }

      if (data.session) {
        state.user = { id: data.session.user.id, email: data.session.user.email };
        state.isLocalMode = false;
        debugLog('Session restored for: ' + state.user.email);
        return true;
      }
    } catch (e) {
      debugLog('Failed to restore session: ' + e.message);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    return false;
  }

  // ===== Debug Helper =====
  function debugLog(msg) {
    console.log('[SurvivalFi]', msg);
    // Also show on page for debugging
    const debugDiv = document.getElementById('debug-output');
    if (debugDiv) {
      debugDiv.innerHTML += '<div style="font-size:12px;color:#888;">' + msg + '</div>';
    }
  }

  // ===== Initialization =====
  async function init() {
    debugLog('Initializing...');

    // EARLY CHECK: Look for OAuth code BEFORE anything else
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const hasCode = !!authCode;
    debugLog('Has auth code: ' + hasCode + (hasCode ? ' (' + authCode.substring(0,8) + '...)' : ''));

    await loadFromStorage();
    debugLog('Storage loaded. User: ' + (state.user?.email || 'none'));

    // STEP 1: Handle OAuth callback (PKCE code in URL)
    if (authCode && !state.user) {
      debugLog('PKCE: Processing authorization code...');

      // Show loading state on auth screen
      const authScreen = document.getElementById('auth-screen');
      if (authScreen) {
        authScreen.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;"><h2>Signing you in...</h2><p>Please wait while we complete authentication.</p></div>';
      }

      const codeVerifier = getPkceVerifier();
      debugLog('PKCE verifier found: ' + !!codeVerifier);

      if (codeVerifier) {
        try {
          debugLog('PKCE: Attempting manual token exchange...');
          const result = await manualExchangeCodeForSession(authCode, codeVerifier);
          if (result && result.session) {
            state.user = { id: result.user.id, email: result.user.email };
            state.isLocalMode = false;
            storeSession(result.session);
            clearPkceVerifier();
            window.history.replaceState(null, '', window.location.pathname);
            debugLog('PKCE: Session established!');
          } else {
            debugLog('PKCE: Manual exchange returned no session');
            window.history.replaceState(null, '', window.location.pathname);
          }
        } catch (err) {
          debugLog('PKCE manual exchange failed: ' + err.message);
          console.error(err);
          window.history.replaceState(null, '', window.location.pathname);
        }
      } else {
        debugLog('PKCE: No verifier found, trying built-in exchange...');
        try {
          const { data, error } = await supabaseClient.auth.exchangeCodeForSession(authCode);
          if (error) throw error;
          if (data && data.session) {
            state.user = { id: data.session.user.id, email: data.session.user.email };
            state.isLocalMode = false;
            storeSession(data.session);
            window.history.replaceState(null, '', window.location.pathname);
            debugLog('PKCE: Session established via built-in exchange');
          } else {
            debugLog('PKCE: Built-in exchange returned no session');
            window.history.replaceState(null, '', window.location.pathname);
          }
        } catch (err2) {
          debugLog('PKCE built-in exchange failed: ' + err2.message);
          console.error(err2);
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    }

    // STEP 2: Try restoring session from localStorage
    if (!state.user) {
      debugLog('Trying to restore session from localStorage...');
      const restored = await restoreSession();
      debugLog('Session restored: ' + restored);
      if (restored) {
        await syncFromSupabase();
      }
    }

    // STEP 3: Try normal session check
    if (!state.user) {
      debugLog('Checking existing Supabase session...');
      await checkAuthSession();
      debugLog('After checkAuthSession, user: ' + (state.user?.email || 'none'));
    }

    // STEP 4: Hash token fallback
    if (!state.user && !state.isLocalMode && window.location.hash.includes('access_token')) {
      debugLog('Trying hash token fallback...');
      await recoverSessionFromHash();
    }

    debugLog('Loading categories...');
    await loadCategoriesFromSupabase();

    debugLog('Setting up UI...');
    setupAuth();
    setupNavigation();
    setupMobileMenu();
    setupQuickAdd();
    setupTransactionForm();
    setupSettings();
    setupNotifications();
    setupModal();
    setupFilters();
    setupExportClear();
    setupThemeToggle();
    setupCategoryFiltering();

    if (state.user || state.isLocalMode) {
      debugLog('Showing app for user: ' + (state.user?.email || 'Local User'));
      showApp();
    } else {
      debugLog('No user, showing auth screen');
    }

    debugLog('Init complete.');
  }

  // ===== Auth Session Check =====
  async function checkAuthSession() {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (session?.user) {
        state.user = {
          id: session.user.id,
          email: session.user.email,
        };
        state.isLocalMode = false;
        await syncFromSupabase();
      }
    } catch (err) {
      console.warn('Session check failed:', err);
    }
  }

  // ===== FALLBACK: Recover session from URL hash tokens =====
  async function recoverSessionFromHash() {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return false;

    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken) return false;

    console.log('Recovering session from URL hash tokens (implicit grant fallback)');

    try {
      const { data, error } = await supabaseClient.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || '',
      });

      if (error) throw error;

      if (data.session) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);

        state.user = { id: data.session.user.id, email: data.session.user.email };
        state.isLocalMode = false;
        storeSession(data.session);
        await syncFromSupabase();
        saveToStorage();
        showApp();
        showToast('Signed in successfully!', 'success');
        return true;
      }
    } catch (err) {
      console.error('Hash session recovery failed:', err);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      showToast('Sign-in failed. Please try again.', 'error');
    }
    return false;
  }

  // ===== Categories from Supabase =====
  async function loadCategoriesFromSupabase() {
    try {
      const { data, error } = await supabaseClient
        .from('categories')
        .select('*');
      if (error) throw error;
      if (data && data.length > 0) {
        state.supabaseCategories = data;
      }
    } catch (err) {
      console.warn('Failed to load categories from Supabase, using local fallback:', err);
    }
  }

  function getCategoryConfig(key) {
    const supa = state.supabaseCategories.find(c => c.key === key);
    if (supa) {
      let subtypes = null;
      if (supa.expense_subtype) {
        try {
          subtypes = JSON.parse(supa.expense_subtype);
        } catch (e) {
          if (typeof supa.expense_subtype === 'string') {
            subtypes = supa.expense_subtype.split(',').map(s => s.trim());
          } else if (Array.isArray(supa.expense_subtype)) {
            subtypes = supa.expense_subtype;
          } else {
            subtypes = [];
          }
        }
      }
      return {
        emoji: supa.emoji,
        label: supa.label,
        color: supa.color,
        type: supa.type,
        expenseSubtype: subtypes,
      };
    }
    return CATEGORIES[key] || CATEGORIES.other;
  }

  // ===== Storage =====
  async function loadFromStorage() {
    try {
      const saved = localStorage.getItem('survivalfi_data');
      if (saved) {
        const data = JSON.parse(saved);
        state.user = data.user || null;
        state.transactions = data.transactions || [];
        state.notifications = data.notifications || [];
        state.settings = { ...state.settings, ...data.settings };
        state.isLocalMode = data.isLocalMode || false;
      }
    } catch (e) {
      console.warn('Failed to load storage', e);
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem('survivalfi_data', JSON.stringify({
        user: state.user,
        transactions: state.transactions,
        notifications: state.notifications,
        settings: state.settings,
        isLocalMode: state.isLocalMode,
      }));
    } catch (e) {
      console.warn('Failed to save storage', e);
    }
  }

  // ===== Supabase Sync (Merge, don't overwrite) =====
  async function syncFromSupabase() {
    if (!state.user?.id) return;
    try {
      const [txRes, notifRes, settingsRes] = await Promise.all([
        supabaseClient.from('transactions').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }),
        supabaseClient.from('notifications').select('*').eq('user_id', state.user.id).order('timestamp', { ascending: false }),
        supabaseClient.from('settings').select('*').eq('user_id', state.user.id).maybeSingle(),
      ]);

      if (txRes.data) {
        const supaTx = txRes.data.map(t => ({
          id: t.id,
          type: t.type,
          amount: parseFloat(t.amount),
          category: t.category_key,
          expenseType: t.expense_type,
          description: t.description,
          date: t.date,
          createdAt: t.created_at,
        }));
        const localIds = new Set(state.transactions.map(t => t.id));
        const newFromSupa = supaTx.filter(t => !localIds.has(t.id));
        state.transactions = [...state.transactions, ...newFromSupa];
        state.transactions.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
      }

      if (notifRes.data) {
        const supaNotif = notifRes.data.map(n => ({
          id: n.id,
          type: n.type,
          text: n.text,
          timestamp: n.timestamp,
        }));
        const localIds = new Set(state.notifications.map(n => n.id));
        const newFromSupa = supaNotif.filter(n => !localIds.has(n.id));
        state.notifications = [...state.notifications, ...newFromSupa];
        state.notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }

      if (settingsRes.data && !settingsRes.error) {
        state.settings = {
          survivalThreshold: settingsRes.data.survival_threshold ?? state.settings.survivalThreshold,
          impulsiveThreshold: settingsRes.data.impulsive_threshold ?? state.settings.impulsiveThreshold,
          monthlyIncome: parseFloat(settingsRes.data.monthly_income) || state.settings.monthlyIncome,
          monthlyFixed: parseFloat(settingsRes.data.monthly_fixed) || state.settings.monthlyFixed,
          monthlyBudget: parseFloat(settingsRes.data.monthly_budget) || state.settings.monthlyBudget,
          theme: settingsRes.data.theme || state.settings.theme,
        };
      }

      saveToStorage();
    } catch (err) {
      console.warn('Failed to sync from Supabase:', err);
    }
  }

  // ===== Upload local data to Supabase (on first sign-in) =====
  async function uploadLocalDataToSupabase() {
    if (!state.user?.id) return;
    try {
      for (const tx of state.transactions) {
        await syncTransactionToSupabase(tx);
      }
      await syncSettingsToSupabase();
    } catch (err) {
      console.warn('Failed to upload local data:', err);
    }
  }

  // ===== Toast =====
  function showToast(message, type = 'info') {
    const container = $('#toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ===== Supabase Auth =====
  function setupAuth() {
    const form = $('#auth-form');
    const toggle = $('#auth-toggle');
    const title = $('#auth-title');
    const submitBtn = $('#auth-submit');
    const forgotLink = $('#auth-forgot-link');

    toggle.addEventListener('click', () => {
      state.isRegistering = !state.isRegistering;
      title.textContent = state.isRegistering ? 'Create Account' : 'Sign In';
      submitBtn.textContent = state.isRegistering ? 'Create Account' : 'Sign In';
      toggle.textContent = state.isRegistering ? 'Already have an account? Sign In' : 'Create Account';
      forgotLink.style.display = state.isRegistering ? 'none' : 'inline';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#auth-email').value.trim();
      const password = $('#auth-password').value;

      if (!email || !password) {
        showToast('Please enter email and password', 'error');
        return;
      }

      try {
        let result;
        if (state.isRegistering) {
          result = await supabaseClient.auth.signUp({ email, password });
          if (result.error) throw result.error;
          state.user = { id: result.data.user.id, email: result.data.user.email };
          state.isLocalMode = false;
          await uploadLocalDataToSupabase();
          await syncFromSupabase();
          saveToStorage();
          showApp();
          showToast('Account created! Check your email for verification.', 'success');
        } else {
          result = await supabaseClient.auth.signInWithPassword({ email, password });
          if (result.error) throw result.error;
          state.user = { id: result.data.user.id, email: result.data.user.email };
          state.isLocalMode = false;
          await uploadLocalDataToSupabase();
          await syncFromSupabase();
          saveToStorage();
          showApp();
          showToast('Signed in successfully!', 'success');
        }
      } catch (err) {
        showToast(err.message || 'Authentication failed', 'error');
      }
    });

    forgotLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = $('#auth-email').value.trim();
      if (!email) {
        showToast('Please enter your email first', 'error');
        return;
      }
      try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        showToast('Password reset email sent! Check your inbox.', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to send reset email', 'error');
      }
    });

    // ===== Google OAuth with manual PKCE =====
    $('#oauth-google').addEventListener('click', async () => {
      try {
        debugLog('Starting Google OAuth with manual PKCE...');

        // Generate PKCE pair manually
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        storePkceVerifier(codeVerifier);

        debugLog('PKCE pair generated, getting OAuth URL from Supabase...');

        // Use Supabase's signInWithOAuth but with our PKCE
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: 'google',
          options: { 
            redirectTo: 'https://survivalfi.moriowada.com',
            skipBrowserRedirect: true,
          },
        });

        if (error) {
          debugLog('signInWithOAuth error: ' + error.message);
          throw error;
        }

        if (data?.url) {
          debugLog('Got OAuth URL from Supabase, appending PKCE challenge...');
          // Append our PKCE code challenge to the URL
          const url = new URL(data.url);
          url.searchParams.set('code_challenge', codeChallenge);
          url.searchParams.set('code_challenge_method', 'S256');
          debugLog('Redirecting to: ' + url.hostname + '...');
          window.location.href = url.toString();
        } else {
          debugLog('No OAuth URL returned from Supabase');
          showToast('Failed to get OAuth URL', 'error');
        }
      } catch (err) {
        debugLog('Google sign-in error: ' + err.message);
        console.error('Google sign-in error:', err);
        showToast(err.message || 'Google sign-in failed', 'error');
      }
    });

    // ===== GitHub OAuth =====
    $('#oauth-github').addEventListener('click', async () => {
      try {
        console.log('Starting GitHub OAuth...');

        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: 'github',
          options: { 
            redirectTo: 'https://survivalfi.moriowada.com',
          },
        });

        if (error) throw error;

        if (data?.url) {
          window.location.href = data.url;
        }
      } catch (err) {
        console.error('GitHub sign-in error:', err);
        showToast(err.message || 'GitHub sign-in failed', 'error');
      }
    });

    $('#auth-local-mode').addEventListener('click', () => {
      state.isLocalMode = true;
      state.user = null;
      saveToStorage();
      showApp();
      showToast('Using local mode - data stays on this device', 'info');
    });

    // ===== Auth State Change Listener =====
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);

      if (event === 'SIGNED_IN' && session?.user) {
        state.user = { id: session.user.id, email: session.user.email };
        state.isLocalMode = false;
        storeSession(session);
        await uploadLocalDataToSupabase();
        await syncFromSupabase();
        saveToStorage();
        if (!$('#app-screen').classList.contains('active')) {
          showApp();
        }
        showToast('Signed in successfully!', 'success');
      }
      if (event === 'SIGNED_OUT') {
        state.user = null;
        state.isLocalMode = false;
        localStorage.removeItem(SESSION_STORAGE_KEY);
        saveToStorage();
        $('#app-screen').classList.remove('active');
        $('#auth-screen').classList.add('active');
        showToast('Signed out', 'info');
      }
    });
  }

  // ===== Supabase Database Operations =====
  async function syncTransactionToSupabase(tx) {
    if (!state.user?.id || state.isLocalMode) return;
    try {
      await supabaseClient.from('transactions').upsert({
        id: tx.id,
        user_id: state.user.id,
        type: tx.type,
        amount: tx.amount,
        category_key: tx.category,
        expense_type: tx.expenseType,
        description: tx.description,
        date: tx.date,
        created_at: tx.createdAt,
      });
    } catch (err) {
      console.warn('Sync transaction failed:', err);
    }
  }

  async function deleteTransactionFromSupabase(txId) {
    if (!state.user?.id || state.isLocalMode) return;
    try {
      await supabaseClient.from('transactions').delete().eq('id', txId);
    } catch (err) {
      console.warn('Delete sync failed:', err);
    }
  }

  async function syncNotificationToSupabase(notif) {
    if (!state.user?.id || state.isLocalMode) return;
    try {
      await supabaseClient.from('notifications').upsert({
        id: notif.id,
        user_id: state.user.id,
        type: notif.type,
        text: notif.text,
        timestamp: notif.timestamp,
      });
    } catch (err) {
      console.warn('Sync notification failed:', err);
    }
  }

  async function syncSettingsToSupabase() {
    if (!state.user?.id || state.isLocalMode) return;
    try {
      await supabaseClient.from('settings').upsert({
        user_id: state.user.id,
        monthly_income: state.settings.monthlyIncome,
        monthly_fixed: state.settings.monthlyFixed,
        monthly_budget: state.settings.monthlyBudget,
        survival_threshold: state.settings.survivalThreshold,
        impulsive_threshold: state.settings.impulsiveThreshold,
        theme: state.settings.theme,
      });
    } catch (err) {
      console.warn('Sync settings failed:', err);
    }
  }

  // ===== Show App =====
  function showApp() {
    $('#auth-screen').classList.remove('active');
    $('#app-screen').classList.add('active');
    $('#user-email').textContent = state.user?.email || 'Local User';
    $('#user-avatar').textContent = (state.user?.email || 'L')[0].toUpperCase();
    applySettingsToUI();
    refreshAll();
  }

  // ===== Navigation =====
  function setupNavigation() {
    $$('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        $$('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        $$('.tab-content').forEach(t => t.classList.remove('active'));
        $(`#tab-${tab}`).classList.add('active');
        $('#page-title').textContent = item.querySelector('span')?.textContent || tab;
      });
    });

    $$('[data-tab]').forEach(btn => {
      if (!btn.classList.contains('nav-item')) {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab;
          $$('.nav-item').forEach(n => n.classList.remove('active'));
          $(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');
          $$('.tab-content').forEach(t => t.classList.remove('active'));
          $(`#tab-${tab}`).classList.add('active');
          $('#page-title').textContent = $(`.nav-item[data-tab="${tab}"] span`)?.textContent || tab;
        });
      }
    });

    $('#logout-btn').addEventListener('click', async () => {
      if (state.user) {
        await supabaseClient.auth.signOut().catch(() => {});
      }
      state.user = null;
      state.isLocalMode = false;
      localStorage.removeItem(SESSION_STORAGE_KEY);
      saveToStorage();
      $('#app-screen').classList.remove('active');
      $('#auth-screen').classList.add('active');
      showToast('Signed out', 'info');
    });
  }

  // ===== Mobile Menu =====
  function setupMobileMenu() {
    const hamburger = $('#hamburger-btn');
    const sidebar = $('.sidebar');
    const overlay = $('#sidebar-overlay');

    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    }

    hamburger.addEventListener('click', () => {
      if (sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        sidebar.classList.add('open');
        overlay.classList.add('active');
      }
    });

    overlay.addEventListener('click', closeSidebar);

    $$('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 640) closeSidebar();
      });
    });
  }

  // ===== Quick Add =====
  function setupQuickAdd() {
    const form = $('#quick-add-form');
    const typeSelect = $('#qa-type');
    const expenseTypeSelect = $('#qa-expense-type');

    typeSelect.addEventListener('change', () => {
      const isIncome = typeSelect.value === 'income';
      expenseTypeSelect.closest('.form-group').style.display = isIncome ? 'none' : '';
      updateQaCategories();
    });

    expenseTypeSelect.addEventListener('change', updateQaCategories);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = parseFloat($('#qa-amount').value);
      if (!amount || amount <= 0) {
        showToast('Enter a valid amount', 'error');
        return;
      }

      const tx = createTransaction({
        type: typeSelect.value,
        amount,
        category: $('#qa-category').value,
        expenseType: typeSelect.value === 'income' ? 'none' : $('#qa-expense-type').value,
        description: $('#qa-desc').value || getCategoryConfig($('#qa-category').value)?.label || 'Transaction',
      });

      addTransaction(tx);
      form.reset();
      typeSelect.value = 'expense';
      expenseTypeSelect.value = 'variable';
      expenseTypeSelect.closest('.form-group').style.display = '';
      updateQaCategories();
      showToast('Transaction added!', 'success');
    });
  }

  // ===== Transaction Form (Modal) =====
  function setupTransactionForm() {
    const form = $('#transaction-form');

    $$('#transaction-form .toggle-group').forEach(group => {
      const toggles = group.querySelectorAll('.toggle');
      toggles.forEach(t => {
        t.addEventListener('click', () => {
          toggles.forEach(b => b.classList.remove('active'));
          t.classList.add('active');
          if (t.dataset.value) {
            $('#tx-type').value = t.dataset.value;
            const isIncome = t.dataset.value === 'income';
            $('#expense-type-group').style.display = isIncome ? 'none' : '';
            updateTxCategories();
          }
          if (t.dataset.expense) {
            $('#tx-expense-type').value = t.dataset.expense;
            updateTxCategories();
          }
        });
      });
    });

    $('#tx-date').value = new Date().toISOString().split('T')[0];

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = parseFloat($('#tx-amount').value);
      if (!amount || amount <= 0) {
        showToast('Enter a valid amount', 'error');
        return;
      }

      const tx = createTransaction({
        type: $('#tx-type').value,
        amount,
        category: $('#tx-category').value,
        expenseType: $('#tx-type').value === 'income' ? 'none' : $('#tx-expense-type').value,
        description: $('#tx-desc').value || getCategoryConfig($('#tx-category').value)?.label || 'Transaction',
        date: $('#tx-date').value,
      });

      addTransaction(tx);
      closeModal();
      form.reset();
      $('#tx-date').value = new Date().toISOString().split('T')[0];
      updateTxCategories();
      showToast('Transaction added!', 'success');
    });
  }

  // ===== Transaction CRUD =====
  function createTransaction({ type, amount, category, expenseType, description, date }) {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      type,
      amount,
      category,
      expenseType: type === 'income' ? 'none' : expenseType,
      description,
      date: date || new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
    };
  }

  function addTransaction(tx) {
    state.transactions.unshift(tx);
    saveToStorage();
    syncTransactionToSupabase(tx);
    refreshAll();
  }

  function deleteTransaction(id) {
    state.transactions = state.transactions.filter(t => t.id !== id);
    saveToStorage();
    deleteTransactionFromSupabase(id);
    refreshAll();
    showToast('Transaction deleted', 'info');
  }

  // ===== Refresh All =====
  function refreshAll() {
    updateStats();
    renderRecentTransactions();
    renderAllTransactions();
    renderCategoryBreakdown();
    calculateSurvivalScore();
    analyzeImpulsiveSpending();
    checkNotifications();
  }

  // ===== Stats =====
  function updateStats() {
    const { income, expenses, balance } = getMonthData();
    $('#stat-income').textContent = formatCurrency(income);
    $('#stat-expenses').textContent = formatCurrency(expenses);
    $('#stat-balance').textContent = formatCurrency(balance);
    $('#stat-balance').className = 'stat-value ' + (balance < 0 ? 'danger' : balance < 100 ? 'warning' : 'safe');
  }

  // ===== Month Data Helper =====
  function getMonthData(date = new Date()) {
    const currentMonth = date.getMonth();
    const currentYear = date.getFullYear();

    const monthTx = state.transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balance = income - expenses;
    const fixedExpenses = monthTx.filter(t => t.type === 'expense' && t.expenseType === 'fixed').reduce((s, t) => s + t.amount, 0);
    const variableExpenses = monthTx.filter(t => t.type === 'expense' && t.expenseType === 'variable').reduce((s, t) => s + t.amount, 0);

    return { monthTx, income, expenses, balance, fixedExpenses, variableExpenses };
  }

  // ===== Render Transactions =====
  function renderRecentTransactions() {
    const container = $('#recent-transactions');
    const recent = state.transactions.slice(0, 5);
    if (recent.length === 0) {
      container.innerHTML = '<p class="empty-state">No transactions yet. Add one above!</p>';
      return;
    }
    container.innerHTML = recent.map(tx => renderTransactionItem(tx)).join('');
    attachTransactionEvents(container);
  }

  function renderAllTransactions() {
    const container = $('#all-transactions');
    const typeFilter = $('#filter-type').value;
    const catFilter = $('#filter-category').value;

    let filtered = [...state.transactions];
    if (typeFilter !== 'all') filtered = filtered.filter(t => t.type === typeFilter);
    if (catFilter !== 'all') filtered = filtered.filter(t => t.category === catFilter);

    if (filtered.length === 0) {
      container.innerHTML = '<p class="empty-state">No transactions match the filters.</p>';
      return;
    }

    container.innerHTML = filtered.map(tx => renderTransactionItem(tx, true)).join('');
    attachTransactionEvents(container);
  }

  function renderTransactionItem(tx, showDate = false) {
    const cat = getCategoryConfig(tx.category);
    const isImpulsive = tx.type === 'expense' && isImpulsiveTransaction(tx);
    const badges = [];
    if (tx.type === 'expense') {
      badges.push(`<span class="tx-badge ${tx.expenseType}">${tx.expenseType}</span>`);
      if (isImpulsive) badges.push('<span class="tx-badge impulsive">impulsive</span>');
    }

    return `
      <div class="transaction-item" data-id="${tx.id}">
        <div class="tx-icon ${tx.type}">${cat.emoji}</div>
        <div class="tx-details">
          <div class="tx-text">
            <div class="tx-desc">${escapeHtml(tx.description)}</div>
            <div class="tx-meta">
              <span>${cat.label}</span>
              ${showDate ? `<span>${formatDateTime(tx.createdAt || tx.date)}</span>` : ''}
            </div>
          </div>
          ${badges.length ? `<div class="tx-badges" style="display: flex; flex-direction: column; align-items: center; gap: 2px;">${badges.join('')}</div>` : ''}
        </div>
        <span class="tx-amount ${tx.type}">${tx.type === 'expense' ? '-' : '+'}${formatCurrency(tx.amount)}</span>
        <div class="tx-actions">
          <button class="btn-icon delete-tx" data-id="${tx.id}" title="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function attachTransactionEvents(container) {
    container.querySelectorAll('.delete-tx').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTransaction(btn.dataset.id);
      });
    });
  }

  // ===== Category Breakdown =====
  function renderCategoryBreakdown() {
    const container = $('#category-breakdown');
    const { monthTx } = getMonthData();
    const monthExpenses = monthTx.filter(t => t.type === 'expense');

    if (monthExpenses.length === 0) {
      container.innerHTML = '<p class="empty-state">Add expenses to see breakdown</p>';
      return;
    }

    const catTotals = {};
    monthExpenses.forEach(t => {
      catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
    });

    const total = Object.values(catTotals).reduce((s, v) => s + v, 0);
    const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

    const cx = 100, cy = 100, r = 80;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    const segments = [];
    const legendItems = [];

    sorted.forEach(([cat, amount]) => {
      const info = getCategoryConfig(cat);
      const pct = amount / total;
      const dashLen = pct * circumference;
      segments.push(
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${info.color}" stroke-width="36"
          stroke-dasharray="${dashLen} ${circumference - dashLen}"
          stroke-dashoffset="${-offset}"
          transform="rotate(-90 ${cx} ${cy})"/>`
      );
      legendItems.push(
        `<div class="pie-legend-item">
          <span class="pie-legend-dot" style="background:${info.color}"></span>
          <span class="pie-legend-label">${info.emoji} ${info.label}</span>
          <span class="pie-legend-value">${formatCurrency(amount)}</span>
          <span class="pie-legend-pct">${(pct * 100).toFixed(1)}%</span>
        </div>`
      );
      offset += dashLen;
    });

    container.innerHTML = `
      <div class="pie-chart-wrapper">
        <svg viewBox="0 0 200 200" class="pie-svg">${segments.join('')}
          <circle cx="${cx}" cy="${cy}" r="52" fill="var(--bg-card)"/>
        </svg>
      </div>
      <div class="pie-legend">${legendItems.join('')}</div>
    `;
  }

  // ============================================================
  // ===== SURVIVAL SCORE =====
  // ============================================================

  function calculateSurvivalScore() {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    const { monthTx, income, expenses, balance, fixedExpenses, variableExpenses } = getMonthData();

    const monthlyIncome = state.settings.monthlyIncome || income || 1;
    const monthlyFixed = state.settings.monthlyFixed || 0;

    const projectedVariable = state.settings.monthlyBudget > 0
      ? Math.min(variableExpenses, state.settings.monthlyBudget)
      : variableExpenses;
    const totalMonthlyOutflow = monthlyFixed + projectedVariable;
    const runwayMonths = balance / Math.max(totalMonthlyOutflow, 1);
    const runwayScore = calculateRunwayScore(runwayMonths);

    const ratioScore = calculateRatioScore(income, expenses);
    const stabilityScore = calculateStabilityScore();
    const bufferScore = calculateBufferScore(balance, monthlyFixed);

    let score = Math.round(
      runwayScore * 0.40 +
      ratioScore * 0.30 +
      stabilityScore * 0.20 +
      bufferScore * 0.10
    );

    score = Math.max(0, Math.min(100, score));

    updateSurvivalUI(score, runwayScore, ratioScore, stabilityScore, bufferScore, {
      daysRemaining, daysInMonth, dayOfMonth, balance, monthlyFixed, monthlyIncome,
      fixedExpenses, variableExpenses, income, expenses, monthTx
    });

    return score;
  }

  function calculateRunwayScore(runwayMonths) {
    if (runwayMonths >= 6) return 100;
    if (runwayMonths >= 3) return 70 + ((runwayMonths - 3) / 3) * 30;
    if (runwayMonths >= 1) return 30 + ((runwayMonths - 1) / 2) * 40;
    return Math.max(0, runwayMonths * 30);
  }

  function calculateRatioScore(income, expenses) {
    if (income <= 0) return expenses > 0 ? 0 : 50;
    const ratio = income / Math.max(expenses, 1);
    if (ratio >= 2.0) return 100;
    if (ratio >= 1.0) return 50 + ((ratio - 1.0) / 1.0) * 50;
    return Math.max(0, ratio * 50);
  }

  function calculateStabilityScore() {
    const expectedIncome = state.settings.monthlyIncome;
    if (expectedIncome <= 0) return 50;

    const now = new Date();
    const monthlyIncomes = [];

    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const { income } = getMonthData(d);
      if (income > 0) monthlyIncomes.push(income);
    }

    if (monthlyIncomes.length === 0) {
      const { income: currentIncome } = getMonthData(now);
      if (currentIncome <= 0) return 50;
      const ratio = currentIncome / expectedIncome;
      return Math.min(100, ratio * 100);
    }

    const ratios = monthlyIncomes.map(actual => actual / expectedIncome);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const variance = ratios.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / ratios.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;

    if (cv <= 0.2) return 100;
    if (cv >= 1.0) return 0;
    return 100 - ((cv - 0.2) / 0.8) * 100;
  }

  function calculateBufferScore(currentBalance, monthlyFixed) {
    const target = monthlyFixed * 3;
    if (target <= 0) return currentBalance > 0 ? 100 : 50;
    return Math.min(100, (currentBalance / target) * 100);
  }

  function updateSurvivalUI(score, runwayScore, ratioScore, stabilityScore, bufferScore, data) {
    const {
      daysRemaining, daysInMonth, dayOfMonth, balance,
      monthlyFixed, monthlyIncome, fixedExpenses, variableExpenses, income, expenses, monthTx
    } = data;

    $('#stat-survival').textContent = score + '%';
    $('#stat-survival').className = 'stat-value ' + (score <= 20 ? 'danger' : score <= 50 ? 'warning' : 'safe');

    const circle = $('#survival-circle');
    const circumference = 534;
    const offset = circumference - (score / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = getSurvivalColor(score);
    $('#survival-number').textContent = score + '%';

    let status, statusColor;
    if (score >= 70) { status = 'Financially Healthy'; statusColor = 'var(--green)'; }
    else if (score >= 50) { status = 'Moderate - Stay Cautious'; statusColor = 'var(--text-primary)'; }
    else if (score >= 30) { status = 'At Risk - Tighten Budget'; statusColor = 'var(--orange)'; }
    else { status = 'Critical - Immediate Action Needed'; statusColor = 'var(--red)'; }

    const statusEl = $('#survival-status');
    statusEl.textContent = status;
    statusEl.style.color = statusColor;

    $('#factor-days').textContent = daysRemaining + ' days';
    $('#factor-days-bar').style.width = ((daysRemaining / daysInMonth) * 100) + '%';
    $('#factor-days-bar').style.background = 'var(--accent)';

    const avgDailySpend = dayOfMonth > 0 ? expenses / dayOfMonth : 0;
    const dailyBudget = daysRemaining > 0 && balance > 0 ? balance / daysRemaining : 0;
    $('#factor-daily').textContent = formatCurrency(dailyBudget) + '/day';
    const dailyPct = avgDailySpend > 0 ? Math.min((dailyBudget / avgDailySpend) * 50, 100) : (dailyBudget > 0 ? 80 : 0);
    $('#factor-daily-bar').style.width = dailyPct + '%';
    $('#factor-daily-bar').style.background = dailyPct > 60 ? 'var(--green)' : dailyPct > 30 ? 'var(--orange)' : 'var(--red)';

    let fixedLabel, fixedPct, fixedColor;
    if (monthlyFixed > 0) {
      const remainingFixed = Math.max(0, monthlyFixed - fixedExpenses);
      const canCoverRemaining = balance >= remainingFixed;

      if (remainingFixed <= 0 || canCoverRemaining) {
        fixedLabel = 'Fully covered';
        fixedPct = 100;
        fixedColor = 'var(--green)';
      } else {
        const shortfall = remainingFixed - balance;
        fixedLabel = formatCurrency(Math.max(0, shortfall)) + ' needed';
        fixedPct = Math.min((fixedExpenses / monthlyFixed) * 100, 100);
        fixedColor = 'var(--orange)';
      }
    } else {
      fixedLabel = 'No fixed expenses set';
      fixedPct = 50;
      fixedColor = 'var(--accent)';
    }
    $('#factor-fixed').textContent = fixedLabel;
    $('#factor-fixed-bar').style.width = fixedPct + '%';
    $('#factor-fixed-bar').style.background = fixedColor;

    const impulsiveTotal = monthTx => monthTx
      .filter(t => t.type === 'expense' && IMPULSIVE_CATEGORIES.includes(t.category))
      .reduce((s, t) => s + t.amount, 0);
    const impulsiveAmount = impulsiveTotal(monthTx);
    const impulsiveRatio = monthlyIncome > 0 ? (impulsiveAmount / monthlyIncome) * 100 : 0;

    $('#factor-impulsive').textContent = impulsiveRatio.toFixed(1) + '% of income';
    const impPct = Math.min(impulsiveRatio * 3, 100);
    $('#factor-impulsive-bar').style.width = impPct + '%';
    $('#factor-impulsive-bar').style.background = impulsiveRatio <= state.settings.impulsiveThreshold
      ? 'var(--green)' : impulsiveRatio <= state.settings.impulsiveThreshold * 2 ? 'var(--orange)' : 'var(--red)';
  }

  // ===== Impulsive Detection =====
  function isImpulsiveTransaction(tx) {
    if (tx.type !== 'expense' || tx.expenseType !== 'variable') return false;
    if (!IMPULSIVE_CATEGORIES.includes(tx.category)) return false;

    const { income } = getMonthData();
    if (income <= 0) return false;

    const { monthTx } = getMonthData();
    const catTotal = monthTx
      .filter(t => t.type === 'expense' && t.category === tx.category)
      .reduce((s, t) => s + t.amount, 0);

    return (catTotal / income) * 100 > state.settings.impulsiveThreshold;
  }

  function analyzeImpulsiveSpending() {
    const container = $('#impulsive-analysis');
    const { monthTx, income } = getMonthData();

    if (income === 0) {
      container.innerHTML = '<p class="empty-state">Add income transactions to enable impulsive spending analysis</p>';
      return;
    }

    const analyses = [];

    IMPULSIVE_CATEGORIES.forEach(cat => {
      const catTotal = monthTx
        .filter(t => t.type === 'expense' && t.category === cat)
        .reduce((s, t) => s + t.amount, 0);
      const pct = (catTotal / income) * 100;
      const info = getCategoryConfig(cat);

      let level, levelClass, pctClass;
      if (pct <= state.settings.impulsiveThreshold * 0.5) {
        level = 'Safe'; levelClass = 'safe'; pctClass = 'ok';
      } else if (pct <= state.settings.impulsiveThreshold) {
        level = 'Moderate'; levelClass = 'warning'; pctClass = 'warn';
      } else {
        level = 'Impulsive!'; levelClass = ''; pctClass = 'danger';
      }

      analyses.push({ cat, info, total: catTotal, pct, level, levelClass, pctClass });
    });

    const otherCats = [...new Set(monthTx
      .filter(t => t.type === 'expense' && !IMPULSIVE_CATEGORIES.includes(t.category))
      .map(t => t.category))];

    otherCats.forEach(cat => {
      const catTotal = monthTx
        .filter(t => t.type === 'expense' && t.category === cat)
        .reduce((s, t) => s + t.amount, 0);
      const pct = (catTotal / income) * 100;
      if (pct > 30) {
        const info = getCategoryConfig(cat);
        analyses.push({ cat, info, total: catTotal, pct, level: 'High Spend', levelClass: 'warning', pctClass: 'warn' });
      }
    });

    if (analyses.length === 0) {
      container.innerHTML = '<p class="empty-state">No spending data to analyze</p>';
      return;
    }

    container.innerHTML = analyses.map(a => `
      <div class="impulsive-item ${a.levelClass}">
        <div class="impulsive-info">
          <div class="impulsive-cat">${a.info.emoji} ${a.info.label}</div>
          <div class="impulsive-detail">${formatCurrency(a.total)} spent - ${a.level}</div>
        </div>
        <span class="impulsive-pct ${a.pctClass}">${a.pct.toFixed(1)}%</span>
      </div>
    `).join('');
  }

  // ===== Notifications =====
  function setupNotifications() {
    const bell = $('#notif-bell');
    const panel = $('#notif-panel');

    bell.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    $('#clear-notifs').addEventListener('click', () => {
      state.notifications = [];
      saveToStorage();
      renderNotifications();
      updateNotifBadge();
    });

    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && !bell.contains(e.target)) {
        panel.style.display = 'none';
      }
    });
  }

  function checkNotifications() {
    const score = calculateSurvivalScore();
    const threshold = state.settings.survivalThreshold;
    const now = new Date();
    const { monthTx, income, expenses, balance } = getMonthData();

    state.notifications = state.notifications.filter(n => {
      const d = new Date(n.timestamp);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    if (score <= threshold) {
      addNotification({
        type: 'danger',
        text: `Your survival score is ${score}% - below your ${threshold}% threshold. Review your spending immediately!`,
        timestamp: new Date().toISOString(),
      });
    }

    if (income > 0) {
      IMPULSIVE_CATEGORIES.forEach(cat => {
        const catTotal = monthTx
          .filter(t => t.type === 'expense' && t.category === cat)
          .reduce((s, t) => s + t.amount, 0);
        const pct = (catTotal / income) * 100;

        if (pct > state.settings.impulsiveThreshold) {
          const info = getCategoryConfig(cat);
          addNotification({
            type: 'warning',
            text: `${info.emoji} ${info.label} spending is at ${pct.toFixed(1)}% of income - exceeding your ${state.settings.impulsiveThreshold}% threshold.`,
            timestamp: new Date().toISOString(),
          });
        }
      });
    }

    if (balance < 0) {
      addNotification({
        type: 'danger',
        text: `Your balance is negative (${formatCurrency(balance)}). You're spending more than you earn this month!`,
        timestamp: new Date().toISOString(),
      });
    }

    const monthlyFixed = state.settings.monthlyFixed || 0;
    const fixedPaid = monthTx.filter(t => t.type === 'expense' && t.expenseType === 'fixed').reduce((s, t) => s + t.amount, 0);
    if (monthlyFixed > 0 && fixedPaid < monthlyFixed && balance < (monthlyFixed - fixedPaid)) {
      addNotification({
        type: 'warning',
        text: `You haven't covered all fixed expenses yet. ${formatCurrency(monthlyFixed - fixedPaid)} still needed.`,
        timestamp: new Date().toISOString(),
      });
    }

    saveToStorage();
    renderNotifications();
    updateNotifBadge();
  }

  function addNotification(notif) {
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const exists = state.notifications.some(n =>
      n.text === notif.text && n.timestamp > oneDayAgo
    );
    if (!exists) {
      const newNotif = { ...notif, id: crypto.randomUUID ? crypto.randomUUID() : 'n_' + Date.now() };
      state.notifications.unshift(newNotif);
      syncNotificationToSupabase(newNotif).catch(() => {});
    }
  }

  function renderNotifications() {
    const list = $('#notif-list');
    if (state.notifications.length === 0) {
      list.innerHTML = '<p class="empty-state">No notifications</p>';
      return;
    }

    list.innerHTML = state.notifications.map(n => `
      <div class="notif-item">
        <div class="notif-dot ${n.type}"></div>
        <div>
          <div class="notif-text">${n.text}</div>
          <div class="notif-time">${timeAgo(n.timestamp)}</div>
        </div>
      </div>
    `).join('');
  }

  function updateNotifBadge() {
    const badge = $('#notif-badge');
    const count = state.notifications.length;
    if (count > 0) {
      badge.style.display = 'flex';
      badge.textContent = count > 9 ? '9+' : count;
    } else {
      badge.style.display = 'none';
    }
  }

  // ===== Settings =====
  function setupSettings() {
    $('#save-settings').addEventListener('click', () => {
      state.settings.survivalThreshold = parseInt($('#threshold-setting').value) || 20;
      state.settings.impulsiveThreshold = parseInt($('#impulsive-threshold').value) || 10;
      saveToStorage();
      syncSettingsToSupabase();
      refreshAll();
      showToast('Settings saved!', 'success');
    });

    $('#save-budget').addEventListener('click', () => {
      state.settings.monthlyIncome = parseFloat($('#monthly-income').value) || 0;
      state.settings.monthlyFixed = parseFloat($('#monthly-fixed').value) || 0;
      state.settings.monthlyBudget = parseFloat($('#monthly-budget').value) || 0;
      saveToStorage();
      syncSettingsToSupabase();
      refreshAll();
      showToast('Budget saved!', 'success');
    });
  }

  function applySettingsToUI() {
    $('#threshold-setting').value = state.settings.survivalThreshold;
    $('#impulsive-threshold').value = state.settings.impulsiveThreshold;
    $('#monthly-income').value = state.settings.monthlyIncome || '';
    $('#monthly-fixed').value = state.settings.monthlyFixed || '';
    $('#monthly-budget').value = state.settings.monthlyBudget || '';
  }

  // ===== Modal =====
  function setupModal() {
    const overlay = $('#modal-overlay');
    const closeBtn = $('#modal-close');

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }

  function closeModal() {
    $('#modal-overlay').style.display = 'none';
  }

  // ===== Filters =====
  function setupFilters() {
    $('#filter-type').addEventListener('change', renderAllTransactions);
    $('#filter-category').addEventListener('change', renderAllTransactions);
  }

  // ===== Theme Toggle =====
  function setupThemeToggle() {
    const toggle = $('#theme-toggle');
    const darkIcon = $('#theme-icon-dark');
    const lightIcon = $('#theme-icon-light');

    if (state.settings.theme === 'light') {
      document.body.classList.add('light-mode');
      darkIcon.style.display = 'none';
      lightIcon.style.display = 'block';
    }

    toggle.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-mode');
      darkIcon.style.display = isLight ? 'none' : 'block';
      lightIcon.style.display = isLight ? 'block' : 'none';
      state.settings.theme = isLight ? 'light' : 'dark';
      saveToStorage();
      syncSettingsToSupabase();
    });
  }

  // ===== Category Filtering =====
  function setupCategoryFiltering() {
    updateQaCategories();
    updateTxCategories();
  }

  function parseExpenseSubtype(cat) {
    let subtypes = [];
    if (cat.expense_subtype) {
      try {
        subtypes = JSON.parse(cat.expense_subtype);
      } catch (e) {
        if (typeof cat.expense_subtype === 'string') {
          subtypes = cat.expense_subtype.split(',').map(s => s.trim());
        } else if (Array.isArray(cat.expense_subtype)) {
          subtypes = cat.expense_subtype;
        } else {
          subtypes = [];
        }
      }
    }
    return subtypes;
  }

  function updateQaCategories() {
    const type = $('#qa-type').value;
    const expenseType = $('#qa-expense-type').value;
    const select = $('#qa-category');
    select.innerHTML = '';

    if (state.supabaseCategories.length > 0) {
      state.supabaseCategories.forEach(cat => {
        const catType = cat.type;
        const subtypes = parseExpenseSubtype(cat);

        if (type === 'income' && (catType === 'income' || catType === 'both')) {
          select.add(new Option(cat.emoji + ' ' + cat.label, cat.key));
        } else if (type === 'expense' && (catType === 'expense' || catType === 'both')) {
          if (subtypes.includes(expenseType)) {
            select.add(new Option(cat.emoji + ' ' + cat.label, cat.key));
          }
        }
      });
    } else {
      Object.entries(CATEGORIES).forEach(([key, cat]) => {
        if (type === 'income' && (cat.type === 'income' || cat.type === 'both')) {
          select.add(new Option(cat.emoji + ' ' + cat.label, key));
        } else if (type === 'expense' && (cat.type === 'expense' || cat.type === 'both')) {
          if (cat.expenseSubtype && cat.expenseSubtype.includes(expenseType)) {
            select.add(new Option(cat.emoji + ' ' + cat.label, key));
          }
        }
      });
    }
  }

  function updateTxCategories() {
    const type = $('#tx-type').value;
    const expenseType = $('#tx-expense-type').value;
    const select = $('#tx-category');
    select.innerHTML = '';

    if (state.supabaseCategories.length > 0) {
      state.supabaseCategories.forEach(cat => {
        const catType = cat.type;
        const subtypes = parseExpenseSubtype(cat);

        if (type === 'income' && (catType === 'income' || catType === 'both')) {
          select.add(new Option(cat.emoji + ' ' + cat.label, cat.key));
        } else if (type === 'expense' && (catType === 'expense' || catType === 'both')) {
          if (subtypes.includes(expenseType)) {
            select.add(new Option(cat.emoji + ' ' + cat.label, cat.key));
          }
        }
      });
    } else {
      Object.entries(CATEGORIES).forEach(([key, cat]) => {
        if (type === 'income' && (cat.type === 'income' || cat.type === 'both')) {
          select.add(new Option(cat.emoji + ' ' + cat.label, key));
        } else if (type === 'expense' && (cat.type === 'expense' || cat.type === 'both')) {
          if (cat.expenseSubtype && cat.expenseSubtype.includes(expenseType)) {
            select.add(new Option(cat.emoji + ' ' + cat.label, key));
          }
        }
      });
    }
  }

  // ===== Export / Clear =====
  function setupExportClear() {
    $('#export-data').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({
        transactions: state.transactions,
        settings: state.settings,
        exportedAt: new Date().toISOString(),
      }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `survivalfi_export_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Data exported!', 'success');
    });

    $('#import-data').addEventListener('click', () => {
      $('#import-file').click();
    });

    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.transactions && Array.isArray(data.transactions)) {
          state.transactions = data.transactions;
        }
        if (data.settings) {
          state.settings = { ...state.settings, ...data.settings };
        }
        state.notifications = [];
        saveToStorage();

        if (state.user && !state.isLocalMode) {
          await uploadLocalDataToSupabase();
        }

        applySettingsToUI();
        refreshAll();
        showToast('Data imported successfully!', 'success');
      } catch (err) {
        showToast('Import failed: Invalid JSON file', 'error');
      }
      e.target.value = '';
    });

    $('#clear-data').addEventListener('click', () => {
      if (confirm('This will delete all your transactions and reset settings. Continue?')) {
        state.transactions = [];
        state.notifications = [];
        state.settings = {
          survivalThreshold: 20,
          impulsiveThreshold: 10,
          monthlyIncome: 0,
          monthlyFixed: 0,
          monthlyBudget: 0,
          theme: state.settings.theme,
        };
        saveToStorage();

        if (state.user && !state.isLocalMode) {
          clearSupabaseData().catch(() => {});
        }

        applySettingsToUI();
        refreshAll();
        showToast('All data cleared', 'info');
      }
    });
  }

  async function clearSupabaseData() {
    if (!state.user?.id || state.isLocalMode) return;
    try {
      await supabaseClient.from('transactions').delete().eq('user_id', state.user.id);
      await supabaseClient.from('notifications').delete().eq('user_id', state.user.id);
      await supabaseClient.from('settings').delete().eq('user_id', state.user.id);
    } catch (err) {
      console.warn('Failed to clear Supabase data:', err);
    }
  }

  // ===== Utilities =====
  function getSurvivalColor(score) {
    const r = score < 50 ? 239 : Math.round(239 - (239 - 34) * ((score - 50) / 50));
    const g = score < 50 ? Math.round(68 + (197 - 68) * (score / 50)) : 197;
    const b = score < 50 ? 68 : Math.round(68 + (94 - 68) * ((score - 50) / 50));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function formatCurrency(amount) {
    const sign = amount < 0 ? '-' : '';
    return sign + '$' + Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatDateTime(dateStr) {
    const d = new Date(dateStr);
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return date + ' ' + time;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function timeAgo(dateStr) {
    const now = new Date();
    const d = new Date(dateStr);
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  // ===== Boot =====
  (async function() {
    try {
      await init();
    } catch (err) {
      console.error('Init failed:', err);
      debugLog('INIT FAILED: ' + err.message);
      // Show error on auth screen
      const authScreen = document.getElementById('auth-screen');
      if (authScreen) {
        authScreen.innerHTML = '<div style="padding:2rem;text-align:center;"><h2>Application Error</h2><p>' + escapeHtml(err.message) + '</p><p>Check the console for details.</p><button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;">Reload</button></div>';
      }
    }
  })();
})();