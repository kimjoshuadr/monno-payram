# monno-payram

The PayRam image monno runs. PayRam's core is **closed** — `PayRam/payram-core`
and `PayRam/payram-web` are private, and the only deployable artifact is the
image `payramapp/payram`. So we inherit a pinned vendor release and layer on
only what we own.

```
Dockerfile                       FROM payramapp/payram:<VERSION> + overlays
VERSION                          the pinned upstream tag (CI enforces this)
overlay/web/public/sso.html      one-time-code console login (see below)
scripts/verify-static.mjs        fails closed if the pin or overlay drifts
docker-compose.yml               build: .  (service name stays `payram`)
```

Coolify deploys this repo as a Docker Compose app; the service name `payram`
must not change, because Coolify's domain mapping (`payram` → `pay.monno.io`)
is keyed on it. TLS terminates at Coolify's proxy, so the container runs its
bundled nginx in HTTP mode.

## What the overlay actually does

`/web/public` is served at the domain root (verified: `/favicon.ico` comes from
it), so `/sso.html` is **same-origin** with the console. That matters because the
gateway's session lives in `localStorage` and no other origin can write it.

Monno mints a one-time code (`POST /organizers/{id}/payram/sso-token`) and opens
`https://pay.monno.io/sso.html#code=…&exchange=…`. The page redeems the code,
writes `payram_access_token` / `payram_refresh_token` / `payram_token_expiry` /
`payram_user`, and redirects to `/dashboard`. This is the hand-built equivalent
of Stripe Connect's `login_links`, which PayRam does not offer.

## Console navigation is gated by an injected script

The vendor filters nav items by permission, and hides the OPERATOR section
behind `setupMode === 'operator'`. But the roles are **fixed** (there is no API
to create one) and an organizer genuinely needs `write_wallet` to register a
payout wallet — so the only role that fits, `project_admin`, also carries
Growth, Onramp, Funds Consolidation, Developers and Analytics. No existing role
expresses "wallet screen only".

So we gate the console ourselves, at the one extension point the vendor left us:

- `scripts/patch-nginx.mjs` appends `sub_filter` directives to the catch-all
  `location /` in `/etc/nginx/payram-locations.conf` — the vendor's own
  "single source of truth" routing file, which both the HTTP and HTTPS server
  blocks include. It patches in place (so upstream routing survives), and
  **fails the build** if the anchor moves.
- `overlay/web/public/monno-ui.js` is injected into every dashboard page. It
  reads `payram_user.role.name` from localStorage, leaves `root`/`admin` alone,
  and hides the listed sections for everyone else. A MutationObserver re-applies
  it as the sidebar re-renders on client-side navigation.

The hide list lives at the top of `monno-ui.js`. Keep it short and obvious;
it is the only place the console is reshaped.

> Do not "fix" the same problem by narrowing the member's role. `project_manager`
> and `project_ops` both lack `write_wallet`, which would strand an organizer who
> has to set a payout address.

## Why the console link exists at all

Registering a payout wallet is not an API call: the dialog's own copy is "Add
cold wallet and update the Contract using your master account", and it opens a
wallet-connect prompt. It is an on-chain contract update signed by the master
wallet. A platform cannot do it on the organizer's behalf without holding their
private key, which is the custody PayRam exists to avoid.

So the console is the only place a payout wallet can be set, and the goal is
that the organizer opens it once, for one signature, with nothing else in the
way. This gate is what makes that true.

## Verifying a bump

The vendor ships often (hourly `sha-*` tags, feature branches). `track-upstream`
opens a PR when a new release tag appears; a PR may only be merged after `build`
passes **and** someone has re-checked, against the new tag:

- `/sso.html` still serves, and a bad code still surfaces the 410 message;
- a `project_admin` session still shows no operator tabs (paste the nav filter
  above into the built layout chunk to confirm it is unchanged);
- `GET /api/v1/operator/setup-mode` is still the expected value.

## Rollback

Revert the Coolify app's `git_repository` to `kimjoshuadr/payram-docker`
(main @ `c69b871`) — the previous, equivalent image — and redeploy.

> Deploys here are production changes: `pay.monno.io` is the shared gateway for
> both staging and prod.
