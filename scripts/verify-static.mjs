#!/usr/bin/env node
// Fails closed: if the pin drifts or the overlay goes missing, CI stops.
import { readFileSync, existsSync } from 'node:fs';

const fail = (msg) => { console.error('✗ ' + msg); process.exit(1); };
const ok = (msg) => console.log('✓ ' + msg);

const version = readFileSync('VERSION', 'utf8').trim();
if (!/^\d+\.\d+(\.\d+)?$/.test(version)) fail(`VERSION is not a release tag: ${version}`);

const dockerfile = readFileSync('Dockerfile', 'utf8');
const arg = dockerfile.match(/ARG\s+PAYRAM_VERSION=([\w.]+)/);
if (!arg) fail('Dockerfile has no PAYRAM_VERSION build arg');
if (arg[1] !== version) fail(`Dockerfile pin ${arg[1]} != VERSION ${version}`);
if (!dockerfile.includes('patch-nginx.mjs')) fail('Dockerfile does not run the nginx patch');

const compose = readFileSync('docker-compose.yml', 'utf8');
if (!/^\s+build:/m.test(compose)) fail('compose does not build from this repo');
if (!/^\s+payram:/m.test(compose)) fail('compose service must stay named `payram` (Coolify domain mapping)');

// --- SSO landing page -------------------------------------------------------
const sso = 'overlay/web/public/sso.html';
if (!existsSync(sso)) fail(`${sso} missing`);
const html = readFileSync(sso, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/);
if (!script) fail('sso.html has no inline script');
try { new Function(script[1]); } catch (e) { fail('sso.html inline script does not parse: ' + e.message); }
for (const key of ['payram_access_token', 'payram_refresh_token', 'payram_token_expiry', 'payram_user']) {
  if (!html.includes(key)) fail(`sso.html no longer writes ${key}`);
}

// --- console UI gate --------------------------------------------------------
const ui = 'overlay/web/public/monno-ui.js';
if (!existsSync(ui)) fail(`${ui} missing`);
try { new Function(readFileSync(ui, 'utf8')); } catch (e) { fail('monno-ui.js does not parse: ' + e.message); }
if (!readFileSync(ui, 'utf8').includes('payram_user')) fail('monno-ui.js no longer reads payram_user');

const patch = readFileSync('scripts/patch-nginx.mjs', 'utf8');
if (!patch.includes('payram-locations.conf')) fail('patch-nginx.mjs no longer targets the vendor routing file');
if (!patch.includes('process.exit(1)')) fail('patch-nginx.mjs is not fail-closed');

ok(`static checks passed (PayRam ${version})`);
