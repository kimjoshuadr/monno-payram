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

## Dashboard navigation is already gated — do not patch it

The vendor's dashboard already restricts the sidebar. From the built layout
chunk:

```js
.filter(e => isOperator || 'OPERATOR' !== e.categoryName)   // whole Operator section
items.filter(e => !e.permission || can(e.permission))        // per-item, by role
```

and `can` is `isAdmin || permissions.has(permission)`, sourced from
`GET /api/v1/project/{id}/my-access` → `{ role, permissions, isAdmin }`.

Two levers, both API-level, no bundle editing:

1. **Member role.** We assign `project_admin` at provisioning
   (`PayRamMerchantProvisioningService::assignMemberRole`). Narrower roles exist —
   `project_manager` (view project data) and `project_ops` (payments and
   customers only). Assigning one of those removes wallet-management and
   operator items without touching the image.
2. **`setupMode`.** `isOperator` is literally `setupMode === 'operator'`, and it
   is **gateway-wide** (`GET /api/v1/operator/setup-mode` → `{"setupMode":"operator"}`
   today). That is why every user, organizer included, sees the OPERATOR section.
   It is a single lever for that whole category.

**Fallback, if a leak ever survives both:** the vendor's routing table,
`/etc/nginx/payram-locations.conf`, is explicitly the "single source of truth"
included by both the HTTP and HTTPS server blocks. Replacing it in the overlay
lets us add `sub_filter` to the catch-all `location /` and inject a script that
hides items — no minified-JS surgery:

```nginx
location / {
    proxy_pass http://payram_frontend;
    proxy_set_header Accept-Encoding "";          # rewrite the uncompressed body
    sub_filter '</head>' '<script src="/monno-ui.js" defer></script></head>';
    sub_filter_once on;
    sub_filter_types text/html;
}
```

Only reach for this if the role levers cannot express the restriction: it is
strictly more fragile than the two API levers above.

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
