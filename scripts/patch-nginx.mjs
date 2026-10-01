#!/usr/bin/env node
// Injects the console-gating script into PayRam's own routing file, in place.
//
// PayRam ships /etc/nginx/payram-locations.conf and calls it the single source
// of truth for routing (it is included by both the HTTP and HTTPS server
// blocks). We append directives to the catch-all location rather than replacing
// the file, so upstream routing changes survive a version bump.
//
// Fails closed: if the anchor moves, the build stops instead of shipping a
// console with no gate.
import { readFileSync, writeFileSync } from 'node:fs';

const CONF = '/etc/nginx/payram-locations.conf';
const MARKER = 'monno-ui.js';

const SNIPPET = [
  '',
  '    # --- monno: inject the console UI gate (see README) ---',
  '    proxy_set_header Accept-Encoding "";',
  `    sub_filter '</head>' '<script src="/monno-ui.js" defer></script></head>';`,
  '    sub_filter_once on;',
  '    sub_filter_types text/html;',
  '    # --- end monno ---',
].join('\n');

const conf = readFileSync(CONF, 'utf8');

if (conf.includes(MARKER)) {
  console.log('✓ nginx already patched');
  process.exit(0);
}

const ANCHOR = 'location / {\n    proxy_pass http://payram_frontend;';
if (!conf.includes(ANCHOR)) {
  console.error('✗ could not find the catch-all `location /` block in ' + CONF);
  console.error('  Upstream routing changed — inspect the image and update this script.');
  process.exit(1);
}

writeFileSync(CONF, conf.replace(ANCHOR, ANCHOR + '\n' + SNIPPET));
console.log('✓ injected console UI gate into ' + CONF);
