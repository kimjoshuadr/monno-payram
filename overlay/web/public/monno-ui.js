/**
 * PayRam console UI for Monno.
 *
 * Loaded into every dashboard page by the nginx sub_filter in
 * scripts/patch-nginx.mjs. It has two jobs:
 *
 *   1. Keep the organizer to the surface that is theirs. The vendor already
 *      filters nav by permission, but the roles are fixed and the only role that
 *      fits the organizer's job carries operator-only items (fees, growth,
 *      onramp, developer settings, hot wallets). Those pages 403 in the
 *      background and lead nowhere, so we hide the rows rather than let the
 *      organizer wander into them.
 *   2. Show a single header banner while their deposit wallet still needs
 *      setting up, then get out of the way.
 *
 * Why the banner reads the gateway, not the page: the old stepper counted its
 * own localStorage ticks and guessed progress from the DOM, so navigating
 * between tabs reset it to "0 of 1" and it could claim setup was missing when it
 * was done. The gateway is the only thing that actually knows whether a deposit
 * wallet with a payout address exists, so the banner asks it.
 *
 * The banner keys on ROUTES, never on the vendor's button or heading copy —
 * labels move between releases, routes are the stable contract.
 */
(function () {
  // The console shows organizers items their role cannot actually use. Hiding
  // them is the vendor's own permission model applied one level up.
  //
  // Entries render as class-styled <li>/<div> rows, so match on the label text
  // of a clickable-looking row rather than on a tag name.
  var HIDE_NAV = [
    'Operator',
    'Fees',
    'Onramp',
    'Growth',
    'Funds Consolidation',
    'Developers',
    'Analytics',
    'Withdraw',
    'Projects'
  ];

  // Actions on ordinary pages that are not the organizer's to take. Matched
  // against the text of clickable elements; kept narrow so nothing they need
  // (deposit wallet + hot wallet setup) is caught.
  var HIDE_ACTIONS = [
    'Assign projects to accept payments',
    'Create Project',
    'Create a project',
    'New Project',
    'Add project'
  ];

  var STYLE_ID = 'monno-ui-style';
  var BANNER_ID = 'monno-setup-banner';
  var BANNER_DISMISS_KEY = 'monno_setup_banner_dismissed';

  // A version marker so a stale copy is never mistaken for a broken fix: the
  // overlay is served from a fixed URL with no cache-busting, and a long-lived
  // tab will happily keep running an old one.
  var MONNO_UI_VERSION = '2026-10-04.3';
  try { window.__monnoUiVersion = MONNO_UI_VERSION; } catch (e) {}

  var ORGANIZER_KEY = 'monno_setup_organizer';
  var DEPOSIT_WALLET_PATH = '/manageWallet/deposit-wallet';
  var HOT_WALLET_PATH = '/manageWallet/hot-wallet';

  /* ------------------------------------------------------------------ *
   * Who is this?
   * ------------------------------------------------------------------ */

  function roleName() {
    try {
      var user = JSON.parse(localStorage.getItem('payram_user') || '{}') || {};
      var role = user.role;
      if (!role) return null;
      return typeof role === 'string' ? role : (role.name || null);
    } catch (e) {
      return null;
    }
  }

  function hasSession() {
    try { return !!localStorage.getItem('payram_user'); } catch (e) { return false; }
  }

  function monnoMinted() {
    try { return localStorage.getItem(ORGANIZER_KEY) === '1'; } catch (e) { return false; }
  }

  function isOrganizer() {
    var role = roleName();
    if (role === 'root' || role === 'admin') return false;
    if (monnoMinted()) return true;
    return !!role;
  }

  function isBuyerArea() {
    var path = location.pathname;
    return path.indexOf('/payments') === 0 || path.indexOf('/payment/') === 0;
  }

  /* ------------------------------------------------------------------ *
   * Nav / action hiding
   * ------------------------------------------------------------------ */

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '[data-monno-hidden]{display:none !important;}' +
      '#' + BANNER_ID + '{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:12px;' +
      'padding:11px 16px;background:#4f46e5;color:#fff;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
      'font-size:13px;line-height:1.4;}' +
      '#' + BANNER_ID + ' .monno-banner-msg{flex:1;}' +
      '#' + BANNER_ID + ' a.monno-banner-link{color:#fff;font-weight:700;text-decoration:underline;white-space:nowrap;}' +
      '#' + BANNER_ID + ' button.monno-banner-hide{background:transparent;border:1px solid rgba(255,255,255,.55);' +
      'color:#fff;border-radius:99px;padding:3px 10px;font-size:12px;cursor:pointer;white-space:nowrap;}' +
      '#' + BANNER_ID + ' button.monno-banner-hide:hover{border-color:#fff;}';
    document.head.appendChild(style);
  }

  function hideNav() {
    var nav = document.querySelector('nav') || document.querySelector('aside');
    if (!nav) return;

    var wanted = {};
    HIDE_NAV.forEach(function (label) { wanted[label.toLowerCase()] = true; });

    var candidates = document.querySelectorAll('li, a, button, [role="button"], [role="menuitem"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!nav.contains(el)) continue;
      if (el.hasAttribute('data-monno-hidden')) continue;

      var text = (el.textContent || '').trim();
      if (!text || !wanted[text.toLowerCase()]) continue;

      // If any descendant links somewhere else, this is a container (e.g. a
      // collapsible group) — skip it rather than hiding its children.
      if (el.querySelector('a, button, [role="button"]')) continue;

      el.setAttribute('data-monno-hidden', '1');
    }
  }

  function hideActions() {
    var candidates = document.querySelectorAll('a, button, [role="button"], [data-testid]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.hasAttribute('data-monno-hidden')) continue;
      if (el.closest('#' + BANNER_ID)) continue;

      var text = (el.textContent || '').trim();
      if (!text) continue;

      for (var j = 0; j < HIDE_ACTIONS.length; j++) {
        if (text.indexOf(HIDE_ACTIONS[j]) !== -1) {
          el.setAttribute('data-monno-hidden', '1');
          break;
        }
      }
    }
  }

  // The console shows a red "You don't have permission for some request" toast
  // whenever a background call 403s — routine for an organizer's session, and
  // noise about a request they never made.
  function isPermissionToast(el) {
    var text = (el.textContent || '');
    return text.indexOf('permission for some request') !== -1
      || text.indexOf('not authorized') !== -1;
  }

  function suppressPermissionToast() {
    var stacks = document.querySelectorAll('.Toastify__toast-container, .Toastify__toast, .Toastify');
    for (var i = 0; i < stacks.length; i++) {
      if (isPermissionToast(stacks[i])) stacks[i].style.display = 'none';
    }
    var toasts = document.querySelectorAll('[role="status"], [role="alert"], [aria-live]');
    for (var j = 0; j < toasts.length; j++) {
      var el = toasts[j];
      if (!isPermissionToast(el)) continue;
      var container = el.closest('[role="status"]') || el.closest('[role="alert"]') || el;
      container.style.display = 'none';
    }
  }

  /* ------------------------------------------------------------------ *
   * Setup state — ask the gateway, never the DOM
   * ------------------------------------------------------------------ */

  function accessToken() {
    try { return localStorage.getItem('payram_access_token'); } catch (e) { return null; }
  }

  function apiGet(path) {
    var token = accessToken();
    if (!token) return Promise.reject(new Error('no token'));
    return fetch(location.origin + path, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    }).then(function (response) {
      if (!response.ok) throw new Error('http ' + response.status);
      return response.json();
    });
  }

  function listOf(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.data)) return body.data;
    return [];
  }

  // A project can accept payments once it has a deposit wallet whose sweep
  // destination (the payout/cold wallet) is set, and it can *sweep* once it also
  // has a hot wallet to pay gas. Setup is done when both hold — the same facts
  // Monno reports as "ready", read from the same place.
  function hasConfiguredDepositWallet(wallets) {
    return listOf(wallets).some(function (wallet) {
      if (!wallet || wallet.walletType !== 'deposit_wallet') return false;
      var scws = wallet.walletScws || [];
      return scws.some(function (scw) {
        return scw && String(scw.fundCollectorAddress || '').trim() !== '';
      });
    });
  }

  function hasHotWallet(wallets) {
    // A hot wallet that is attached but inactive looks configured in the console
    // while paying no gas, so nothing sweeps. Only an active one counts.
    return listOf(wallets).some(function (wallet) {
      return wallet && wallet.walletType === 'hot_wallet' && wallet.status === 'active';
    });
  }

  var stateCache = null;      // {known, depositConfigured, hotWallet, ready}
  var stateFetchedAt = 0;
  var STATE_TTL_MS = 30000;

  // The console keeps the project being viewed in the URL (/project/{id}/...).
  // An account can own several projects, so "the first one" is NOT necessarily
  // the one on screen: reading the wrong project nags about a wallet that
  // belongs to a different project.
  function currentProjectId() {
    var match = location.pathname.match(/\/project\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  function fetchSetupState() {
    return apiGet('/api/v1/external-platform/all').then(function (projects) {
      var all = listOf(projects);
      var wanted = currentProjectId();
      var project = null;

      if (wanted) {
        for (var i = 0; i < all.length; i++) {
          if (all[i] && String(all[i].id) === wanted) { project = all[i]; break; }
        }
      }

      // Off a project page (dashboard, payments, ...) the project is ambiguous
      // when the account owns more than one. Fall back to the only project when
      // there is exactly one; otherwise say nothing rather than nag wrongly.
      if (!project && !wanted) {
        project = all.length === 1 ? all[0] : null;
      }

      if (!project || !project.id) return { known: false };

      return apiGet('/api/v1/project/' + project.id + '/wallets').then(function (wallets) {
        var deposit = hasConfiguredDepositWallet(wallets);
        var hot = hasHotWallet(wallets);
        return {
          known: true,
          projectId: project.id,
          depositConfigured: deposit,
          hotWallet: hot,
          ready: deposit && hot,
        };
      });
    }).catch(function () {
      // Unreachable or expired session: say nothing rather than nag wrongly.
      return { known: false };
    });
  }

  function getSetupState() {
    // Key the cache by project: switching projects must not serve the previous
    // project's answer for the next 30 seconds.
    var key = currentProjectId() || 'none';
    var now = Date.now();

    if (stateCache && stateCache.key === key && (now - stateFetchedAt) < STATE_TTL_MS) {
      return Promise.resolve(stateCache.state);
    }

    return fetchSetupState().then(function (state) {
      stateCache = {key: key, state: state};
      stateFetchedAt = Date.now();
      return state;
    });
  }

  /* ------------------------------------------------------------------ *
   * Banner
   * ------------------------------------------------------------------ */

  function bannerDismissed() {
    try { return sessionStorage.getItem(BANNER_DISMISS_KEY) === '1'; } catch (e) { return false; }
  }

  function removeBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el) el.remove();
  }

  function bannerMessage(state) {
    if (!state.depositConfigured && !state.hotWallet) {
      return 'Finish crypto setup \u2014 set up your deposit wallet and a hot wallet so payments can settle.';
    }
    if (state.depositConfigured && !state.hotWallet) {
      return 'Almost there \u2014 add or activate a gas-funded hot wallet so your sales can sweep to your payout wallet.';
    }
    return 'Finish crypto setup \u2014 set up your deposit wallet so payments can settle.';
  }

  function ensureBanner(state) {
    var el = document.getElementById(BANNER_ID);

    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      el.setAttribute('role', 'status');
      el.addEventListener('click', function (event) {
        if (event.target.closest('[data-monno="dismiss"]')) {
          try { sessionStorage.setItem(BANNER_DISMISS_KEY, '1'); } catch (e) {}
          removeBanner();
        }
      });
      // In normal flow at the very top of the page, so the console just shifts
      // down a little instead of being overlapped.
      document.body.insertBefore(el, document.body.firstChild);
    }

    el.innerHTML =
      '<span class="monno-banner-msg">' + bannerMessage(state) + '</span>' +
      (!state.depositConfigured
        ? '<a class="monno-banner-link" href="' + DEPOSIT_WALLET_PATH + '">Set up deposit wallet</a>'
        : '') +
      (!state.hotWallet
        ? '<a class="monno-banner-link" href="' + HOT_WALLET_PATH + '">Set up hot wallet</a>'
        : '') +
      '<button type="button" class="monno-banner-hide" data-monno="dismiss">Dismiss</button>';

    return el;
  }

  function updateBanner() {
    if (isBuyerArea() || !hasSession() || !isOrganizer() || bannerDismissed()) {
      removeBanner();
      return;
    }

    getSetupState().then(function (state) {
      if (isBuyerArea() || bannerDismissed()) { removeBanner(); return; }
      if (!state.known) { removeBanner(); return; }   // fail-safe: don't nag
      if (state.ready) { removeBanner(); return; }
      ensureBanner(state);
    });
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  function apply() {
    if (!hasSession() || !isOrganizer()) return;
    ensureStyle();
    suppressPermissionToast();
    hideNav();
    hideActions();
  }

  function boot() {
    apply();
    updateBanner();

    // Vendors re-render on client-side navigation, so re-check.
    if (!window.__monnoObserver) {
      var scheduled = false;
      var observer = new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
          scheduled = false;
          apply();
          updateBanner();
        });
      });
      observer.observe(document.body || document.documentElement, {childList: true, subtree: true});
      window.__monnoObserver = observer;
    }

    // A couple of delayed passes make the first paint deterministic.
    setTimeout(function () { apply(); updateBanner(); }, 300);
    setTimeout(function () { apply(); updateBanner(); }, 1500);

    // The observer only sees childList changes; a light poll covers attribute
    // toggles without observing attributes across a page that isn't ours.
    if (!window.__monnoPoll) {
      window.__monnoPoll = true;
      setInterval(function () { apply(); updateBanner(); }, 2000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
