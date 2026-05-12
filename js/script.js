// ===== SurvivalFi - Main Application (Supabase Edition v7) =====
// FIXED: Uses transaction_id (not id) for transactions table
// FIXED: Uses notification_id for notifications table
// FIXED: Schema discovery removed (information_schema 404s on this Supabase instance)

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
    console.error('Supabase library not loaded!');
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

  // ===== OAuth Processing Guard =====
  let isProcessingOAuth = false;

  // ===== Constants =====
  const SUPABASE_URL = 'https://fgaukbpinknkiluvgzdq.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_6pu7euAl4FBbVgj1_O2BkA_Kynq6Bot';
  const PKCE_STORAGE_KEY = 'survivalfi_pkce_verifier';
  const SESSION_STORAGE_KEY = 'survivalfi_session';

  // ===== DATABASE SCHEMA (hardcoded based on actual table structure) =====
  // transactions table PK: transaction_id (NOT id)
  // notifications table PK: notification_id (NOT id)
  // notifications type constraint allows: 'danger', 'warning', 'info', 'success'
  const DB_SCHEMA = {
    transactions: {
      idColumn: 'transaction_id',
      columns: ['transaction_id', 'user_id', 'type', 'amount', 'category_key', 'expense_type', 'description', 'date', 'created_at']
    },
    notifications: {
      idColumn: 'notification_id',
      validTypes: ['danger', 'warning', 'info', 'success', 'critical'],
      columns: ['notification_id', 'user_id', 'type', 'text', 'timestamp']
    },
    settings: {
      idColumn: 'user_id',
      columns: ['user_id', 'monthly_income', 'monthly_fixed', 'monthly_budget', 'survival_threshold', 'impulsive_threshold', 'theme']
    }
  };

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

  // ===== PKCE Helpers =====
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
    }
  }

  function getPkceVerifier() {
    try {
      const v = localStorage.getItem(PKCE_STORAGE_KEY);
      if (v) debugLog('PKCE verifier retrieved (' + v.substring(0, 8) + '...)');
      else debugLog('PKCE verifier NOT found');
      return v;
    } catch (e) {
      debugLog('Failed to get PKCE verifier: ' + e.message);
      return null;
    }
  }

  function clearPkceVerifier() {
    try { localStorage.removeItem(PKCE_STORAGE_KEY); } catch (e) {}
  }

  // ===== Manual Token Exchange =====
  async function manualExchangeCodeForSession(authCode, codeVerifier) {
    debugLog('Manual token exchange starting...');
    try {
      // First try: Use Supabase's built-in exchange (handles their PKCE)
      debugLog('Trying built-in exchange first...');
      const { data: builtInData, error: builtInError } = await supabaseClient.auth.exchangeCodeForSession(authCode);
      if (!builtInError && builtInData?.session) {
        debugLog('Built-in exchange succeeded');
        return { session: builtInData.session, user: builtInData.session?.user };
      }
      if (builtInError) debugLog('Built-in exchange failed: ' + builtInError.message);

      // Second try: Manual exchange with our stored verifier
      debugLog('Trying manual exchange...');
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ auth_code: authCode, code_verifier: codeVerifier }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
      }

      const tokenData = await response.json();
      if (!tokenData.access_token) throw new Error('No access_token in response');

      const { data, error } = await supabaseClient.auth.setSession({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
      });

      if (error) throw error;
      return { session: data.session, user: data.session?.user };
    } catch (err) {
      debugLog('Manual exchange error: ' + err.message);
      throw err;
    }
  }

  // ===== Session Persistence =====
  function storeSession(session) {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: { id: session.user.id, email: session.user.email },
      }));
      debugLog('Session stored');
    } catch (e) {
      debugLog('Failed to store session: ' + e.message);
    }
  }

  async function restoreSession() {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!saved) return false;

      const sessionData = JSON.parse(saved);
      if (!sessionData.access_token || !sessionData.refresh_token) return false;

      debugLog('Restoring session...');
      const { data, error } = await supabaseClient.auth.setSession({
        access_token: sessionData.access_token,
        refresh_token: sessionData.refresh_token,
      });

      if (error) {
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
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    return false;
  }

  // ===== Debug Helper =====
  function debugLog(msg) {
    console.log('[SurvivalFi]', msg);
    const debugDiv = document.getElementById('debug-output');
    if (debugDiv) {
      debugDiv.innerHTML += '<div style="font-size:12px;color:#888;">' + msg + '</div>';
    }
  }

  // ===== Map notification type to valid DB value =====
  function mapNotificationType(type) {
    const validTypes = DB_SCHEMA.notifications.validTypes;
    if (validTypes.includes(type)) return type;
    // Map common alternatives
    const map = { 'danger': 'critical', 'warning': 'warning', 'info': 'info', 'success': 'success' };
    if (validTypes.includes(map[type])) return map[type];
    return validTypes[0] || 'info';
  }

  // ===== Initialization =====
  async function init() {
    debugLog('Initializing...');

    await loadFromStorage();
    debugLog('Storage loaded. User: ' + (state.user?.email || 'none'));

    // STEP 1: Setup UI first
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
    debugLog('UI setup complete');

    // STEP 2: Handle OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const hasCode = !!authCode;
    debugLog('Has auth code: ' + hasCode + (hasCode ? ' (' + authCode.substring(0,8) + '...)' : ''));

    if (authCode && !state.user) {
      isProcessingOAuth = true;
      debugLog('PKCE: Processing authorization code...');
      showToast('Completing sign-in...', 'info');

      const codeVerifier = getPkceVerifier();
      debugLog('PKCE verifier found: ' + !!codeVerifier);

      if (codeVerifier) {
        try {
          debugLog('PKCE: Manual token exchange...');
          const result = await manualExchangeCodeForSession(authCode, codeVerifier);
          if (result && result.session) {
            state.user = { id: result.user.id, email: result.user.email };
            state.isLocalMode = false;
            storeSession(result.session);
            clearPkceVerifier();
            window.history.replaceState(null, '', window.location.pathname);
            debugLog('PKCE: Session established!');

            // Small delay to let onAuthStateChange settle if it's going to fire
            await new Promise(r => setTimeout(r, 100));

            debugLog('Uploading local data...');
            await uploadLocalDataToSupabase().catch(e => debugLog('Upload error: ' + e.message));
            debugLog('Syncing from Supabase...');
            await syncFromSupabase().catch(e => debugLog('Sync error: ' + e.message));
            debugLog('Data sync complete');
          } else {
            debugLog('PKCE: Manual exchange returned no session');
            window.history.replaceState(null, '', window.location.pathname);
          }
        } catch (err) {
          debugLog('PKCE manual exchange failed: ' + err.message);
          console.error(err);
          window.history.replaceState(null, '', window.location.pathname);
          showToast('Sign-in failed: ' + err.message, 'error');
        }
      } else {
        debugLog('PKCE: No verifier, trying built-in exchange...');
        try {
          const { data, error } = await supabaseClient.auth.exchangeCodeForSession(authCode);
          if (error) throw error;
          if (data && data.session) {
            state.user = { id: data.session.user.id, email: data.session.user.email };
            state.isLocalMode = false;
            storeSession(data.session);
            window.history.replaceState(null, '', window.location.pathname);
            debugLog('PKCE: Built-in exchange success');

            // Small delay to let onAuthStateChange settle if it's going to fire
            await new Promise(r => setTimeout(r, 100));

            debugLog('Uploading local data...');
            await uploadLocalDataToSupabase().catch(e => debugLog('Upload error: ' + e.message));
            debugLog('Syncing from Supabase...');
            await syncFromSupabase().catch(e => debugLog('Sync error: ' + e.message));
            debugLog('Data sync complete');
          } else {
            debugLog('PKCE: Built-in exchange returned no session');
            window.history.replaceState(null, '', window.location.pathname);
          }
        } catch (err2) {
          debugLog('PKCE built-in exchange failed: ' + err2.message);
          console.error(err2);
          window.history.replaceState(null, '', window.location.pathname);
          showToast('Sign-in failed: ' + err2.message, 'error');
        }
      }
      isProcessingOAuth = false;
    }

    // STEP 3: Restore from localStorage
    if (!state.user) {
      debugLog('Restoring session from localStorage...');
      const restored = await restoreSession();
      debugLog('Session restored: ' + restored);
      if (restored) await syncFromSupabase();
    }

    // STEP 4: Normal session check
    if (!state.user) {
      debugLog('Checking existing Supabase session...');
      await checkAuthSession();
      debugLog('After checkAuthSession, user: ' + (state.user?.email || 'none'));
    }

    // STEP 5: Hash token fallback
    if (!state.user && !state.isLocalMode && window.location.hash.includes('access_token')) {
      debugLog('Trying hash token fallback...');
      await recoverSessionFromHash();
    }

    debugLog('Loading categories...');
    await loadCategoriesFromSupabase();

    // STEP 6: Show correct screen
    if (state.user || state.isLocalMode) {
      debugLog('Showing app for user: ' + (state.user?.email || 'Local User'));
      showApp();
    } else {
      debugLog('No user, showing auth screen');
    }

    isProcessingOAuth = false; // Ensure flag is cleared
    debugLog('Init complete.');
  }

  // ===== Auth Session Check =====
  async function checkAuthSession() {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (session?.user) {
        state.user = { id: session.user.id, email: session.user.email };
        state.isLocalMode = false;
        await syncFromSupabase();
      }
    } catch (err) {
      console.warn('Session check failed:', err);
    }
  }

  // ===== Recover session from URL hash =====
  async function recoverSessionFromHash() {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return false;

    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken) return false;

    console.log('Recovering session from URL hash tokens');

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
      const { data, error } = await supabaseClient.from('categories').select('*');
      if (error) throw error;
      if (data && data.length > 0) state.supabaseCategories = data;
    } catch (err) {
      console.warn('Failed to load categories from Supabase:', err);
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
      return { emoji: supa.emoji, label: supa.label, color: supa.color, type: supa.type, expenseSubtype: subtypes };
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

  // ===== Supabase Sync =====
  async function syncFromSupabase() {
    if (!state.user?.id) return;
    debugLog('Starting sync from Supabase...');

    // Timeout wrapper to prevent hanging on slow queries
    const withTimeout = (promise, ms, name) => {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${name} timeout after ${ms}ms`)), ms)
        )
      ]);
    };

    try {
      const [txRes, notifRes, settingsRes] = await Promise.all([
        withTimeout(supabaseClient.from('transactions').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }), 15000, 'transactions'),
        withTimeout(supabaseClient.from('notifications').select('*').eq('user_id', state.user.id).order('timestamp', { ascending: false }), 15000, 'notifications'),
        withTimeout(supabaseClient.from('settings').select('*').eq('user_id', state.user.id).maybeSingle(), 15000, 'settings'),
      ]);

      if (txRes.data) {
        const supaTx = txRes.data.map(t => ({
          id: t.transaction_id || t.id || t.uuid,
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
          id: n.notification_id,
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
        debugLog('Settings loaded from Supabase');
      }

      saveToStorage();
    } catch (err) {
      debugLog('Sync from Supabase failed: ' + err.message);
      console.warn('Failed to sync from Supabase:', err);
      // Don't block the app - local data is still available
      showToast('Sync delayed - working offline', 'info');
    }
    debugLog('Sync from Supabase complete');
  }

  // ===== Upload local data =====
  async function uploadLocalDataToSupabase() {
    if (!state.user?.id) {
      debugLog('Skip upload: no user id');
      return;
    }
    const unsynced = state.transactions.filter(tx => !tx._synced);
    debugLog('Uploading ' + unsynced.length + ' of ' + state.transactions.length + ' transactions...');
    if (unsynced.length === 0) {
      debugLog('All transactions already synced');
      await syncSettingsToSupabase().catch(e => debugLog('Settings sync error: ' + e.message));
      return;
    }
    try {
      for (const tx of unsynced) {
        await syncTransactionToSupabase(tx);
      }
      await syncSettingsToSupabase();
      debugLog('Upload complete');
    } catch (err) {
      debugLog('Upload failed: ' + err.message);
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

    if (!form || !toggle || !title || !submitBtn) {
      debugLog('Auth elements not ready, deferring...');
      setTimeout(setupAuth, 500);
      return;
    }

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
          showToast('Account created! Check your email.', 'success');
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
        showToast('Password reset email sent!', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to send reset email', 'error');
      }
    });

    // Google OAuth
    $('#oauth-google').addEventListener('click', async () => {
      try {
        debugLog('Starting Google OAuth...');
        // Generate and store our own PKCE verifier as backup
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        storePkceVerifier(codeVerifier);

        // Use Supabase's built-in OAuth with PKCE - let it handle the flow
        // The redirectTo must match exactly what's configured in Supabase dashboard
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin,
            skipBrowserRedirect: false, // Let Supabase handle the redirect
          },
        });

        if (error) throw error;
        // With skipBrowserRedirect: false, Supabase handles the redirect automatically
        // If for some reason it doesn't, fallback to manual
        if (data?.url) {
          debugLog('OAuth URL obtained, redirecting...');
          // The URL from Supabase already includes their code_challenge
          // We append ours as backup (some Supabase versions support this)
          const url = new URL(data.url);
          // Only add our challenge if not already present
          if (!url.searchParams.has('code_challenge')) {
            url.searchParams.set('code_challenge', codeChallenge);
            url.searchParams.set('code_challenge_method', 'S256');
          }
          window.location.href = url.toString();
        } else {
          showToast('Failed to get OAuth URL', 'error');
        }
      } catch (err) {
        debugLog('Google sign-in error: ' + err.message);
        showToast(err.message || 'Google sign-in failed', 'error');
      }
    });

    // GitHub OAuth
    $('#oauth-github').addEventListener('click', async () => {
      try {
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: 'github',
          options: { redirectTo: 'https://survivalfi.moriowada.com' },
        });
        if (error) throw error;
        if (data?.url) window.location.href = data.url;
      } catch (err) {
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

    // Auth State Change Listener
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      debugLog('Auth state changed: ' + event + ' ' + (session?.user?.email || ''));

      if (event === 'SIGNED_IN' && session?.user) {
        // Skip if we just processed OAuth in init() to avoid double sync
        if (isProcessingOAuth) {
          debugLog('Skipping SIGNED_IN sync - OAuth already processed in init()');
          isProcessingOAuth = false;
          state.user = { id: session.user.id, email: session.user.email };
          state.isLocalMode = false;
          storeSession(session);
          saveToStorage();
          if (!$('#app-screen').classList.contains('active')) showApp();
          return;
        }
        state.user = { id: session.user.id, email: session.user.email };
        state.isLocalMode = false;
        storeSession(session);
        saveToStorage();
        await uploadLocalDataToSupabase().catch(e => debugLog('Upload error: ' + e.message));
        await syncFromSupabase().catch(e => debugLog('Sync error: ' + e.message));
        if (!$('#app-screen').classList.contains('active')) showApp();
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

  // ===== FIXED: Supabase Database Operations =====
  // Uses transaction_id (NOT id) for transactions table
  async function syncTransactionToSupabase(tx) {
    if (!state.user?.id || state.isLocalMode) {
      debugLog('Skip sync: no user id or local mode');
      return;
    }
    if (tx._synced) {
      debugLog('Transaction already synced: ' + tx.id);
      return;
    }
    debugLog('Syncing transaction: ' + tx.id);
    try {
      const { data, error } = await supabaseClient.from('transactions').upsert({
        transaction_id: tx.id,
        user_id: state.user.id,
        type: tx.type,
        amount: tx.amount,
        category_key: tx.category,
        expense_type: tx.expenseType,
        description: tx.description,
        date: tx.date,
        created_at: tx.createdAt,
      });

      if (error) {
        debugLog('Sync error: ' + error.message);
        throw error;
      }
      tx._synced = true;
      saveToStorage();
      debugLog('Transaction synced successfully');
    } catch (err) {
      debugLog('Sync failed: ' + err.message);
      console.warn('Sync transaction failed:', err);
    }
  }

  // FIXED: Uses transaction_id for delete filter
  async function deleteTransactionFromSupabase(txId) {
    if (!state.user?.id || state.isLocalMode) return;
    try {
      const { error } = await supabaseClient.from('transactions').delete().eq('transaction_id', txId);
      if (error) throw error;
    } catch (err) {
      console.warn('Delete sync failed:', err);
    }
  }

  // FIXED: Uses notification_id and maps type to valid constraint values
  async function syncNotificationToSupabase(notif) {
    if (!state.user?.id || state.isLocalMode) return;
    try {
      const dbType = mapNotificationType(notif.type);

      const { error } = await supabaseClient.from('notifications').upsert({
        notification_id: notif.id,
        user_id: state.user.id,
        type: dbType,
        text: notif.text,
        timestamp: notif.timestamp,
      }, { onConflict: 'notification_id' }).select();

      if (error) {
        debugLog('Notification sync error: ' + error.message);
        // If constraint still fails, try with 'info' as ultimate fallback
        if (error.message.includes('check constraint')) {
          const { error: fallbackError } = await supabaseClient.from('notifications').upsert({
            notification_id: notif.id,
            user_id: state.user.id,
            type: 'info',
            text: notif.text,
            timestamp: notif.timestamp,
          }, { onConflict: 'notification_id' }).select();
          if (fallbackError) {
            console.warn('Fallback also failed:', fallbackError.message);
          } else {
            debugLog('Notification synced with fallback type');
          }
        }
      } else {
        debugLog('Notification synced: ' + notif.id);
      }
    } catch (err) {
      console.warn('Sync notification failed:', err);
    }
  }

  async function syncSettingsToSupabase() {
    if (!state.user?.id || state.isLocalMode) {
      debugLog('Skip settings sync');
      return;
    }
    debugLog('Syncing settings...');
    try {
      const { data, error } = await supabaseClient.from('settings').upsert({
        user_id: state.user.id,
        monthly_income: state.settings.monthlyIncome,
        monthly_fixed: state.settings.monthlyFixed,
        monthly_budget: state.settings.monthlyBudget,
        survival_threshold: state.settings.survivalThreshold,
        impulsive_threshold: state.settings.impulsiveThreshold,
        theme: state.settings.theme,
      }, { onConflict: 'user_id' }).select();

      if (error) {
        debugLog('Settings sync error: ' + error.message);
        throw error;
      }
      debugLog('Settings synced');
    } catch (err) {
      debugLog('Settings sync failed: ' + err.message);
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

    const logoutBtn = $('#logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        if (state.user) await supabaseClient.auth.signOut().catch(() => {});
        state.user = null;
        state.isLocalMode = false;
        localStorage.removeItem(SESSION_STORAGE_KEY);
        saveToStorage();
        $('#app-screen').classList.remove('active');
        $('#auth-screen').classList.add('active');
        showToast('Signed out', 'info');
      });
    }
  }

  // ===== Mobile Menu =====
  function setupMobileMenu() {
    const hamburger = $('#hamburger-btn');
    const sidebar = $('.sidebar');
    const overlay = $('#sidebar-overlay');

    if (!hamburger || !sidebar || !overlay) {
      debugLog('Mobile menu elements not ready, deferring...');
      setTimeout(setupMobileMenu, 500);
      return;
    }

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

    if (!form || !typeSelect || !expenseTypeSelect) {
      debugLog('Quick add elements not ready, deferring...');
      setTimeout(setupQuickAdd, 500);
      return;
    }

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
    if (!form) {
      debugLog('Transaction form not ready, deferring...');
      setTimeout(setupTransactionForm, 500);
      return;
    }

    $$('#transaction-form .toggle-group').forEach(group => {
      const toggles = group.querySelectorAll('.toggle');
      toggles.forEach(t => {
        t.addEventListener('click', () => {
          toggles.forEach(b => b.classList.remove('active'));
          t.classList.add('active');
          if (t.dataset.value) {
            $('#tx-type').value = t.dataset.value;
            $('#expense-type-group').style.display = t.dataset.value === 'income' ? 'none' : '';
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
    tx._synced = false; // Mark as needing sync
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
    monthExpenses.forEach(t => { catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; });

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
      segments.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${info.color}" stroke-width="36" stroke-dasharray="${dashLen} ${circumference - dashLen}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`);
      legendItems.push(`<div class="pie-legend-item"><span class="pie-legend-dot" style="background:${info.color}"></span><span class="pie-legend-label">${info.emoji} ${info.label}</span><span class="pie-legend-value">${formatCurrency(amount)}</span><span class="pie-legend-pct">${(pct * 100).toFixed(1)}%</span></div>`);
      offset += dashLen;
    });

    container.innerHTML = `<div class="pie-chart-wrapper"><svg viewBox="0 0 200 200" class="pie-svg">${segments.join('')}<circle cx="${cx}" cy="${cy}" r="52" fill="var(--bg-card)"/></svg></div><div class="pie-legend">${legendItems.join('')}</div>`;
  }

  // ===== SURVIVAL SCORE =====
  function calculateSurvivalScore() {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = daysInMonth - dayOfMonth;
    const { monthTx, income, expenses, balance, fixedExpenses, variableExpenses } = getMonthData();
    const monthlyIncome = state.settings.monthlyIncome || income || 1;
    const monthlyFixed = state.settings.monthlyFixed || 0;
    const projectedVariable = state.settings.monthlyBudget > 0 ? Math.min(variableExpenses, state.settings.monthlyBudget) : variableExpenses;
    const totalMonthlyOutflow = monthlyFixed + projectedVariable;
    const runwayMonths = balance / Math.max(totalMonthlyOutflow, 1);
    const runwayScore = calculateRunwayScore(runwayMonths);
    const ratioScore = calculateRatioScore(income, expenses);
    const stabilityScore = calculateStabilityScore();
    const bufferScore = calculateBufferScore(balance, monthlyFixed);

    let score = Math.round(runwayScore * 0.40 + ratioScore * 0.30 + stabilityScore * 0.20 + bufferScore * 0.10);
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
      return Math.min(100, (currentIncome / expectedIncome) * 100);
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
    const { daysRemaining, daysInMonth, dayOfMonth, balance, monthlyFixed, monthlyIncome, fixedExpenses, variableExpenses, income, expenses, monthTx } = data;

    $('#stat-survival').textContent = score + '%';
    $('#stat-survival').className = 'stat-value ' + (score <= 20 ? 'danger' : score <= 50 ? 'warning' : 'safe');

    const circle = $('#survival-circle');
    const circumference = 534;
    circle.style.strokeDashoffset = circumference - (score / 100) * circumference;
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
        fixedLabel = 'Fully covered'; fixedPct = 100; fixedColor = 'var(--green)';
      } else {
        fixedLabel = formatCurrency(Math.max(0, remainingFixed - balance)) + ' needed';
        fixedPct = Math.min((fixedExpenses / monthlyFixed) * 100, 100);
        fixedColor = 'var(--orange)';
      }
    } else {
      fixedLabel = 'No fixed expenses set'; fixedPct = 50; fixedColor = 'var(--accent)';
    }
    $('#factor-fixed').textContent = fixedLabel;
    $('#factor-fixed-bar').style.width = fixedPct + '%';
    $('#factor-fixed-bar').style.background = fixedColor;

    const impulsiveAmount = monthTx.filter(t => t.type === 'expense' && IMPULSIVE_CATEGORIES.includes(t.category)).reduce((s, t) => s + t.amount, 0);
    const impulsiveRatio = monthlyIncome > 0 ? (impulsiveAmount / monthlyIncome) * 100 : 0;
    $('#factor-impulsive').textContent = impulsiveRatio.toFixed(1) + '% of income';
    const impPct = Math.min(impulsiveRatio * 3, 100);
    $('#factor-impulsive-bar').style.width = impPct + '%';
    $('#factor-impulsive-bar').style.background = impulsiveRatio <= state.settings.impulsiveThreshold ? 'var(--green)' : impulsiveRatio <= state.settings.impulsiveThreshold * 2 ? 'var(--orange)' : 'var(--red)';
  }

  // ===== Impulsive Detection =====
  function isImpulsiveTransaction(tx) {
    if (tx.type !== 'expense' || tx.expenseType !== 'variable') return false;
    if (!IMPULSIVE_CATEGORIES.includes(tx.category)) return false;
    const { income } = getMonthData();
    if (income <= 0) return false;
    const { monthTx } = getMonthData();
    const catTotal = monthTx.filter(t => t.type === 'expense' && t.category === tx.category).reduce((s, t) => s + t.amount, 0);
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
      const catTotal = monthTx.filter(t => t.type === 'expense' && t.category === cat).reduce((s, t) => s + t.amount, 0);
      const pct = (catTotal / income) * 100;
      const info = getCategoryConfig(cat);
      let level, levelClass, pctClass;
      if (pct <= state.settings.impulsiveThreshold * 0.5) { level = 'Safe'; levelClass = 'safe'; pctClass = 'ok'; }
      else if (pct <= state.settings.impulsiveThreshold) { level = 'Moderate'; levelClass = 'warning'; pctClass = 'warn'; }
      else { level = 'Impulsive!'; levelClass = ''; pctClass = 'danger'; }
      analyses.push({ cat, info, total: catTotal, pct, level, levelClass, pctClass });
    });

    const otherCats = [...new Set(monthTx.filter(t => t.type === 'expense' && !IMPULSIVE_CATEGORIES.includes(t.category)).map(t => t.category))];
    otherCats.forEach(cat => {
      const catTotal = monthTx.filter(t => t.type === 'expense' && t.category === cat).reduce((s, t) => s + t.amount, 0);
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
    if (!bell || !panel) {
      debugLog('Notification elements not ready, deferring...');
      setTimeout(setupNotifications, 500);
      return;
    }

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
      if (!panel.contains(e.target) && !bell.contains(e.target)) panel.style.display = 'none';
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
        const catTotal = monthTx.filter(t => t.type === 'expense' && t.category === cat).reduce((s, t) => s + t.amount, 0);
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
        text: `Your balance is negative (${formatCurrency(balance)}). You're spending more than you earn!`,
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
    const exists = state.notifications.some(n => n.text === notif.text && n.timestamp > oneDayAgo);
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
    const saveSettings = $('#save-settings');
    const saveBudget = $('#save-budget');
    if (!saveSettings || !saveBudget) {
      debugLog('Settings elements not ready, deferring...');
      setTimeout(setupSettings, 500);
      return;
    }

    saveSettings.addEventListener('click', () => {
      state.settings.survivalThreshold = parseInt($('#threshold-setting').value) || 20;
      state.settings.impulsiveThreshold = parseInt($('#impulsive-threshold').value) || 10;
      saveToStorage();
      syncSettingsToSupabase();
      refreshAll();
      showToast('Settings saved!', 'success');
    });

    saveBudget.addEventListener('click', () => {
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
    if (!overlay || !closeBtn) {
      debugLog('Modal elements not ready, deferring...');
      setTimeout(setupModal, 500);
      return;
    }
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  }

  function closeModal() {
    $('#modal-overlay').style.display = 'none';
  }

  // ===== Filters =====
  function setupFilters() {
    const filterType = $('#filter-type');
    const filterCategory = $('#filter-category');
    if (!filterType || !filterCategory) {
      debugLog('Filter elements not ready, deferring...');
      setTimeout(setupFilters, 500);
      return;
    }
    filterType.addEventListener('change', renderAllTransactions);
    filterCategory.addEventListener('change', renderAllTransactions);
  }

  // ===== Theme Toggle =====
  function setupThemeToggle() {
    const toggle = $('#theme-toggle');
    const darkIcon = $('#theme-icon-dark');
    const lightIcon = $('#theme-icon-light');
    if (!toggle) {
      debugLog('Theme toggle not ready, deferring...');
      setTimeout(setupThemeToggle, 500);
      return;
    }

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
    const qaType = $('#qa-type');
    const txType = $('#tx-type');
    if (!qaType || !txType) {
      debugLog('Category filter elements not ready, deferring...');
      setTimeout(setupCategoryFiltering, 500);
      return;
    }
    updateQaCategories();
    updateTxCategories();
  }

  function parseExpenseSubtype(cat) {
    let subtypes = [];
    if (cat.expense_subtype) {
      try { subtypes = JSON.parse(cat.expense_subtype); }
      catch (e) {
        if (typeof cat.expense_subtype === 'string') subtypes = cat.expense_subtype.split(',').map(s => s.trim());
        else if (Array.isArray(cat.expense_subtype)) subtypes = cat.expense_subtype;
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
          if (subtypes.includes(expenseType)) select.add(new Option(cat.emoji + ' ' + cat.label, cat.key));
        }
      });
    } else {
      Object.entries(CATEGORIES).forEach(([key, cat]) => {
        if (type === 'income' && (cat.type === 'income' || cat.type === 'both')) {
          select.add(new Option(cat.emoji + ' ' + cat.label, key));
        } else if (type === 'expense' && (cat.type === 'expense' || cat.type === 'both')) {
          if (cat.expenseSubtype && cat.expenseSubtype.includes(expenseType)) select.add(new Option(cat.emoji + ' ' + cat.label, key));
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
          if (subtypes.includes(expenseType)) select.add(new Option(cat.emoji + ' ' + cat.label, cat.key));
        }
      });
    } else {
      Object.entries(CATEGORIES).forEach(([key, cat]) => {
        if (type === 'income' && (cat.type === 'income' || cat.type === 'both')) {
          select.add(new Option(cat.emoji + ' ' + cat.label, key));
        } else if (type === 'expense' && (cat.type === 'expense' || cat.type === 'both')) {
          if (cat.expenseSubtype && cat.expenseSubtype.includes(expenseType)) select.add(new Option(cat.emoji + ' ' + cat.label, key));
        }
      });
    }
  }

  // ===== Export / Clear =====
  function setupExportClear() {
    const exportBtn = $('#export-data');
    const importBtn = $('#import-data');
    const importFile = $('#import-file');
    const clearBtn = $('#clear-data');
    if (!exportBtn || !importBtn || !importFile || !clearBtn) {
      debugLog('Export/Clear elements not ready, deferring...');
      setTimeout(setupExportClear, 500);
      return;
    }

    exportBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ transactions: state.transactions, settings: state.settings, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `survivalfi_export_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Data exported!', 'success');
    });

    importBtn.addEventListener('click', () => importFile.click());

    importFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.transactions && Array.isArray(data.transactions)) state.transactions = data.transactions;
        if (data.settings) state.settings = { ...state.settings, ...data.settings };
        state.notifications = [];
        saveToStorage();
        if (state.user && !state.isLocalMode) await uploadLocalDataToSupabase();
        applySettingsToUI();
        refreshAll();
        showToast('Data imported!', 'success');
      } catch (err) {
        showToast('Import failed: Invalid JSON', 'error');
      }
      e.target.value = '';
    });

    clearBtn.addEventListener('click', () => {
      if (confirm('Delete all transactions and reset settings?')) {
        state.transactions = [];
        state.notifications = [];
        state.settings = { survivalThreshold: 20, impulsiveThreshold: 10, monthlyIncome: 0, monthlyFixed: 0, monthlyBudget: 0, theme: state.settings.theme };
        saveToStorage();
        if (state.user && !state.isLocalMode) clearSupabaseData().catch(() => {});
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((new Date() - new Date(dateStr)) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  // ===== Boot =====
  function startApp() {
    debugLog('Components loaded, starting app...');
    (async function() {
      try {
        await init();
      } catch (err) {
        console.error('Init failed:', err);
        debugLog('INIT FAILED: ' + err.message);
        const authScreen = document.getElementById('auth-screen');
        if (authScreen) {
          authScreen.innerHTML = '<div style="padding:2rem;text-align:center;"><h2>Application Error</h2><p>' + escapeHtml(err.message) + '</p><button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;">Reload</button></div>';
        }
      }
    })();
  }

  if (window.__survivalfiComponentsLoaded) {
    startApp();
  } else {
    debugLog('Waiting for components...');
    window.addEventListener('survivalfi-components-loaded', startApp);
    setTimeout(function() {
      if (!window.__survivalfiComponentsLoaded) {
        debugLog('Component timeout, starting anyway...');
        startApp();
      }
    }, 2000);
  }
})();