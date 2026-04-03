// ===== SurvivalFi — Main Application =====

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
    food:            { emoji: '🍜', label: 'Food',            color: '#f59e0b', type: 'expense', expenseSubtype: ['variable', 'fixed'] },
    transportation:  { emoji: '🚗', label: 'Transportation',  color: '#3b82f6', type: 'expense', expenseSubtype: ['variable', 'fixed'] },
    housing:         { emoji: '🏠', label: 'Housing',          color: '#8b5cf6', type: 'expense', expenseSubtype: ['fixed'] },
    utilities:       { emoji: '💡', label: 'Utilities',        color: '#eab308', type: 'expense', expenseSubtype: ['fixed', 'variable'] },
    entertainment:   { emoji: '🎬', label: 'Entertainment',    color: '#ec4899', type: 'expense', expenseSubtype: ['variable'] },
    healthcare:      { emoji: '🏥', label: 'Healthcare',       color: '#ef4444', type: 'expense', expenseSubtype: ['fixed', 'variable'] },
    shopping:        { emoji: '🛍️', label: 'Shopping',         color: '#14b8a6', type: 'expense', expenseSubtype: ['variable'] },
    education:       { emoji: '📚', label: 'Education',        color: '#6366f1', type: 'expense', expenseSubtype: ['fixed'] },
    salary:          { emoji: '💼', label: 'Salary',           color: '#22c55e', type: 'income' },
    freelance:       { emoji: '💻', label: 'Freelance',        color: '#06b6d4', type: 'income' },
    investment:      { emoji: '📈', label: 'Investment',       color: '#a855f7', type: 'income' },
    other:           { emoji: '📦', label: 'Other',            color: '#94a3b8', type: 'both', expenseSubtype: ['variable', 'fixed'] },
};

  const IMPULSIVE_CATEGORIES = ['entertainment', 'shopping'];

  // ===== DOM References =====
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
    
    // If we have a user, try to load fresh data from Supabase
    if (state.supabase && state.user?.id) {
      try {
        await Promise.all([
          loadTransactionsFromSupabase(),
          loadNotificationsFromSupabase(),
          loadSettingsFromSupabase()
        ]);
      } catch (err) {
        console.warn('Failed to load some data from Supabase:', err);
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
      // Sync with Supabase in background
      if (state.supabase && state.user?.id) {
        syncSettingsToSupabase().catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to save storage', e);
    }
  }

  // ===== Toast Notifications =====
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
        // Supabase auth
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
            await initializeDefaultCategories();
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
        // Offline / local mode
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

  // ===== Supabase Database Operations =====
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
          category: t.category_key,
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

  async function initializeDefaultCategories() {
    if (!state.supabase) return;
    try {
      const { data: existingCategories, error: checkError } = await state.supabase
        .from('categories')
        .select('key');
      if (checkError && checkError.code !== 'PGRST116') throw checkError;
      if (!existingCategories || existingCategories.length === 0) {
        const defaultCategories = [
          { key: 'food', emoji: '🍜', label: 'Food', color: '#f59e0b', type: 'expense', expense_subtype: JSON.stringify(['variable', 'fixed']) },
          { key: 'transportation', emoji: '🚗', label: 'Transportation', color: '#3b82f6', type: 'expense', expense_subtype: JSON.stringify(['variable', 'fixed']) },
          { key: 'housing', emoji: '🏠', label: 'Housing', color: '#8b5cf6', type: 'expense', expense_subtype: JSON.stringify(['fixed']) },
          { key: 'utilities', emoji: '💡', label: 'Utilities', color: '#eab308', type: 'expense', expense_subtype: JSON.stringify(['fixed', 'variable']) },
          { key: 'entertainment', emoji: '🎬', label: 'Entertainment', color: '#ec4899', type: 'expense', expense_subtype: JSON.stringify(['variable']) },
          { key: 'healthcare', emoji: '🏥', label: 'Healthcare', color: '#ef4444', type: 'expense', expense_subtype: JSON.stringify(['fixed', 'variable']) },
          { key: 'shopping', emoji: '🛍️', label: 'Shopping', color: '#14b8a6', type: 'expense', expense_subtype: JSON.stringify(['variable']) },
          { key: 'education', emoji: '📚', label: 'Education', color: '#6366f1', type: 'expense', expense_subtype: JSON.stringify(['fixed']) },
          { key: 'salary', emoji: '💼', label: 'Salary', color: '#22c55e', type: 'income', expense_subtype: null },
          { key: 'freelance', emoji: '💻', label: 'Freelance', color: '#06b6d4', type: 'income', expense_subtype: null },
          { key: 'investment', emoji: '📈', label: 'Investment', color: '#a855f7', type: 'income', expense_subtype: null },
          { key: 'other', emoji: '📦', label: 'Other', color: '#94a3b8', type: 'both', expense_subtype: JSON.stringify(['variable', 'fixed']) }
        ];
        const { error: insertError } = await state.supabase.from('categories').insert(defaultCategories);
        if (insertError) throw insertError;
      }
    } catch (err) {
      console.warn('Failed to initialize categories:', err);
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
        category_key: tx.category,
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
          persistent: n.persistent
        }));
      }
    } catch (err) {
      console.warn('Failed to load notifications from Supabase:', err);
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
        persistent: notif.persistent
      });
    } catch (err) {
      console.warn('Failed to sync notification to Supabase:', err);
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
          survivalThreshold: data.survival_threshold,
          impulsiveThreshold: data.impulsive_threshold,
          monthlyIncome: data.monthly_income,
          monthlyFixed: data.monthly_fixed,
          monthlyBudget: data.monthly_budget,
          theme: data.theme
        };
      }
    } catch (err) {
      console.warn('Failed to load settings from Supabase:', err);
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
        theme: state.settings.theme
      });
    } catch (err) {
      console.warn('Failed to sync settings to Supabase:', err);
    }
  }

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
          category: t.category,
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

    function openSidebar() {
      sidebar.classList.add('open');
      overlay.classList.add('active');
    }

    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    }

    hamburger.addEventListener('click', () => {
      if (sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    overlay.addEventListener('click', closeSidebar);

    // Close sidebar when a nav item is clicked on mobile
    $$('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 640) {
          closeSidebar();
        }
      });
    });
  }

