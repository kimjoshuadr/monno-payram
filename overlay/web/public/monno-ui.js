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
  // The console shows organizers items their role cannot actually use: those
  // pages 403 in the background (which surfaces as a red "permission" toast) and
  // they lead nowhere. Hiding the rows is the vendor's own permission model
  // applied one level up, and it is why the guide bothers to gate the nav at all.
  //
  // Entries render as class-styled <li>/<div> rows, so match on the label text
  // of a clickable-looking row rather than on a tag name.
  var HIDE_FOR_ORGANIZERS = [
    'Operator',
    'Fees',
    'Onramp',
    'Growth',
    'Funds Consolidation',
    'Developers',
    'Analytics',
    'Withdraw'
  ];

  var STYLE_ID = 'monno-nav-gate';
  var GUIDE_ID = 'monno-setup-guide';
  var PILL_ID = 'monno-setup-pill';
  // A version marker so a stale copy is never mistaken for a broken fix: the
  // overlay is served from a fixed URL with no cache-busting, and a long-lived
  // tab will happily keep running an old one.
  var MONNO_UI_VERSION = '2026-10-03.1';
  try { window.__monnoUiVersion = MONNO_UI_VERSION; } catch (e) {}

  var STATE_KEY = 'monno_setup_guide';
  var COINS_KEY = 'monno_setup_coins';
  var BACK_KEY = 'monno_setup_back';
  var WALLET_KEY = 'monno_setup_wallet';
  var ORGANIZER_KEY = 'monno_setup_organizer';

  var DEFAULT_BACK = 'https://app.monno.io';

  // Route -> step. These two paths are the whole setup; both are already part
  // of our contract with the vendor (sso.html redirects to the first).
  //
  // `routeMatches` exists because the console spends the same URL on two
  // different states: before a wallet exists, /manageWallet/deposit-wallet is
  // the "Set Up Deposit Wallet" landing page; once a wallet exists it becomes
  // the wallet *list*. Step one is only current on the landing page — matching
  // the route alone told organizers to do something they had already done.
  var STEPS = [
    {
      id: 'deposit',
      title: 'Create your deposit wallet',
      path: '/manageWallet/deposit-wallet',
      body: 'This is the on-chain account that receives each buyer\u2019s payment. Pick the option that matches the coins you enabled in Monno.',
      doneHint: 'Done \u2014 this page is your deposit wallets list now.',
      routeMatches: function () {
        if (location.pathname.indexOf('/manageWallet/deposit-wallet') === -1) return false;
        // The vendor's create prompt is what makes this page the setup step.
        return /Set Up Deposit Wallet/i.test(document.body ? document.body.innerText : '');
      }
    },
    {
      id: 'cold',
      title: 'Add your payout wallet',
      path: '/manageWallet/wallets/cold',
      body: 'Your sales sweep straight to this address on-chain. Add the cold wallet you control \u2014 Monno never holds your keys.',
      doneHint: 'Set the cold wallet your sales sweep to. Confirm it under Wallet management.',
      routeMatches: function () {
        return location.pathname.indexOf('/manageWallet/wallets/cold') !== -1;
      }
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
      var user = JSON.parse(localStorage.getItem('payram_user') || '{}') || {};
      var role = user.role;
      if (!role) return null;
      // The console stores the role as an object; tolerate a plain string too,
      // so a shape change on their side doesn't hide the guide.
      return typeof role === 'string' ? role : (role.name || null);
    } catch (e) {
      return null;
    }
  }

  // Everything here is for the organizer. The operator (and a signed-out
  // visitor) should see the console exactly as the vendor shipped it.
  function hasSession() {
    try { return !!localStorage.getItem('payram_user'); } catch (e) { return false; }
  }

  // Monno minted this session from an organizer's SSO link, so we treat them as
  // the organizer even if the console reshapes `payram_user` while booting and
  // the role we read there goes missing. A real operator session always wins.
  function monnoMinted() {
    try { return localStorage.getItem(ORGANIZER_KEY) === '1'; } catch (e) { return false; }
  }

  function isOrganizer() {
    var role = roleName();
    if (role === 'root' || role === 'admin') return false;
    if (monnoMinted()) return true;
    return !!role;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '[data-monno-hidden]{display:none !important;}';
    document.head.appendChild(style);
  }

  // The console shows a red "You don't have permission for some request" toast
  // whenever any background call 403s. An organizer's session triggers these
  // routinely (operator-only endpoints load anyway), and the toast is noise
  // about a request they never made — not something they can act on.
  //
  // The toast library is Toastify: it renders a <section class="Toastify"> with
  // the message in a descendant, and it is not exposed via role=status, so
  // matching ARIA roles alone missed every one of them.
  function isPermissionToast(el) {
    var text = (el.textContent || '');
    return text.indexOf('permission for some request') !== -1
      || text.indexOf('not authorized') !== -1;
  }

  function suppressPermissionToast() {
    if (!isOrganizer()) return;

    // Toastify's container lives outside the app tree; hide the whole stack
    // rather than trying to hide individual toasts mid-animation.
    var stacks = document.querySelectorAll('.Toastify__toast-container, .Toastify__toast, .Toastify');
    for (var i = 0; i < stacks.length; i++) {
      if (isPermissionToast(stacks[i])) {
        stacks[i].style.display = 'none';
      }
    }

    // Fall back to the generic containers for any non-Toastify surface.
    var toasts = document.querySelectorAll('[role="status"], [role="alert"], [aria-live]');
    for (var j = 0; j < toasts.length; j++) {
      var el = toasts[j];
      if (!isPermissionToast(el)) continue;
      var container = el.closest('[role="status"]') || el.closest('[role="alert"]') || el;
      container.style.display = 'none';
    }
  }

  function apply() {
    // No session yet, or an operator/admin: leave the console alone.
    if (!hasSession() || !isOrganizer()) return;

    ensureStyle();
    suppressPermissionToast();

    var nav = document.querySelector('nav') || document.querySelector('aside');
    if (!nav) return;

    // The console renders nav entries as class-styled <li>/<div> rows, not as
    // links or buttons — matching only those found nothing and left every
    // operator item visible to organizers. Match the row itself instead: the
    // smallest element whose own text is exactly the label.
    var wanted = {};
    HIDE_FOR_ORGANIZERS.forEach(function (label) { wanted[label.toLowerCase()] = true; });

    var candidates = document.querySelectorAll('li, a, button, [role="button"], [role="menuitem"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!nav.contains(el)) continue;
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

  // The console spends /manageWallet/deposit-wallet on two states: before a
  // wallet exists it is the "Set Up Deposit Wallet" landing page, and after it
  // is the wallet list. That transition is one place we can honestly infer
  // progress, so use it.
  //
  // Read the vendor's own content, never document.body — our card lives in the
  // body too, so its own words ("Create your deposit wallet") would otherwise
  // count as the console's and the check could never pass. The console does not
  // use <main>, so subtract our two nodes from the body instead.
  function vendorText() {
    var clone = document.body.cloneNode(true);
    [GUIDE_ID, PILL_ID].forEach(function (id) {
      var el = clone.querySelector('#' + id);
      if (el) el.remove();
    });
    return clone.innerText || '';
  }

  function depositWalletExists() {
    if (location.pathname.indexOf('/manageWallet/deposit-wallet') === -1) return false;
    var text = vendorText();
    // No console content yet (white screen): do not infer anything.
    if (text === '') return false;
    // A wallet row in the list is the proof. The "Set Up Deposit Wallet" button
    // stays on the page even once wallets exist, so it cannot be the signal.
    return /Deposit Wallet\s*\d+/i.test(text) || /ready to accept payments/i.test(text);
  }

  function currentStepId() {
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i].routeMatches()) return STEPS[i].id;
    }
    return null;
  }

  // The step the organizer still has to do, so the card can say "what now"
  // instead of only showing where they have been.
  function nextOpenStep(done) {
    for (var i = 0; i < STEPS.length; i++) {
      if (!done[STEPS[i].id]) return STEPS[i];
    }
    return null;
  }

  function isWalletArea() {
    return location.pathname.indexOf('/manageWallet') !== -1;
  }

  // Monno tells us, through the one-time SSO link, when the organizer's payout
  // wallet is still unconfirmed. While that holds, the guide follows them
  // anywhere in the console: /manageWallet is where they set it up, but the
  // console can land them elsewhere (the dashboard), and it must not vanish
  // with the route.
  function walletSetupPending() {
    try { return localStorage.getItem(WALLET_KEY) === '1'; } catch (e) { return false; }
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
      '  position: fixed; z-index: 2147483000; right: 20px; bottom: 20px; width: 340px;',
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
      '#' + GUIDE_ID + ' .monno-guide-next { margin: 0; padding: 8px 16px 0; color: #4f46e5; font-size: 11.5px; font-weight: 600; }',
      '#' + GUIDE_ID + ' .monno-guide-done { margin: 2px 0 0; color: #10b981; font-size: 11.5px; font-weight: 600; }',
      '#' + GUIDE_ID + ' .monno-guide-chains { margin: 6px 0 0; padding: 0; list-style: none; }',
      '#' + GUIDE_ID + ' .monno-guide-chains li { font-size: 11.5px; color: #64748b; margin-top: 2px; }',
      '#' + GUIDE_ID + ' .monno-guide-chains li.is-pick { color: #4f46e5; font-weight: 600; }',
      '#' + GUIDE_ID + ' .monno-guide-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-top: 1px solid #eef2f7; background: #f8fafc; }',
      '#' + GUIDE_ID + ' .monno-guide-back { color: #4f46e5; font-weight: 600; text-decoration: none; font-size: 12px; }',
      '#' + GUIDE_ID + ' .monno-guide-back:hover { text-decoration: underline; }',
      '#' + GUIDE_ID + ' .monno-guide-hide { border: 0; background: transparent; color: #94a3b8; font-size: 12px; cursor: pointer; }',
      '#' + GUIDE_ID + ' .monno-guide-hide:hover { color: #475569; }',
      '#' + PILL_ID + ' { position: fixed; z-index: 2147483000; right: 20px; bottom: 20px; background: #4f46e5; color: #fff; border: 0; border-radius: 99px; padding: 10px 16px; font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: 0 8px 20px rgba(79,70,229,.35); }',
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
        '    <p class="monno-guide-done" data-monno="done-hint" hidden>' + (step.doneHint || '') + '</p>',
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
      // "What now" — the card has to answer this, not just tick boxes.
      '<p class="monno-guide-next" data-monno="next" hidden></p>',
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
    if ((!isWalletArea() && !walletSetupPending()) || !hasSession() || !isOrganizer()) {
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

    // Fold in the one fact the page itself proves.
    var effectiveDone = { deposit: state.done.deposit || depositWalletExists(), cold: state.done.cold };

    var doneCount = 0;
    STEPS.forEach(function (step) { if (effectiveDone[step.id]) doneCount++; });

    card.hidden = !open;
    // The pill is the way back: keep it whenever the card isn't showing, so the
    // guide can never vanish silently behind a dialog.
    pill.hidden = open;
    pill.textContent = 'Crypto setup \u00b7 ' + doneCount + '/2';

    if (!open) return;

    STEPS.forEach(function (step) {
      var li = card.querySelector('[data-monno-step="' + step.id + '"]');
      if (!li) return;
      var isDone = effectiveDone[step.id];
      li.classList.toggle('is-done', isDone);
      // A step we can see is already satisfied should read as satisfied, even
      // if the organizer never ticked it.
      var inferred = isDone && !state.done[step.id];
      li.classList.toggle('is-current', step.id === active && !isDone);
      var check = li.querySelector('[data-monno="toggle"]');
      if (check) {
        check.setAttribute('aria-pressed', isDone ? 'true' : 'false');
        if (inferred) check.setAttribute('title', 'Detected on this page');
      }
      // A step you are standing on but have already done should say so, rather
      // than keep asking you to do it.
      var hint = li.querySelector('[data-monno="done-hint"]');
      if (hint) hint.hidden = !isDone;
    });

    var progress = card.querySelector('[data-monno="progress"]');
    if (progress) progress.textContent = doneCount + ' of 2 done';

    // Always answer "what now?" — the next thing still to do, or that there is
    // nothing left and the wallet is simply waiting on the gateway to confirm.
    var next = card.querySelector('[data-monno="next"]');
    if (next) {
      var remaining = nextOpenStep(effectiveDone);
      next.hidden = false;
      var detectedDeposit = effectiveDone.deposit && !state.done.deposit;
      next.textContent = remaining
        ? (detectedDeposit && remaining.id === 'cold'
          ? 'Deposit wallet detected \u2014 next: ' + remaining.title
          : 'Next: ' + remaining.title)
        : 'Both done \u2014 waiting for PayRam to confirm your payout wallet. Check the status in Monno.';
    }

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
