/**
 * PayRam console UI for Monno.
 *
 * Loaded into every dashboard page by the nginx sub_filter in
 * scripts/patch-nginx.mjs. It has two jobs:
 *
 *   1. Gate the nav — the operator keeps the full console; an organizer (who
 *      only ever comes here to register a payout wallet) is shown the
 *      essentials instead of the whole merchant surface.
 *   2. Guide the wallet setup — a small docked stepper on /manageWallet pages
 *      so the organizer knows the two things they must do, and can get back.
 *
 * Why the gate exists: the vendor already filters nav items by permission, but
 * the roles are fixed and the organizer genuinely needs `write_wallet`, so the
 * only role that fits also carries growth/onramp/developer items. There is no
 * narrower role to assign and no API to create one.
 *
 * The guide keys on ROUTES, never on the vendor's button or heading copy.
 * PayRam ships often; the routes are the stable contract (sso.html's `redirect`
 * already depends on /manageWallet/deposit-wallet), whereas labels move between
 * releases. Anything pinned to a label would silently rot.
 *
 * The guide also does not claim to know on-chain state. Whether a payout wallet
 * is really attached is Monno's to report (organizer settings); here we only
 * show position and the organizer's own ticks. Adding DOM-based "detection"
 * would guess wrong on a page we don't own.
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
  var GUIDE_ID = 'monno-setup-guide';
  var PILL_ID = 'monno-setup-pill';
  var STATE_KEY = 'monno_setup_guide';
  var COINS_KEY = 'monno_setup_coins';
  var BACK_KEY = 'monno_setup_back';

  var DEFAULT_BACK = 'https://app.monno.io';

  // Route -> step. These two paths are the whole setup; both are already part
  // of our contract with the vendor (sso.html redirects to the first).
  var STEPS = [
    {
      id: 'deposit',
      title: 'Create your deposit wallet',
      path: '/manageWallet/deposit-wallet',
      body: 'This is the on-chain account that receives each buyer\u2019s payment. Pick the option that matches the coins you enabled in Monno.',
      cta: 'Open deposit wallet'
    },
    {
      id: 'cold',
      title: 'Add your payout wallet',
      path: '/manageWallet/wallets/cold',
      body: 'Your sales sweep straight to this address on-chain. Add the cold wallet you control \u2014 Monno never holds your keys.',
      cta: 'Open payout wallet'
    }
  ];

  var CHAIN_LABELS = {
    evm: 'EVM smart-contract wallet \u2014 Ethereum, Base, Polygon',
    bitcoin: 'Bitcoin wallet \u2014 for BTC payouts',
    tron: 'Tron bridge \u2014 for USDT (TRC-20)'
  };

  var EVM_COINS = ['ETH', 'USDC', 'USDT', 'POL', 'BASE_ETH', 'BASE_USDC', 'MATIC'];
  var TRON_COINS = ['TRX', 'TRON_USDT', 'TRON', 'TRC20_USDT'];

  /* ------------------------------------------------------------------ *
   * Nav gate
   * ------------------------------------------------------------------ */

  function roleName() {
    try {
      var user = JSON.parse(localStorage.getItem('payram_user') || '{}');
      return (user && user.role && user.role.name) || null;
    } catch (e) {
      return null;
    }
  }

  // Everything here is for the organizer. The operator (and a signed-out
  // visitor) should see the console exactly as the vendor shipped it.
  function isOrganizer() {
    var role = roleName();
    return !!role && role !== 'root' && role !== 'admin';
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '[data-monno-hidden]{display:none !important;}';
    document.head.appendChild(style);
  }

  function suppressPermissionToast() {
    if (!isOrganizer()) return;

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
    // No session yet, or an operator/admin: leave the console alone.
    if (!isOrganizer()) return;

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

  /* ------------------------------------------------------------------ *
   * Setup guide
   * ------------------------------------------------------------------ */

  function readState() {
    try {
      var raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {};
      var done = raw.done || {};
      return {
        done: {deposit: !!done.deposit, cold: !!done.cold},
        // `null` until the organizer touches it, so the viewport picks the
        // default: docked open on desktop, collapsed to a pill on phones where
        // a full-width sheet would sit over the page's own "Set Up" button.
        open: typeof raw.open === 'boolean' ? raw.open : null
      };
    } catch (e) {
      return {done: {deposit: false, cold: false}, open: null};
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) { /* storage blocked — the guide simply won't remember */ }
  }

  function selectedChains() {
    var coins = [];
    try {
      coins = JSON.parse(localStorage.getItem(COINS_KEY) || '[]') || [];
    } catch (e) { coins = []; }

    // No selection recorded (older link, or the platform hasn't been deployed
    // yet): show every chain rather than guessing one.
    if (!coins.length) return ['evm', 'bitcoin', 'tron'];

    var picked = {evm: false, bitcoin: false, tron: false};
    coins.forEach(function (coin) {
      var code = String(coin).toUpperCase();
      if (EVM_COINS.indexOf(code) !== -1) picked.evm = true;
      else if (code === 'BTC') picked.bitcoin = true;
      else if (TRON_COINS.indexOf(code) !== -1) picked.tron = true;
    });

    var out = Object.keys(picked).filter(function (key) { return picked[key]; });
    return out.length ? out : ['evm'];
  }

  function backUrl() {
    var fallback = DEFAULT_BACK;
    try {
      var stored = localStorage.getItem(BACK_KEY);
      if (!stored) return fallback;
      var url = new URL(stored);
      var trusted = url.protocol === 'https:' &&
        (/(^|\.)monno\.io$/.test(url.hostname) || url.hostname === 'localhost');
      return trusted ? url.toString() : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function currentStepId() {
    var path = location.pathname;
    for (var i = 0; i < STEPS.length; i++) {
      if (path.indexOf(STEPS[i].path) !== -1) return STEPS[i].id;
    }
    return null;
  }

  function isWalletArea() {
    return location.pathname.indexOf('/manageWallet') !== -1;
  }

  // Only a dialog that is actually on screen should push the guide aside. The
  // console (and the wallet libraries it loads) can leave dialog nodes mounted
  // after they close — a hidden portal child, say — and matching on presence
  // alone would hide the guide for the rest of the session.
  function isVisible(el) {
    if (!el.getClientRects || el.getClientRects().length === 0) return false;
    var style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function dialogOpen() {
    var dialogs = document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], .adapter-modal-wrapper, [data-mantine-modal], .mantine-Modal-root'
    );
    for (var i = 0; i < dialogs.length; i++) {
      if (isVisible(dialogs[i])) return true;
    }
    return false;
  }

  function isSmallScreen() {
    // Matches the CSS breakpoint below. Below it a right-docked card crowds the
    // page (and a full sheet would cover the page's own "Set Up" button), so we
    // start collapsed to a pill instead.
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function isOpen(state) {
    return state.open === null ? !isSmallScreen() : state.open;
  }

  function guideCss() {
    return [
      '#' + GUIDE_ID + ', #' + PILL_ID + ' * { box-sizing: border-box; }',
      '#' + GUIDE_ID + ' {',
      '  position: fixed; z-index: 50; right: 20px; bottom: 20px; width: 340px;',
      '  max-width: calc(100vw - 32px); background: #fff; color: #1e293b;',
      '  border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden;',
      '  box-shadow: 0 12px 32px rgba(15,23,42,.18);',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
      '  font-size: 13px; line-height: 1.5; text-align: left;',
      '}',
      '#' + GUIDE_ID + '[hidden] { display: none !important; }',
      '#' + GUIDE_ID + ' .monno-guide-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #eef2f7; }',
      '#' + GUIDE_ID + ' .monno-guide-title { font-weight: 700; font-size: 13px; flex: 1; }',
      '#' + GUIDE_ID + ' .monno-guide-progress { font-size: 11px; font-weight: 600; color: #4f46e5; background: rgba(99,102,241,.1); padding: 2px 8px; border-radius: 99px; white-space: nowrap; }',
      '#' + GUIDE_ID + ' .monno-guide-steps { list-style: none; margin: 0; padding: 6px; }',
      '#' + GUIDE_ID + ' .monno-guide-steps > li { display: flex; gap: 10px; align-items: flex-start; padding: 8px; border-radius: 10px; }',
      '#' + GUIDE_ID + ' .monno-guide-steps > li.is-current { background: rgba(99,102,241,.07); }',
      '#' + GUIDE_ID + ' .monno-guide-check { flex: 0 0 auto; width: 22px; height: 22px; margin-top: 1px; border-radius: 50%; border: 2px solid #cbd5e1; background: #fff; color: transparent; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; }',
      '#' + GUIDE_ID + ' li.is-done .monno-guide-check { background: #10b981; border-color: #10b981; color: #fff; }',
      '#' + GUIDE_ID + ' li.is-current .monno-guide-check { border-color: #6366f1; }',
      '#' + GUIDE_ID + ' .monno-guide-step-title { font-weight: 600; color: #1e293b; text-decoration: none; }',
      '#' + GUIDE_ID + ' .monno-guide-step-title:hover { color: #4f46e5; }',
      '#' + GUIDE_ID + ' .monno-guide-step-body { margin: 2px 0 0; color: #64748b; font-size: 12px; }',
      '#' + GUIDE_ID + ' .monno-guide-chains { margin: 6px 0 0; padding: 0; list-style: none; }',
      '#' + GUIDE_ID + ' .monno-guide-chains li { font-size: 11.5px; color: #64748b; margin-top: 2px; }',
      '#' + GUIDE_ID + ' .monno-guide-chains li.is-pick { color: #4f46e5; font-weight: 600; }',
      '#' + GUIDE_ID + ' .monno-guide-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-top: 1px solid #eef2f7; background: #f8fafc; }',
      '#' + GUIDE_ID + ' .monno-guide-back { color: #4f46e5; font-weight: 600; text-decoration: none; font-size: 12px; }',
      '#' + GUIDE_ID + ' .monno-guide-back:hover { text-decoration: underline; }',
      '#' + GUIDE_ID + ' .monno-guide-hide { border: 0; background: transparent; color: #94a3b8; font-size: 12px; cursor: pointer; }',
      '#' + GUIDE_ID + ' .monno-guide-hide:hover { color: #475569; }',
      '#' + PILL_ID + ' { position: fixed; z-index: 50; right: 20px; bottom: 20px; background: #4f46e5; color: #fff; border: 0; border-radius: 99px; padding: 10px 16px; font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: 0 8px 20px rgba(79,70,229,.35); }',
      '#' + PILL_ID + '[hidden] { display: none !important; }',
      '@media (max-width: 900px) {',
      '  #' + GUIDE_ID + ' { right: 0; left: 0; bottom: 0; width: auto; max-width: none; border-radius: 14px 14px 0 0; padding-bottom: env(safe-area-inset-bottom); max-height: 74vh; display: flex; flex-direction: column; }',
      '  #' + GUIDE_ID + ' .monno-guide-steps { flex: 1 1 auto; overflow-y: auto; }',
      '  #' + GUIDE_ID + ' .monno-guide-check { width: 26px; height: 26px; }',
      '  #' + GUIDE_ID + ' .monno-guide-back, #' + GUIDE_ID + ' .monno-guide-hide { padding: 8px 4px; }',
      '  #' + PILL_ID + ' { right: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); }',
      '}'
    ].join('\n');
  }

  function chainsHtml() {
    var picked = selectedChains();
    var order = ['evm', 'bitcoin', 'tron'];
    return '<ul class="monno-guide-chains">' + order.map(function (key) {
      var isPick = picked.indexOf(key) !== -1;
      return '<li class="' + (isPick ? 'is-pick' : '') + '">' +
        (isPick ? '\u2022 ' : '\u00b7 ') + CHAIN_LABELS[key] +
        '</li>';
    }).join('') + '</ul>';
  }

  function stepsHtml() {
    return STEPS.map(function (step) {
      return [
        '<li data-monno-step="' + step.id + '">',
        '  <button type="button" class="monno-guide-check" data-monno="toggle"',
        '          data-step="' + step.id + '" aria-pressed="false"',
        '          aria-label="Mark &quot;' + step.title + '&quot; as done">\u2713</button>',
        '  <div>',
        '    <a class="monno-guide-step-title" href="' + step.path + '">' + step.title + '</a>',
        '    <p class="monno-guide-step-body">' + step.body + '</p>',
        (step.id === 'deposit' ? chainsHtml() : ''),
        '  </div>',
        '</li>'
      ].join('\n');
    }).join('\n');
  }

  function shellHtml() {
    return [
      '<div class="monno-guide-head">',
      '  <span class="monno-guide-title">Crypto setup</span>',
      '  <span class="monno-guide-progress" data-monno="progress">0 of 2 done</span>',
      '</div>',
      '<ol class="monno-guide-steps">',
      stepsHtml(),
      '</ol>',
      '<div class="monno-guide-foot">',
      '  <a class="monno-guide-back" data-monno="back" href="' + backUrl() + '">Back to Monno settings</a>',
      '  <button type="button" class="monno-guide-hide" data-monno="hide">Hide guide</button>',
      '</div>'
    ].join('\n');
  }

  function onGuideClick(event) {
    var target = event.target.closest('[data-monno]');
    if (!target) return;

    var action = target.getAttribute('data-monno');

    if (action === 'hide') {
      var hiddenState = readState();
      hiddenState.open = false;
      writeState(hiddenState);
      updateGuide();
      return;
    }

    if (action === 'toggle') {
      var stepId = target.getAttribute('data-step');
      if (stepId !== 'deposit' && stepId !== 'cold') return;
      var state = readState();
      state.done[stepId] = !state.done[stepId];
      writeState(state);
      updateGuide();
    }
  }

  function ensureGuide() {
    if (!document.getElementById(STYLE_ID + '-guide')) {
      var style = document.createElement('style');
      style.id = STYLE_ID + '-guide';
      style.textContent = guideCss();
      document.head.appendChild(style);
    }

    var guide = document.getElementById(GUIDE_ID);
    if (!guide) {
      guide = document.createElement('div');
      guide.id = GUIDE_ID;
      guide.setAttribute('role', 'complementary');
      guide.setAttribute('aria-label', 'Crypto payment setup guide');
      guide.innerHTML = shellHtml();
      guide.addEventListener('click', onGuideClick);
      document.body.appendChild(guide);
    }

    if (!document.getElementById(PILL_ID)) {
      var pill = document.createElement('button');
      pill.id = PILL_ID;
      pill.type = 'button';
      pill.textContent = 'Crypto setup';
      pill.addEventListener('click', function () {
        var state = readState();
        state.open = true;
        writeState(state);
        updateGuide();
      });
      document.body.appendChild(pill);
    }
  }

  function removeGuide() {
    var guide = document.getElementById(GUIDE_ID);
    if (guide) guide.remove();
    var pill = document.getElementById(PILL_ID);
    if (pill) pill.remove();
  }

  function updateGuide() {
    if (!isWalletArea() || !isOrganizer()) {
      removeGuide();
      return;
    }

    ensureGuide();

    var state = readState();
    var active = currentStepId();
    // Yield while a wallet-connect prompt or console modal is on screen — but
    // if the organizer has explicitly opened the guide, their choice wins.
    var suppressed = dialogOpen();
    var open = isOpen(state) && (!suppressed || state.open === true);
    var card = document.getElementById(GUIDE_ID);
    var pill = document.getElementById(PILL_ID);

    var doneCount = 0;
    STEPS.forEach(function (step) { if (state.done[step.id]) doneCount++; });

    card.hidden = !open;
    // The pill is the way back: keep it whenever the card isn't showing, so the
    // guide can never vanish silently behind a dialog.
    pill.hidden = open;
    pill.textContent = 'Crypto setup \u00b7 ' + doneCount + '/2';

    if (!open) return;

    STEPS.forEach(function (step) {
      var li = card.querySelector('[data-monno-step="' + step.id + '"]');
      if (!li) return;
      var isDone = state.done[step.id];
      li.classList.toggle('is-done', isDone);
      li.classList.toggle('is-current', step.id === active && !isDone);
      var check = li.querySelector('[data-monno="toggle"]');
      if (check) check.setAttribute('aria-pressed', isDone ? 'true' : 'false');
    });

    var progress = card.querySelector('[data-monno="progress"]');
    if (progress) progress.textContent = doneCount + ' of 2 done';

    var back = card.querySelector('[data-monno="back"]');
    if (back) back.setAttribute('href', backUrl());
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  function boot() {
    apply();
    updateGuide();

    // Vendors re-render on client-side navigation, so re-check. Throttled to a
    // frame: the guide is cheap, but this page isn't ours and the observer
    // fires on every DOM change the console makes.
    if (!window.__monnoObserver) {
      var scheduled = false;
      var observer = new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
          scheduled = false;
          apply();
          updateGuide();
        });
      });
      observer.observe(document.body || document.documentElement, {childList: true, subtree: true});
      window.__monnoObserver = observer;
    }

    // A couple of delayed passes make the first paint deterministic.
    setTimeout(function () { apply(); updateGuide(); }, 300);
    setTimeout(function () { apply(); updateGuide(); }, 1500);

    // The observer only sees childList changes, so a dialog hidden by toggling
    // its style or class would not wake us. A light poll covers that without
    // observing attributes across a page that isn't ours.
    if (!window.__monnoPoll) {
      window.__monnoPoll = true;
      setInterval(function () { apply(); updateGuide(); }, 2000);
    }

    // The default open/collapsed state depends on the viewport, so re-evaluate
    // when it changes (rotate, resize) unless the organizer has chosen already.
    if (!window.__monnoResize) {
      window.__monnoResize = true;
      window.addEventListener('resize', function () {
        if (readState().open === null) updateGuide();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
