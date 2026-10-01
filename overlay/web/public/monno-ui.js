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

  function apply() {
    var role = roleName();

    // No session yet, or an operator/admin: leave the console alone.
    if (!role || role === 'root' || role === 'admin') return;

    ensureStyle();

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

  function boot() {
    apply();
    var observer = new MutationObserver(function () { apply(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Route changes still re-render the sidebar; the observer covers it, but a
    // couple of delayed passes make the first paint deterministic.
    setTimeout(apply, 300);
    setTimeout(apply, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
