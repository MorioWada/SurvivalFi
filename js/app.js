// ===== SurvivalFi — Component Loader =====
// Loads modular HTML components into the DOM, then boots the main app.

(function () {
  'use strict';

  var COMPONENTS = {
    'auth':          'components/auth.html',
    'sidebar':       'components/sidebar.html',
    'dashboard':     'components/dashboard.html',
    'transactions':  'components/transactions.html',
    'survival':      'components/survival.html',
    'settings':      'components/settings.html',
    'modal':         'components/modal.html',
  };

  function loadComponent(name, targetSelector) {
    return fetch(COMPONENTS[name])
      .then(function (res) { return res.text(); })
      .then(function (html) {
        var target = document.querySelector(targetSelector);
        if (target) {
          target.innerHTML = html;
        } else {
          console.warn('Component slot not found: ' + targetSelector);
        }
      })
      .catch(function (err) {
        console.error('Failed to load component "' + name + '":', err);
      });
  }

  function boot() {
    // Load all components in parallel, then start the app
    Promise.all([
      loadComponent('auth',         '#slot-auth'),
      loadComponent('sidebar',      '#slot-sidebar'),
      loadComponent('dashboard',    '#slot-dashboard'),
      loadComponent('transactions', '#slot-transactions'),
      loadComponent('survival',     '#slot-survival'),
      loadComponent('settings',     '#slot-settings'),
      loadComponent('modal',        '#slot-modal'),
    ]).then(function () {
      // All components are in the DOM — now load the main application logic
      var s = document.createElement('script');
      s.src = 'js/script.js';
      document.body.appendChild(s);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
