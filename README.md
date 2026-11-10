# Auth Mail Gateway

Current code version: `0.3.0`.

Shared email-identity gateway for DemandScope, NamiData, and future SaaS products.

## Purpose

This service centralizes:

- `noreply@` transactional identity mail
- 10-minute, one-time Magic Links
- HMAC-authenticated server-to-server requests
- replay protection
- per-email rate limiting
- two-minute, one-time assertion exchange
- fixed callback allowlists

It deliberately does **not** centralize product billing authorization.

Each product verifies its own Stripe subscription both before requesting a Magic Link and after consuming the verified assertion.

## Security boundary

The gateway never receives product Stripe secret keys.

It proves only:

> the user can receive email at this address.

The product proves:

> this email/customer has an active entitlement for this specific product.

## Current state

Fail-closed by default.

`wrangler.jsonc` ships with:

- `AUTH_MAIL_ENABLED=false`
- no usable sender address
- no explicit custom `PUBLIC_BASE_URL`
- no registered app
- no app shared secret
- Cloudflare Email Sending binding `EMAIL` declared in Wrangler, but unusable until an owned sender domain is onboarded

Until Cloudflare Email Service domain onboarding and runtime variables/secrets are completed, the gateway cannot become ready or send customer email. Production readiness also requires an explicit custom HTTPS auth domain; `workers.dev` and `pages.dev` are rejected as `PUBLIC_BASE_URL`.

## Endpoints

- `GET /health`
- `POST /v1/magic-link/request` — app backend only, HMAC authenticated
- `GET /v1/magic-link/verify?token=...` — user email link
- `POST /v1/assertion/consume` — app backend only, HMAC authenticated

## State

One-time tokens, replay nonces, assertions, and rate-limit windows use a SQLite-backed Cloudflare Durable Object.

No D1 database is required.

Durable Objects are available on Cloudflare Free and Paid plans; arbitrary-recipient Cloudflare Email Sending requires Workers Paid.

## Cloudflare / GitHub separation

The GitHub repository owner and the Cloudflare account connected to deployment do not need to match.

No Cloudflare account ID is hard-coded in the repository.

See:

- [Cloudflare setup](docs/CLOUDFLARE_SETUP.md)
- [Application integration](docs/INTEGRATION.md)
- [Data Shaper integration gate](docs/DATA_SHAPER_INTEGRATION.md)

## Secrets

Never commit:

- `.dev.vars`
- `.env`
- `APP_SHARED_SECRETS_JSON`
- Cloudflare API tokens
- Stripe secret keys

Each application must use a different shared HMAC secret.

## Current activation status

The repository is code-ready and declares the native Cloudflare Email Sending binding, but remains intentionally not mail-ready. Keep `AUTH_MAIL_ENABLED=false` until the Cloudflare sender domain, Email Sending binding, custom auth domain, application-specific secrets, and end-to-end tests all pass.

Data Shaper is documented as a future consumer but remains HOLD until its server-side Stripe entitlement/callback layer exists.

## Email transport decision

Version 0.3.0 uses the native Cloudflare Email Sending Worker binding named `EMAIL` only. The previous REST fallback was removed to reduce secret management and cross-account risk.
