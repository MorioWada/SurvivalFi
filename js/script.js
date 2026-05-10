// ===== SurvivalFi — Main Application (Refactored v2) =====
// Clean, non-overlapping logic. No extreme cases.

(function () {
  'use strict';

  // ===== State =====
  const state = {
    user: null,
    supabase: null,
    transactions: [],
    notifications: [],
    settings: {
      survivalThreshold: 20,
      impulsiveThreshold: 10,
      monthlyIncome: 0,
      monthlyFixed: 0,
      monthlyBudget: 0,
    },
    isRegistering: false,
  };

  // ===== Category Config =====
  const CATEGORIES = {
    food:            { emoji: '🍜', label: 'Food',             color: '#f59e0b', type: 'expense', expenseSubtype: ['variable', 'fixed'] },
    transportation:  { emoji: '🚗', label: 'Transportation',   color: '#3b82f6', type: 'expense', expenseSubtype: ['variable', 'fixed'] },
    housing:         { emoji: '🏠', label: 'Housing',          color: '#8b5cf6', type: 'expense', expenseSubtype: ['fixed'] },
    utilities:       { emoji: '💡', label: 'Utilities',        color: '#eab308', type: 'expense', expenseSubtype: ['fixed', 'variable'] },
    entertainment:   { emoji: '🎬', label: 'Entertainment',    color: '#ec4899', type: 'expense', expenseSubtype: ['variable'] },
    healthcare:      { emoji: '🏥', label: 'Healthcare',       color: '#ef4444', type: 'expense', expenseSubtype: ['fixed', 'variable'] },
    shopping:        { emoji: '🛍️', label: 'Shopping',         color: '#14b8a6', type: 'expense', expenseSubtype: ['variable'] },
    education:       { emoji: '📚', label: 'Education',        color: '#6366f1', type: 'expense', expenseSubtype: ['fixed'] },
    salary:          { emoji: '💼', label: 'Salary',           color: '#22c55e', type: 'income' },
    freelance:       { emoji: '💻', label: 'Freelance',        color: '#06b6d4', type: 'income' },
    investment:      { emoji: '📈', label: 'Investment',       color: '#a855f7', type: 'income' },
    other:           { emoji: '📦', label: 'Other',            color: '#94a3b8', type: 'both',    expenseSubtype: ['variable', 'fixed'] },
  };

  // Categories considered "impulsive" (discretionary spending)
  const IMPULSIVE_CATEGORIES = ['entertainment', 'shopping'];

  // ===== DOM Helpers =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ===== Initialization =====
  async function init() {
    await loadFromStorage();
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

    if (state.user) {
      showApp();
    }
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
      }
    } catch (e) {
      console.warn('Failed to load storage', e);
    }

    // If Supabase connected, load fresh data
    if (state.supabase && state.user?.id) {
      try {
        await Promise.all([
          loadTransactionsFromSupabase(),
          loadNotificationsFromSupabase(),
          loadSettingsFromSupabase()
        ]);
      } catch (err) {
        console.warn('Failed to load from Supabase:', err);
      }
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem('survivalfi_data', JSON.stringify({
        user: state.user,
        transactions: state.transactions,
        notifications: state.notifications,
        settings: state.settings,
      }));
      if (state.supabase && state.user?.id) {
        syncSettingsToSupabase().catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to save storage', e);
    }
  }

  // ===== Toast =====
  function showToast(message, type = 'info') {
    const container = $('#toast-container');
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

    toggle.addEventListener('click', () => {
      state.isRegistering = !state.isRegistering;
      title.textContent = state.isRegistering ? 'Create Account' : 'Sign In';
      $('#auth-submit').textContent = state.isRegistering ? 'Create Account' : 'Sign In';
      toggle.textContent = state.isRegistering ? 'Already have an account? Sign In' : 'Create Account';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#auth-email').value.trim();
      const password = $('#auth-password').value;
      const url = $('#supabase-url').value.trim();
      const key = $('#supabase-key').value.trim();

      if (url && key) {
        try {
          if (!state.supabase) {
            state.supabase = window.supabase.createClient(url, key);
          }
          let result;
          if (state.isRegistering) {
            result = await state.supabase.auth.signUp({ email, password });
            if (result.error) throw result.error;
            state.user = { email: result.data.user.email, id: result.data.user.id };
            await loadTransactionsFromSupabase();
            saveToStorage();
            showApp();
            showToast('Account created! Check your email for verification.', 'success');
          } else {
            result = await state.supabase.auth.signInWithPassword({ email, password });
            if (result.error) throw result.error;
            state.user = { email: result.data.user.email, id: result.data.user.id };
            await loadTransactionsFromSupabase();
            await loadNotificationsFromSupabase();
            await loadSettingsFromSupabase();
            saveToStorage();
            showApp();
            showToast('Signed in successfully!', 'success');
          }
        } catch (err) {
          showToast(err.message || 'Authentication failed', 'error');
        }
      } else {
        // Offline mode
        if (!email || !password) {
          showToast('Please enter email and password', 'error');
          return;
        }
        state.user = { email, id: 'local_' + btoa(email).slice(0, 12) };
        saveToStorage();
        showApp();
        showToast(state.isRegistering ? 'Account created (local mode)!' : 'Signed in (local mode)!', 'success');
      }
    });
  }

  // ===== Supabase Database Operations (SINGLE declarations only) =====
  async function loadTransactionsFromSupabase() {
    if (!state.supabase || !state.user?.id) return;
    try {
      const { data, error } = await state.supabase
        .from('transactions')
        .select('*')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (data) {
        state.transactions = data.map(t => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          category: t.category_key || t.category,
          expenseType: t.expense_type,
          description: t.description,
          date: t.date,
          createdAt: t.created_at,
        }));
      }
    } catch (err) {
      console.warn('Failed to load from Supabase:', err);
    }
  }

  async function syncTransactionToSupabase(tx) {
    if (!state.supabase || !state.user?.id) return;
    try {
      await state.supabase.from('transactions').upsert({
        id: tx.id,
        user_id: state.user.id,
        type: tx.type,
        amount: tx.amount,
        category: tx.category,
        expense_type: tx.expenseType,
        description: tx.description,
        date: tx.date,
        created_at: tx.createdAt,
      });
    } catch (err) {
      console.warn('Sync failed:', err);
    }
  }

  async function deleteTransactionFromSupabase(txId) {
    if (!state.supabase || !state.user?.id) return;
    try {
      await state.supabase.from('transactions').delete().eq('id', txId);
    } catch (err) {
      console.warn('Delete sync failed:', err);
    }
  }

  async function loadNotificationsFromSupabase() {
    if (!state.supabase || !state.user?.id) return;
    try {
      const { data, error } = await state.supabase
        .from('notifications')
        .select('*')
        .eq('user_id', state.user.id)
        .order('timestamp', { ascending: false });
      if (error) throw error;
      if (data) {
        state.notifications = data.map(n => ({
          id: n.id,
          type: n.type,
          text: n.text,
          timestamp: n.timestamp,
        }));
      }
    } catch (err) {
      console.warn('Failed to load notifications:', err);
    }
  }

  async function syncNotificationToSupabase(notif) {
    if (!state.supabase || !state.user?.id) return;
    try {
      await state.supabase.from('notifications').upsert({
        id: notif.id,
        user_id: state.user.id,
        type: notif.type,
        text: notif.text,
        timestamp: notif.timestamp,
      });
    } catch (err) {
      console.warn('Failed to sync notification:', err);
    }
  }

  async function loadSettingsFromSupabase() {
    if (!state.supabase || !state.user?.id) return;
    try {
      const { data, error } = await state.supabase
        .from('settings')
        .select('*')
        .eq('user_id', state.user.id)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        state.settings = {
          survivalThreshold: data.survival_threshold ?? 20,
          impulsiveThreshold: data.impulsive_threshold ?? 10,
          monthlyIncome: data.monthly_income ?? 0,
          monthlyFixed: data.monthly_fixed ?? 0,
          monthlyBudget: data.monthly_budget ?? 0,
          theme: data.theme ?? 'dark',
        };
      }
    } catch (err) {
      console.warn('Failed to load settings:', err);
    }
  }

  async function syncSettingsToSupabase() {
    if (!state.supabase || !state.user?.id) return;
    try {
      await state.supabase.from('settings').upsert({
        user_id: state.user.id,
        monthly_income: state.settings.monthlyIncome,
        monthly_fixed: state.settings.monthlyFixed,
        monthly_budget: state.settings.monthlyBudget,
        survival_threshold: state.settings.survivalThreshold,
        impulsive_threshold: state.settings.impulsiveThreshold,
        theme: state.settings.theme,
      });
    } catch (err) {
      console.warn('Failed to sync settings:', err);
    }
  }

  // ===== Show App =====
  function showApp() {
    $('#auth-screen').classList.remove('active');
    $('#app-screen').classList.add('active');
    $('#user-email').textContent = state.user?.email || 'user';
    $('#user-avatar').textContent = (state.user?.email || 'U')[0].toUpperCase();
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

    $('#logout-btn').addEventListener('click', () => {
      if (state.supabase) state.supabase.auth.signOut().catch(() => {});
      state.user = null;
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
        description: $('#qa-desc').value || CATEGORIES[$('#qa-category').value]?.label || 'Transaction',
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
        description: $('#tx-desc').value || CATEGORIES[$('#tx-category').value]?.label || 'Transaction',
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
      id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
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
    const { monthTx, income, expenses, balance } = getMonthData();

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
    const cat = CATEGORIES[tx.category] || CATEGORIES.other;
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
      const info = CATEGORIES[cat] || CATEGORIES.other;
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
  // ===== SURVIVAL SCORE — CLEAN, NON-OVERLAPPING LOGIC =====
  // ============================================================

  function calculateSurvivalScore() {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    const { monthTx, income, expenses, balance, fixedExpenses, variableExpenses } = getMonthData();

    const monthlyIncome = state.settings.monthlyIncome || income || 1; // avoid div by zero
    const monthlyFixed = state.settings.monthlyFixed || 0;

    // --- FACTOR 1: RUNWAY SCORE (40% weight) ---
    // "How many months can you survive with current balance?"
    const projectedVariable = state.settings.monthlyBudget > 0
      ? Math.min(variableExpenses, state.settings.monthlyBudget)
      : variableExpenses;
    const totalMonthlyOutflow = monthlyFixed + projectedVariable;
    const runwayMonths = balance / Math.max(totalMonthlyOutflow, 1);
    const runwayScore = calculateRunwayScore(runwayMonths);

    // --- FACTOR 2: RATIO SCORE (30% weight) ---
    // "Income vs Expenses health"
    const ratioScore = calculateRatioScore(income, expenses);

    // --- FACTOR 3: STABILITY SCORE (20% weight) ---
    // "Income consistency" (based on last 3 months)
    const stabilityScore = calculateStabilityScore();

    // --- FACTOR 4: BUFFER SCORE (10% weight) ---
    // "Emergency fund status" (balance vs 3-month fixed expenses)
    const bufferScore = calculateBufferScore(balance, monthlyFixed);

    // --- FINAL SCORE ---
    let score = Math.round(
      runwayScore * 0.40 +
      ratioScore * 0.30 +
      stabilityScore * 0.20 +
      bufferScore * 0.10
    );

    // Clamp 0-100
    score = Math.max(0, Math.min(100, score));

    // --- UPDATE UI ---
    updateSurvivalUI(score, runwayScore, ratioScore, stabilityScore, bufferScore, {
      daysRemaining,
      daysInMonth,
      dayOfMonth,
      balance,
      monthlyFixed,
      monthlyIncome,
      fixedExpenses,
      variableExpenses,
      income,
      expenses
    });

    return score;
  }

  // --- Runway Score: Non-linear mapping ---
  function calculateRunwayScore(runwayMonths) {
    if (runwayMonths >= 6) return 100;
    if (runwayMonths >= 3) return 70 + ((runwayMonths - 3) / 3) * 30;
    if (runwayMonths >= 1) return 30 + ((runwayMonths - 1) / 2) * 40;
    return Math.max(0, runwayMonths * 30);
  }

  // --- Ratio Score: Income vs Expenses ---
  function calculateRatioScore(income, expenses) {
    if (income <= 0) return expenses > 0 ? 0 : 50;
    const ratio = income / Math.max(expenses, 1);
    if (ratio >= 2.0) return 100;
    if (ratio >= 1.0) return 50 + ((ratio - 1.0) / 1.0) * 50;
    return Math.max(0, ratio * 50);
  }

  //actual vs expected income
  function calculateStabilityScore() {
    const expectedIncome = state.settings.monthlyIncome;
    if (expectedIncome <= 0) return 50; // neutral if no budget set

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

  // --- Buffer Score: Emergency fund progress ---
  function calculateBufferScore(currentBalance, monthlyFixed) {
    const target = monthlyFixed * 3;
    if (target <= 0) return currentBalance > 0 ? 100 : 50;
    return Math.min(100, (currentBalance / target) * 100);
  }

  // --- Update Survival Score UI ---
  function updateSurvivalUI(score, runwayScore, ratioScore, stabilityScore, bufferScore, data) {
    const {
      daysRemaining, daysInMonth, dayOfMonth, balance,
      monthlyFixed, monthlyIncome, fixedExpenses, variableExpenses, income, expenses
    } = data;

    // Main score display
    $('#stat-survival').textContent = score + '%';
    $('#stat-survival').className = 'stat-value ' + (score <= 20 ? 'danger' : score <= 50 ? 'warning' : 'safe');

    // Ring animation
    const circle = $('#survival-circle');
    const circumference = 534;
    const offset = circumference - (score / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = getSurvivalColor(score);
    $('#survival-number').textContent = score + '%';

    // Status text
    let status, statusColor;
    if (score >= 70) { status = 'Financially Healthy'; statusColor = 'var(--green)'; }
    else if (score >= 50) { status = 'Moderate — Stay Cautious'; statusColor = 'var(--text-primary)'; }
    else if (score >= 30) { status = 'At Risk — Tighten Budget'; statusColor = 'var(--orange)'; }
    else { status = 'Critical — Immediate Action Needed'; statusColor = 'var(--red)'; }

    const statusEl = $('#survival-status');
    statusEl.textContent = status;
    statusEl.style.color = statusColor;

    // Factor: Days Remaining
    $('#factor-days').textContent = daysRemaining + ' days';
    $('#factor-days-bar').style.width = ((daysRemaining / daysInMonth) * 100) + '%';
    $('#factor-days-bar').style.background = 'var(--accent)';

    // Factor: Daily Budget
    const avgDailySpend = dayOfMonth > 0 ? expenses / dayOfMonth : 0;
    const dailyBudget = daysRemaining > 0 && balance > 0 ? balance / daysRemaining : 0;
    $('#factor-daily').textContent = formatCurrency(dailyBudget) + '/day';
    const dailyPct = avgDailySpend > 0 ? Math.min((dailyBudget / avgDailySpend) * 50, 100) : (dailyBudget > 0 ? 80 : 0);
    $('#factor-daily-bar').style.width = dailyPct + '%';
    $('#factor-daily-bar').style.background = dailyPct > 60 ? 'var(--green)' : dailyPct > 30 ? 'var(--orange)' : 'var(--red)';

    // Factor: Fixed Expenses Coverage
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

    // Factor: Impulsive Spending Risk
    const impulsiveTotal = monthTx => monthTx
      .filter(t => t.type === 'expense' && IMPULSIVE_CATEGORIES.includes(t.category))
      .reduce((s, t) => s + t.amount, 0);
    const { monthTx: currentMonthTx } = getMonthData();
    const impulsiveAmount = impulsiveTotal(currentMonthTx);
    const impulsiveRatio = monthlyIncome > 0 ? (impulsiveAmount / monthlyIncome) * 100 : 0;

    $('#factor-impulsive').textContent = impulsiveRatio.toFixed(1) + '% of income';
    const impPct = Math.min(impulsiveRatio * 3, 100);
    $('#factor-impulsive-bar').style.width = impPct + '%';
    $('#factor-impulsive-bar').style.background = impulsiveRatio <= state.settings.impulsiveThreshold
      ? 'var(--green)' : impulsiveRatio <= state.settings.impulsiveThreshold * 2 ? 'var(--orange)' : 'var(--red)';
  }

  // ===== Impulsive Detection (Single, Clear Logic) =====
  // A transaction is impulsive if:
  // 1. It's a variable expense in an impulsive category (entertainment/shopping)
  // 2. AND the total spent in that category this month exceeds the threshold % of income
  function isImpulsiveTransaction(tx) {
    if (tx.type !== 'expense' || tx.expenseType !== 'variable') return false;
    if (!IMPULSIVE_CATEGORIES.includes(tx.category)) return false;

    const { income } = getMonthData();
    if (income <= 0) return false;

    // Check if total spending in this category exceeds threshold
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

    // Analyze impulsive categories
    IMPULSIVE_CATEGORIES.forEach(cat => {
      const catTotal = monthTx
        .filter(t => t.type === 'expense' && t.category === cat)
        .reduce((s, t) => s + t.amount, 0);
      const pct = (catTotal / income) * 100;
      const info = CATEGORIES[cat];

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

    // Check other categories for unusually high spending (>30% of income)
    const otherCats = [...new Set(monthTx
      .filter(t => t.type === 'expense' && !IMPULSIVE_CATEGORIES.includes(t.category))
      .map(t => t.category))];

    otherCats.forEach(cat => {
      const catTotal = monthTx
        .filter(t => t.type === 'expense' && t.category === cat)
        .reduce((s, t) => s + t.amount, 0);
      const pct = (catTotal / income) * 100;
      if (pct > 30) {
        const info = CATEGORIES[cat] || CATEGORIES.other;
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
          <div class="impulsive-detail">${formatCurrency(a.total)} spent — ${a.level}</div>
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

    // Clear old month notifications
    state.notifications = state.notifications.filter(n => {
      const d = new Date(n.timestamp);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    // 1. Survival score below threshold
    if (score <= threshold) {
      addNotification({
        type: 'danger',
        text: `Your survival score is ${score}% — below your ${threshold}% threshold. Review your spending immediately!`,
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Impulsive spending alerts (category-level)
    if (income > 0) {
      IMPULSIVE_CATEGORIES.forEach(cat => {
        const catTotal = monthTx
          .filter(t => t.type === 'expense' && t.category === cat)
          .reduce((s, t) => s + t.amount, 0);
        const pct = (catTotal / income) * 100;

        if (pct > state.settings.impulsiveThreshold) {
          const info = CATEGORIES[cat];
          addNotification({
            type: 'warning',
            text: `${info.emoji} ${info.label} spending is at ${pct.toFixed(1)}% of income — exceeding your ${state.settings.impulsiveThreshold}% threshold.`,
            timestamp: new Date().toISOString(),
          });
        }
      });
    }

    // 3. Negative balance
    if (balance < 0) {
      addNotification({
        type: 'danger',
        text: `Your balance is negative (${formatCurrency(balance)}). You're spending more than you earn this month!`,
        timestamp: new Date().toISOString(),
      });
    }

    // 4. Fixed expenses not covered (if set)
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
    // Avoid exact duplicates in last 24h
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const exists = state.notifications.some(n =>
      n.text === notif.text && n.timestamp > oneDayAgo
    );
    if (!exists) {
      const newNotif = { ...notif, id: 'n_' + Date.now() };
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
      refreshAll();
      showToast('Settings saved!', 'success');
    });

    $('#save-budget').addEventListener('click', () => {
      state.settings.monthlyIncome = parseFloat($('#monthly-income').value) || 0;
      state.settings.monthlyFixed = parseFloat($('#monthly-fixed').value) || 0;
      state.settings.monthlyBudget = parseFloat($('#monthly-budget').value) || 0;
      saveToStorage();
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
    });
  }

  // ===== Category Filtering =====
  function setupCategoryFiltering() {
    updateQaCategories();
    updateTxCategories();
  }

    function updateQaCategories() {
    const type = $('#qa-type').value;
    const expenseType = $('#qa-expense-type').value;
    const select = $('#qa-category');
    select.innerHTML = '';

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

  function updateTxCategories() {
    const type = $('#tx-type').value;
    const expenseType = $('#tx-expense-type').value;
    const select = $('#tx-category');
    select.innerHTML = '';

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
        };
        saveToStorage();
        applySettingsToUI();
        refreshAll();
        showToast('All data cleared', 'info');
      }
    });
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
    return sign + 'Rp' + Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
  init().catch(err => console.error('Init failed:', err));
})();