// ===== Quick Add =====
function setupQuickAdd() {
     const form = $('#quick-add-form');
     const typeSelect = $('#qa-type');
     const expenseTypeSelect = $('#qa-expense-type');
     const expenseTypeGroup = $('#qa-expense-type');

     typeSelect.addEventListener('change', () => {
        const isIncome = typeSelect.value === 'income';
        expenseTypeGroup.closest('.form-group').style.display = isIncome ? 'none' : '';
        updateQaCategories();
      });

     expenseTypeSelect.addEventListener('change', () => {
        updateQaCategoriesByExpenseType(typeSelect.value, expenseTypeSelect.value);
      });

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
         expenseType: $('#qa-expense-type').value,
         description: $('#qa-desc').value || CATEGORIES[$('#qa-category').value]?.label || 'Transaction',
       });

addTransaction(tx);
        form.reset();
        typeSelect.value = 'expense';
        expenseTypeSelect.value = 'variable';
        expenseTypeGroup.closest('.form-group').style.display = '';
        updateQaCategories();
        showToast('Transaction added!', 'success');
      });
  }

  // ===== Transaction Form (Modal) =====
  function setupTransactionForm() {
    const form = $('#transaction-form');

    // Toggle buttons
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
           }
         });
       });
     });

    // Set default date
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
         expenseType: $('#tx-expense-type').value,
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
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthTx = state.transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balance = income - expenses;

    $('#stat-income').textContent = formatCurrency(income);
    $('#stat-expenses').textContent = formatCurrency(expenses);
    $('#stat-balance').textContent = formatCurrency(balance);
    $('#stat-balance').className = 'stat-value ' + (balance < 0 ? 'danger' : balance < 100 ? 'warning' : 'safe');
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
    const isImpulsive = tx.type === 'expense' && isImpulsiveExpense(tx);
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
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthExpenses = state.transactions.filter(t => {
      const d = new Date(t.date);
      return t.type === 'expense' && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

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

  // ===== Survival Score Calculation =====
  function calculateSurvivalScore() {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    const monthTx = state.transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const totalIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const currentBalance = totalIncome - totalExpenses;

    const monthlyIncome = state.settings.monthlyIncome || totalIncome;
    const monthlyFixed = state.settings.monthlyFixed || 0;

    const fixedPaidThisMonth = monthTx
      .filter(t => t.type === 'expense' && t.expenseType === 'fixed')
      .reduce((s, t) => s + t.amount, 0);
    const variablePaidThisMonth = monthTx
      .filter(t => t.type === 'expense' && t.expenseType === 'variable')
      .reduce((s, t) => s + t.amount, 0);

    let fixedBalance = Math.max(0, monthlyFixed - fixedPaidThisMonth);
    let variableBalance = Math.max(0, currentBalance - fixedBalance);

    let fixedCoverageStatus = 'covered';
    if (monthlyFixed > 0) {
      if (fixedPaidThisMonth >= monthlyFixed) {
        fixedCoverageStatus = 'covered';
        fixedBalance = 0;
        variableBalance = currentBalance;
      } else if (currentBalance >= monthlyFixed) {
        fixedCoverageStatus = 'covered';
        variableBalance = currentBalance - monthlyFixed;
        fixedBalance = 0;
      } else if (fixedPaidThisMonth > 0) {
        const remainingNeeded = monthlyFixed - fixedPaidThisMonth;
        if (currentBalance >= remainingNeeded) {
          fixedCoverageStatus = 'covered';
          fixedBalance = 0;
          variableBalance = currentBalance - remainingNeeded;
        } else {
          fixedCoverageStatus = 'partial';
          fixedBalance = remainingNeeded - currentBalance;
          variableBalance = 0;
        }
      } else if (currentBalance >= monthlyFixed) {
        fixedCoverageStatus = 'covered';
        fixedBalance = 0;
        variableBalance = currentBalance;
      } else {
        fixedCoverageStatus = 'partial';
        fixedBalance = monthlyFixed - currentBalance;
        variableBalance = 0;
      }
    } else {
      if (fixedPaidThisMonth > 0 && currentBalance < fixedPaidThisMonth) {
        fixedCoverageStatus = 'uncovered';
        fixedBalance = fixedPaidThisMonth - currentBalance;
        variableBalance = 0;
      }
    }

    const avgVariableSpending = dayOfMonth > 0 ? variablePaidThisMonth / dayOfMonth : 0;
    const dailyVariableBudget = daysInMonth > 0 && variableBalance > 0 ? variableBalance / daysRemaining : 0;

    let score = 50;
    let fixedStatus = 'good';

    if (monthlyFixed > 0) {
      if (fixedCoverageStatus === 'covered') {
        score += 15;
        fixedStatus = 'good';
      } else if (fixedCoverageStatus === 'partial') {
        const coveredRatio = fixedPaidThisMonth / monthlyFixed;
        score += coveredRatio * 10;
        fixedStatus = 'moderate';
      } else {
        score = Math.max(0, (currentBalance / monthlyFixed) * 40);
        fixedStatus = 'at-risk';
      }
    } else if (fixedPaidThisMonth > 0) {
      if (variableBalance > 0) {
        if (avgVariableSpending <= dailyVariableBudget) {
          score += 10;
          fixedStatus = 'good';
        } else if (avgVariableSpending <= dailyVariableBudget * 1.1) {
          score += 5;
          fixedStatus = 'moderate';
        } else {
          const overRatio = avgVariableSpending / dailyVariableBudget;
          score -= Math.min((overRatio - 1) * 20, 30);
          fixedStatus = 'at-risk';
        }
      } else {
        score = 0;
        fixedStatus = 'at-risk';
      }
      score += 10;
    } else {
      score += 10;
    }

    if (currentBalance <= 0) {
      score = 0;
    } else if (currentBalance < monthlyIncome * 0.1) {
      score -= 15;
    } else if (fixedBalance <= 0) {
      const balanceRatio = Math.max(0, currentBalance) / monthlyIncome;
      score += balanceRatio * 20;
    }

    const dailyBudget = daysRemaining > 0 && currentBalance > 0 ? currentBalance / daysRemaining : 0;
    const avgDailySpend = dayOfMonth > 0 ? totalExpenses / dayOfMonth : 0;
    if (avgDailySpend > 0) {
      const dailyRatio = dailyBudget / avgDailySpend;
      score += Math.min(dailyRatio * 10, 15);
    } else if (currentBalance > 0) {
      score += 10;
    }

// Calculate impulsive spending for survival score - only count if category has ANY impulsive transaction
   const impulsiveCategories = [...new Set(
     monthTx
       .filter(t => t.type === 'expense' && t.expenseType === 'variable')
       .filter(t => isCategoryImpulsive(t.category)) // Only categories with at least one impulsive transaction
       .map(t => t.category)
   )];
   
   const impulsiveTotal = monthTx
       .filter(t => t.type === 'expense' && impulsiveCategories.includes(t.category))
       .reduce((s, t) => s + t.amount, 0);
   const impulsiveRatio = monthlyIncome > 0 ? (impulsiveTotal / monthlyIncome) * 100 : 0;
   if (impulsiveRatio > state.settings.impulsiveThreshold) {
     score -= (impulsiveRatio - state.settings.impulsiveThreshold) * 1.5;
   }

    score = Math.max(0, Math.min(100, Math.round(score)));

    $('#stat-survival').textContent = score + '%';
    $('#stat-survival').className = 'stat-value ' + (score <= 20 ? 'danger' : score <= 50 ? 'warning' : 'safe');

    const circle = $('#survival-circle');
    const circumference = 534;
    const offset = circumference - (score / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = getSurvivalColor(score);
    $('#survival-number').textContent = score + '%';

    let status, statusClass;
    if (score >= 70) { status = 'Financially Healthy'; statusClass = 'safe'; }
    else if (score >= 50) { status = 'Moderate — Stay Cautious'; statusClass = ''; }
    else if (score >= 30) { status = 'At Risk — Tighten Budget'; statusClass = 'warning'; }
    else { status = 'Critical — Immediate Action Needed'; statusClass = 'danger'; }

    const statusEl = $('#survival-status');
    statusEl.textContent = status;
    statusEl.style.color = statusClass === 'safe' ? 'var(--green)' : statusClass === 'warning' ? 'var(--orange)' : statusClass === 'danger' ? 'var(--red)' : 'var(--text-primary)';

    $('#factor-days').textContent = daysRemaining + ' days';
    $('#factor-days-bar').style.width = ((daysRemaining / daysInMonth) * 100) + '%';

    $('#factor-daily').textContent = formatCurrency(dailyBudget) + '/day';
    const dailyPct = avgDailySpend > 0 ? Math.min((dailyBudget / avgDailySpend) * 50, 100) : (dailyBudget > 0 ? 80 : 0);
    $('#factor-daily-bar').style.width = dailyPct + '%';
    $('#factor-daily-bar').style.background = dailyPct > 60 ? 'var(--green)' : dailyPct > 30 ? 'var(--orange)' : 'var(--red)';

    let fixedLabel, fixedPct;
    if (monthlyFixed > 0) {
      if (fixedCoverageStatus === 'covered') {
        fixedLabel = 'Fixed fully covered';
        fixedPct = 100;
      } else if (fixedBalance > 0) {
        fixedLabel = formatCurrency(fixedBalance) + ' needed';
        fixedPct = Math.min(((monthlyFixed - fixedBalance) / monthlyFixed) * 100, 100);
      } else if (fixedPaidThisMonth > 0) {
        fixedLabel = 'Fixed fully covered';
        fixedPct = 100;
      } else {
        fixedLabel = formatCurrency(currentBalance) + ' for variable';
        fixedPct = Math.min((currentBalance / monthlyFixed) * 100, 100);
      }
    } else if (fixedPaidThisMonth > 0) {
      if (currentBalance >= fixedPaidThisMonth) {
        fixedLabel = 'Fixed fully covered';
        fixedPct = 100;
      } else {
        fixedLabel = formatCurrency(fixedPaidThisMonth - currentBalance) + ' needed';
        fixedPct = Math.min((currentBalance / fixedPaidThisMonth) * 100, 100);
      }
    } else if (variableBalance > 0) {
      fixedLabel = formatCurrency(variableBalance) + ' for variable';
      fixedPct = Math.min((variableBalance / Math.max(monthlyIncome - monthlyFixed, 1)) * 100, 100);
    } else {
      fixedLabel = 'No budget left';
      fixedPct = 0;
    }
    $('#factor-fixed').textContent = fixedLabel;
    $('#factor-fixed-bar').style.width = fixedPct + '%';
    $('#factor-fixed-bar').style.background = fixedPct > 60 ? 'var(--green)' : fixedPct > 30 ? 'var(--orange)' : 'var(--red)';

    $('#factor-impulsive').textContent = impulsiveRatio.toFixed(1) + '% of income';
    const impPct = Math.min(impulsiveRatio * 3, 100);
    $('#factor-impulsive-bar').style.width = impPct + '%';
    $('#factor-impulsive-bar').style.background = impulsiveRatio <= state.settings.impulsiveThreshold ? 'var(--green)' : impulsiveRatio <= state.settings.impulsiveThreshold * 2 ? 'var(--orange)' : 'var(--red)';

    return score;
  }

// ===== Impulsive Detection =====
// For displaying impulsive flag on individual transactions (recent transactions list)
// Flag transaction as impulsive if the transaction amount itself exceeds the threshold (per-transaction evaluation)
function isImpulsiveExpense(tx) {
    // Only variable expenses can be flagged as impulsive
    if (tx.type !== 'expense' || tx.expenseType !== 'variable') return false;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthTx = state.transactions.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const totalIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    if (totalIncome <= 0) return false;

    // Per-transaction check: does THIS transaction exceed the impulsive threshold as % of income?
    return (tx.amount / totalIncome) * 100 > state.settings.impulsiveThreshold;
}

// For survival score analysis - check if category has ANY impulsive transactions
function isCategoryImpulsive(category) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthTx = state.transactions.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const totalIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    if (totalIncome <= 0) return false;

    // Check if ANY transaction in this category is impulsive
    const hasImpulsiveTransaction = monthTx.some(t => 
        t.type === 'expense' && 
        t.expenseType === 'variable' && 
        t.category === category &&
        isImpulsiveExpense(t) // Reuse the per-transaction check
    );

    return hasImpulsiveTransaction;
}

  function analyzeImpulsiveSpending() {
    const container = $('#impulsive-analysis');
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthTx = state.transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const totalIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);

    if (totalIncome === 0) {
      container.innerHTML = '<p class="empty-state">Add income transactions to enable impulsive spending analysis</p>';
      return;
    }

    const analyses = IMPULSIVE_CATEGORIES.map(cat => {
      const catTotal = monthTx
        .filter(t => t.type === 'expense' && t.category === cat)
        .reduce((s, t) => s + t.amount, 0);
      const pct = (catTotal / totalIncome) * 100;
      const info = CATEGORIES[cat];
      let level, levelClass, pctClass;

      if (pct <= state.settings.impulsiveThreshold * 0.5) {
        level = 'Safe'; levelClass = 'safe'; pctClass = 'ok';
      } else if (pct <= state.settings.impulsiveThreshold) {
        level = 'Moderate'; levelClass = 'warning'; pctClass = 'warn';
      } else {
        level = 'Impulsive!'; levelClass = ''; pctClass = 'danger';
      }

      return { cat, info, total: catTotal, pct, level, levelClass, pctClass };
    });

    // Also check other categories for high spending
    const otherExpenseCats = [...new Set(monthTx.filter(t => t.type === 'expense' && !IMPULSIVE_CATEGORIES.includes(t.category)).map(t => t.category))];
    otherExpenseCats.forEach(cat => {
      const catTotal = monthTx
        .filter(t => t.type === 'expense' && t.category === cat)
        .reduce((s, t) => s + t.amount, 0);
      const pct = (catTotal / totalIncome) * 100;
      if (pct > 30) {
        const info = CATEGORIES[cat] || CATEGORIES.other;
        analyses.push({ cat, info, total: catTotal, pct, level: 'High Spend', levelClass: 'warning', pctClass: 'warn' });
      }
    });

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

    // Close panel on outside click
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
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Clear old notifications from this month
    state.notifications = state.notifications.filter(n => {
      const d = new Date(n.timestamp);
      return d.getMonth() !== currentMonth || d.getFullYear() !== currentYear || n.persistent;
    });

    // Survival score alert
    if (score <= threshold) {
      addNotification({
        type: 'danger',
        text: `Your survival score is ${score}% — below your ${threshold}% threshold. Review your spending immediately!`,
        timestamp: new Date().toISOString(),
      });
    }

    // Impulsive spending alerts
    const monthTx = state.transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const totalIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);

    if (totalIncome > 0) {
      IMPULSIVE_CATEGORIES.forEach(cat => {
        const catTotal = monthTx
          .filter(t => t.type === 'expense' && t.category === cat)
          .reduce((s, t) => s + t.amount, 0);
        const pct = (catTotal / totalIncome) * 100;

        if (pct > state.settings.impulsiveThreshold) {
          const info = CATEGORIES[cat];
          addNotification({
            type: 'warning',
            text: `${info.emoji} ${info.label} spending is at ${pct.toFixed(1)}% of income — exceeding your ${state.settings.impulsiveThreshold}% impulsive threshold.`,
            timestamp: new Date().toISOString(),
          });
        }
      });
    }

    // Negative balance
    const balance = totalIncome - monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    if (balance < 0) {
      addNotification({
        type: 'danger',
        text: `Your balance is negative (${formatCurrency(balance)}). You're spending more than you earn this month!`,
        timestamp: new Date().toISOString(),
      });
    }

    saveToStorage();
    renderNotifications();
    updateNotifBadge();
  }

  function addNotification(notif) {
    // Avoid duplicates
    const exists = state.notifications.some(n => n.text === notif.text);
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

    // Apply saved theme
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

// ===== Category Filtering by Transaction Type =====
function setupCategoryFiltering() {
     const qaType = $('#qa-type');
     const qaExpenseType = $('#qa-expense-type');
     const qaCategory = $('#qa-category');

function updateQaCategories() {
       const type = qaType.value;
       const expenseType = qaExpenseType ? qaExpenseType.value : 'variable';
       qaCategory.innerHTML = '';
       Object.entries(CATEGORIES).forEach(([key, cat]) => {
         // For income transactions, show income and both types
         // For expense transactions, show based on expenseSubtype (variable or fixed)
         if (type === 'income') {
           if (cat.type === 'income' || cat.type === 'both') {
             const opt = document.createElement('option');
             opt.value = key;
             opt.textContent = cat.emoji + ' ' + cat.label;
             qaCategory.appendChild(opt);
           }
         } else if (type === 'expense') {
           if (cat.expenseSubtype && cat.expenseSubtype.includes(expenseType)) {
             const opt = document.createElement('option');
             opt.value = key;
             opt.textContent = cat.emoji + ' ' + cat.label;
             qaCategory.appendChild(opt);
           }
         } else {
           // Fallback for other types
           if (cat.type === type || cat.type === 'both') {
             const opt = document.createElement('option');
             opt.value = key;
             opt.textContent = cat.emoji + ' ' + cat.label;
             qaCategory.appendChild(opt);
           }
         }
       });
     }

function updateQaCategoriesByExpenseType(txType, expenseType) {
       qaCategory.innerHTML = '';
       Object.entries(CATEGORIES).forEach(([key, cat]) => {
         if (txType === 'income') {
           if (cat.type === 'income' || cat.type === 'both') {
             const opt = document.createElement('option');
             opt.value = key;
             opt.textContent = cat.emoji + ' ' + cat.label;
             qaCategory.appendChild(opt);
           }
         } else if (txType === 'expense') {
           if (cat.expenseSubtype && cat.expenseSubtype.includes(expenseType)) {
             const opt = document.createElement('option');
             opt.value = key;
             opt.textContent = cat.emoji + ' ' + cat.label;
             qaCategory.appendChild(opt);
           }
         }
       });
     }

     qaType.addEventListener('change', updateQaCategories);
     if (qaExpenseType) {
       qaExpenseType.addEventListener('change', updateQaCategories);
     }
     updateQaCategories();

// Modal form
     const txCategory = $('#tx-category');
     const txExpenseType = $('#tx-expense-type');

function updateTxCategories() {
       const type = $('#tx-type').value;
       const expenseType = txExpenseType ? txExpenseType.value : 'variable';
       txCategory.innerHTML = '';
       Object.entries(CATEGORIES).forEach(([key, cat]) => {
         // For income transactions, show income and both types
         // For expense transactions, show based on expenseSubtype (variable or fixed)
         if (type === 'income') {
           if (cat.type === 'income' || cat.type === 'both') {
             const opt = document.createElement('option');
             opt.value = key;
             opt.textContent = cat.emoji + ' ' + cat.label;
             txCategory.appendChild(opt);
           }
         } else if (type === 'expense') {
           if (cat.expenseSubtype && cat.expenseSubtype.includes(expenseType)) {
             const opt = document.createElement('option');
             opt.value = key;
             opt.textContent = cat.emoji + ' ' + cat.label;
             txCategory.appendChild(opt);
           }
         } else {
           // Fallback for other types
           if (cat.type === type || cat.type === 'both') {
             const opt = document.createElement('option');
             opt.value = key;
             opt.textContent = cat.emoji + ' ' + cat.label;
             txCategory.appendChild(opt);
           }
         }
       });
     }

// Listen for toggle changes in modal
     $$('#transaction-form .toggle-group').forEach(group => {
       const toggles = group.querySelectorAll('.toggle');
       toggles.forEach(t => {
         t.addEventListener('click', () => {
           if (t.dataset.value) {
             setTimeout(updateTxCategories, 0);
           }
           if (t.dataset.expense) {
             setTimeout(updateTxCategories, 0);
           }
         });
       });
    });

    updateTxCategories();
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
    // Interpolate from red (0) through yellow (50) to green (100)
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
