# monno's PayRam image.
#
# PayRam's core is closed: we inherit the pinned vendor release and add only
# what we own on top.
ARG PAYRAM_VERSION=3.9.0

FROM payramapp/payram:${PAYRAM_VERSION}

# The Next.js app serves /web/public at the domain root (verified: /favicon.ico
# is served from here), so anything dropped here is same-origin with the
# console — which is what lets /sso.html write its localStorage session and
# /monno-ui.js run inside the dashboard.
COPY overlay/web/public/ /web/public/

# Gate the console nav. Patches the vendor's routing file in place, and fails
# the build if its anchor has moved.
COPY scripts/patch-nginx.mjs /tmp/patch-nginx.mjs
RUN node /tmp/patch-nginx.mjs && rm -f /tmp/patch-nginx.mjs
