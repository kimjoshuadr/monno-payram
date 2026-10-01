# monno's PayRam image.
#
# PayRam's core is closed: we inherit the pinned vendor release and add only
# what we own on top. Everything below is additive — no vendor file is
# modified unless a step says so explicitly.
#
# Build runs in CI and on the Coolify server; see .github/workflows/build.yml.
ARG PAYRAM_VERSION=3.8.2

FROM payramapp/payram:${PAYRAM_VERSION}

# The Next.js app serves /web/public at the domain root (verified: /favicon.ico
# is served from here), so anything dropped here is same-origin with the
# console — which is what lets /sso.html write its localStorage session.
COPY overlay/web/public/ /web/public/
