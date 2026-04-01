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
      monthlyBudget: 0,
    },
    isRegistering: false,
  };

  // ===== Category Config =====
  const CATEGORIES = {
    food:            { emoji: '🍜', label: 'Food',            color: '#f59e0b', type: 'expense' },
    transportation:  { emoji: '🚗', label: 'Transportation',  color: '#3b82f6', type: 'expense' },
    housing:         { emoji: '🏠', label: 'Housing',          color: '#8b5cf6', type: 'expense' },
    utilities:       { emoji: '💡', label: 'Utilities',        color: '#eab308', type: 'expense' },
    entertainment:   { emoji: '🎬', label: 'Entertainment',    color: '#ec4899', type: 'expense' },
    healthcare:      { emoji: '🏥', label: 'Healthcare',       color: '#ef4444', type: 'expense' },
    shopping:        { emoji: '🛍️', label: 'Shopping',         color: '#14b8a6', type: 'expense' },
    education:       { emoji: '📚', label: 'Education',        color: '#6366f1', type: 'expense' },
    salary:          { emoji: '💼', label: 'Salary',           color: '#22c55e', type: 'income' },
    freelance:       { emoji: '💻', label: 'Freelance',        color: '#06b6d4', type: 'income' },
    investment:      { emoji: '📈', label: 'Investment',       color: '#a855f7', type: 'income' },
    other:           { emoji: '📦', label: 'Other',            color: '#94a3b8', type: 'both' },
  };

  const IMPULSIVE_CATEGORIES = ['entertainment', 'shopping'];

  // ===== DOM References =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ===== Initialization =====
  function init() {
    loadFromStorage();
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
  function loadFromStorage() {
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
  }

  function saveToStorage() {
    try {
      localStorage.setItem('survivalfi_data', JSON.stringify({
        user: state.user,
        transactions: state.transactions,
        notifications: state.notifications,
        settings: state.settings,
      }));
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
            showToast('Account created! Check your email for verification.', 'success');
          } else {
            result = await state.supabase.auth.signInWithPassword({ email, password });
            if (result.error) throw result.error;
            state.user = { email: result.data.user.email, id: result.data.user.id };
            await loadTransactionsFromSupabase();
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
    const expenseTypeGroup = $('#qa-expense-type');

    typeSelect.addEventListener('change', () => {
      const isIncome = typeSelect.value === 'income';
      expenseTypeGroup.closest('.form-group').style.display = isIncome ? 'none' : '';
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
      expenseTypeGroup.closest('.form-group').style.display = '';
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
          ${badges.length ? `<div class="tx-badges">${badges.join('')}</div>` : ''}
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

    const fixedExpenses = monthTx
      .filter(t => t.type === 'expense' && t.expenseType === 'fixed')
      .reduce((s, t) => s + t.amount, 0);

    const monthlyIncome = state.settings.monthlyIncome || totalIncome;
    const remainingFixed = estimateRemainingFixed(monthTx, daysRemaining, daysInMonth);

    // Score factors (0-100 each, weighted)
    let score = 50; // base

    // Factor 1: Balance ratio (how much balance vs income)
    if (monthlyIncome > 0) {
      const balanceRatio = Math.max(0, currentBalance) / monthlyIncome;
      score += balanceRatio * 20;
    }

    // Factor 2: Days remaining vs daily budget
    const dailyBudget = daysRemaining > 0 && currentBalance > 0 ? currentBalance / daysRemaining : 0;
    const avgDailySpend = dayOfMonth > 0 ? totalExpenses / dayOfMonth : 0;
    if (avgDailySpend > 0) {
      const dailyRatio = dailyBudget / avgDailySpend;
      score += Math.min(dailyRatio * 10, 15);
    } else if (currentBalance > 0) {
      score += 10;
    }

    // Factor 3: Fixed expenses coverage
    if (remainingFixed > 0 && currentBalance > 0) {
      const fixedCoverage = currentBalance / remainingFixed;
      score += Math.min(fixedCoverage * 10, 15);
    } else if (remainingFixed <= 0) {
      score += 10;
    }

    // Factor 4: Impulsive spending penalty
    const impulsiveTotal = monthTx
      .filter(t => t.type === 'expense' && IMPULSIVE_CATEGORIES.includes(t.category))
      .reduce((s, t) => s + t.amount, 0);
    const impulsiveRatio = monthlyIncome > 0 ? (impulsiveTotal / monthlyIncome) * 100 : 0;
    if (impulsiveRatio > state.settings.impulsiveThreshold) {
      score -= (impulsiveRatio - state.settings.impulsiveThreshold) * 1.5;
    }

    // Factor 5: Negative balance penalty
    if (currentBalance < 0) {
      score -= 25;
    }

    // Factor 6: Low balance warning
    if (currentBalance >= 0 && currentBalance < monthlyIncome * 0.1) {
      score -= 10;
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    // Update UI
    $('#stat-survival').textContent = score + '%';
    $('#stat-survival').className = 'stat-value ' + (score <= 20 ? 'danger' : score <= 50 ? 'warning' : 'safe');

    // Survival ring
    const circle = $('#survival-circle');
    const circumference = 534;
    const offset = circumference - (score / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = getSurvivalColor(score);
    $('#survival-number').textContent = score + '%';

    // Status text
    let status, statusClass;
    if (score >= 70) { status = 'Financially Healthy'; statusClass = 'safe'; }
    else if (score >= 50) { status = 'Moderate — Stay Cautious'; statusClass = ''; }
    else if (score >= 30) { status = 'At Risk — Tighten Budget'; statusClass = 'warning'; }
    else { status = 'Critical — Immediate Action Needed'; statusClass = 'danger'; }

    const statusEl = $('#survival-status');
    statusEl.textContent = status;
    statusEl.style.color = statusClass === 'safe' ? 'var(--green)' : statusClass === 'warning' ? 'var(--orange)' : statusClass === 'danger' ? 'var(--red)' : 'var(--text-primary)';

    // Factors
    $('#factor-days').textContent = daysRemaining + ' days';
    $('#factor-days-bar').style.width = ((daysRemaining / daysInMonth) * 100) + '%';

    $('#factor-daily').textContent = formatCurrency(dailyBudget) + '/day';
    const dailyPct = avgDailySpend > 0 ? Math.min((dailyBudget / avgDailySpend) * 50, 100) : (dailyBudget > 0 ? 80 : 0);
    $('#factor-daily-bar').style.width = dailyPct + '%';
    $('#factor-daily-bar').style.background = dailyPct > 60 ? 'var(--green)' : dailyPct > 30 ? 'var(--orange)' : 'var(--red)';

    $('#factor-fixed').textContent = remainingFixed > 0 ? formatCurrency(remainingFixed) + ' remaining' : 'Covered';
    const fixedPct = currentBalance > 0 && remainingFixed > 0 ? Math.min((currentBalance / remainingFixed) * 100, 100) : (remainingFixed <= 0 ? 100 : 0);
    $('#factor-fixed-bar').style.width = fixedPct + '%';
    $('#factor-fixed-bar').style.background = fixedPct > 60 ? 'var(--green)' : fixedPct > 30 ? 'var(--orange)' : 'var(--red)';

    $('#factor-impulsive').textContent = impulsiveRatio.toFixed(1) + '% of income';
    const impPct = Math.min(impulsiveRatio * 3, 100);
    $('#factor-impulsive-bar').style.width = impPct + '%';
    $('#factor-impulsive-bar').style.background = impulsiveRatio <= state.settings.impulsiveThreshold ? 'var(--green)' : impulsiveRatio <= state.settings.impulsiveThreshold * 2 ? 'var(--orange)' : 'var(--red)';

    return score;
  }

  function estimateRemainingFixed(monthTx, daysRemaining, daysInMonth) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Get fixed expense categories already spent this month
    const fixedThisMonth = monthTx
      .filter(t => t.type === 'expense' && t.expenseType === 'fixed')
      .reduce((s, t) => s + t.amount, 0);

    // Estimate: if we're at day 15 of 30 and spent $500 fixed, likely ~$1000 total fixed
    const dayOfMonth = now.getDate();
    if (dayOfMonth > 0 && fixedThisMonth > 0) {
      const estimatedTotalFixed = (fixedThisMonth / dayOfMonth) * daysInMonth;
      return Math.max(0, estimatedTotalFixed - fixedThisMonth);
    }
    return 0;
  }

  // ===== Impulsive Detection =====
  function isImpulsiveExpense(tx) {
    if (tx.type !== 'expense') return false;
    if (!IMPULSIVE_CATEGORIES.includes(tx.category)) return false;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthTx = state.transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const totalIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    if (totalIncome <= 0) return false;

    const categoryTotal = monthTx
      .filter(t => t.type === 'expense' && t.category === tx.category)
      .reduce((s, t) => s + t.amount, 0);

    return (categoryTotal / totalIncome) * 100 > state.settings.impulsiveThreshold;
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
      state.notifications.unshift({ ...notif, id: 'n_' + Date.now() });
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
    const qaCategory = $('#qa-category');

    function updateQaCategories() {
      const type = qaType.value;
      qaCategory.innerHTML = '';
      Object.entries(CATEGORIES).forEach(([key, cat]) => {
        if (cat.type === type || cat.type === 'both') {
          const opt = document.createElement('option');
          opt.value = key;
          opt.textContent = cat.emoji + ' ' + cat.label;
          qaCategory.appendChild(opt);
        }
      });
    }

    qaType.addEventListener('change', updateQaCategories);
    updateQaCategories();

    // Modal form
    const txCategory = $('#tx-category');

    function updateTxCategories() {
      const type = $('#tx-type').value;
      txCategory.innerHTML = '';
      Object.entries(CATEGORIES).forEach(([key, cat]) => {
        if (cat.type === type || cat.type === 'both') {
          const opt = document.createElement('option');
          opt.value = key;
          opt.textContent = cat.emoji + ' ' + cat.label;
          txCategory.appendChild(opt);
        }
      });
    }

    // Listen for toggle changes in modal
    $$('#transaction-form .toggle-group').forEach(group => {
      const toggles = group.querySelectorAll('.toggle');
      toggles.forEach(t => {
        if (t.dataset.value) {
          t.addEventListener('click', () => {
            setTimeout(updateTxCategories, 0);
          });
        }
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

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
  init();
})();
