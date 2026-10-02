/**
 * PayRam console UI gate for Monno.
 *
 * Loaded into every dashboard page by the nginx sub_filter in
 * scripts/patch-nginx.mjs. The operator keeps the full console; an organizer
 * (who only ever comes here to register a payout wallet) is shown the
 * essentials instead of the whole merchant surface.
 *
 * Why this exists: the vendor already filters nav items by permission, but the
 * roles are fixed and the organizer genuinely needs `write_wallet`, so the only
 * role that fits also carries growth/onramp/developer items. There is no
 * narrower role to assign, and no API to create one.
 *
 * Keep this list small and obvious — it is the only place the console is
 * reshaped, and it must stay easy to reason about.
 */
(function () {
  var HIDE_FOR_ORGANIZERS = [
    'Operator',              // operator-only section (belt and braces)
    'Fees',
    'Onramp',
    'Growth',
    'Funds Consolidation',
    'Developers',
    'Analytics'
  ];

  var STYLE_ID = 'monno-nav-gate';

  function roleName() {
    try {
      var user = JSON.parse(localStorage.getItem('payram_user') || '{}');
      return (user && user.role && user.role.name) || null;
    } catch (e) {
      return null;
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '[data-monno-hidden]{display:none !important;}';
    document.head.appendChild(style);
  }

  function suppressPermissionToast() {
    var role = roleName();
    if (!role || role === 'root' || role === 'admin') return;

    var toasts = document.querySelectorAll('[role="status"], [role="alert"], [aria-live]');
    for (var i = 0; i < toasts.length; i++) {
      var el = toasts[i];
      if (el.textContent && el.textContent.indexOf('permission for some request') !== -1) {
        var container = el.closest('[role="status"]') || el.closest('[role="alert"]') || el;
        if (container.parentElement && container.parentElement.style && container.parentElement.style.position === 'fixed') {
          container.parentElement.style.display = 'none';
        } else {
          container.style.display = 'none';
        }
      }
    }
  }

  function apply() {
    var role = roleName();

    // No session yet, or an operator/admin: leave the console alone.
    if (!role || role === 'root' || role === 'admin') return;

    ensureStyle();
    suppressPermissionToast();

    var nav = document.querySelector('nav') || document.querySelector('aside');
    if (!nav) return;

    var wanted = {};
    HIDE_FOR_ORGANIZERS.forEach(function (label) { wanted[label.toLowerCase()] = true; });

    // Match only leaf-ish nodes so we never hide a container that also holds a
    // wanted item.
    var candidates = nav.querySelectorAll('a, button, [role="button"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.hasAttribute('data-monno-hidden')) continue;

      var text = (el.textContent || '').trim();
      if (!text || !wanted[text.toLowerCase()]) continue;

      // If any descendant links somewhere else, this is a container (e.g. a
      // collapsible group) — skip it rather than hiding its children.
      var nested = el.querySelector('a, button, [role="button"]');
      if (nested) continue;

      el.setAttribute('data-monno-hidden', '1');
    }
  }

  function injectOnboardingGuide() {
    // Only show on wallet setup pages
    var path = location.pathname;
    if (path.indexOf('/manageWallet') === -1) return;
    if (document.getElementById('monno-onboarding-guide')) return;

    var GUIDE_STYLE = [
      '#monno-onboarding-guide {',
      '  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;',
      '  background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%);',
      '  color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
      '  padding: 12px 20px; display: flex; align-items: flex-start; gap: 14px;',
      '  box-shadow: 0 4px 16px rgba(0,0,0,0.25);',
      '}',
      '#monno-onboarding-guide .monno-guide-icon { font-size: 20px; flex-shrink: 0; margin-top: 2px; }',
      '#monno-onboarding-guide .monno-guide-body { flex: 1; }',
      '#monno-onboarding-guide .monno-guide-title { font-size: 13px; font-weight: 700; margin: 0 0 4px; }',
      '#monno-onboarding-guide .monno-guide-steps { font-size: 12px; margin: 0; padding-left: 16px; opacity: 0.92; line-height: 1.6; }',
      '#monno-onboarding-guide .monno-guide-note { font-size: 11px; margin: 6px 0 0; opacity: 0.75; }',
      '#monno-onboarding-guide .monno-guide-close {',
      '  flex-shrink: 0; background: rgba(255,255,255,0.15); border: none; color: #fff;',
      '  cursor: pointer; border-radius: 6px; padding: 4px 10px; font-size: 12px; margin-top: 1px;',
      '}',
      '#monno-onboarding-guide .monno-guide-close:hover { background: rgba(255,255,255,0.25); }',
    ].join('\n');

    var styleEl = document.createElement('style');
    styleEl.textContent = GUIDE_STYLE;
    document.head.appendChild(styleEl);

    var guide = document.createElement('div');
    guide.id = 'monno-onboarding-guide';
    guide.innerHTML = [
      '<div class="monno-guide-icon">👋</div>',
      '<div class="monno-guide-body">',
      '  <p class="monno-guide-title">Complete your crypto payment setup — 3 quick steps</p>',
      '  <ol class="monno-guide-steps">',
      '    <li><strong>Connect your master wallet</strong> (MetaMask or WalletConnect) using the button on this page</li>',
      '    <li><strong>Click "EVM — Smart Contract"</strong>, then <strong>"Create wallet"</strong> to deploy your on-chain deposit contract</li>',
      '    <li>Go to <a href="/manageWallet/wallets/cold" style="color:#c4b5fd;font-weight:600">Wallet management → Cold Wallet</a> and add your <strong>payout wallet address</strong> so funds sweep to you automatically</li>',
      '  </ol>',
      '  <p class="monno-guide-note">💡 You only do this once. After setup, Monno automatically routes all ticket sale crypto into your wallet.</p>',
      '</div>',
      '<button class="monno-guide-close" onclick="document.getElementById(\'monno-onboarding-guide\').remove()">Got it</button>',
    ].join('');

    document.body.insertBefore(guide, document.body.firstChild);

    // Push page content down so the banner doesn't overlap
    document.body.style.marginTop = (guide.offsetHeight + 8) + 'px';
  }

  function boot() {
    apply();
    injectOnboardingGuide();
    var observer = new MutationObserver(function () {
      apply();
      // Re-check guide on route changes (SPA navigation updates pathname)
      injectOnboardingGuide();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Route changes still re-render the sidebar; the observer covers it, but a
    // couple of delayed passes make the first paint deterministic.
    setTimeout(apply, 300);
    setTimeout(apply, 1500);
    setTimeout(injectOnboardingGuide, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
