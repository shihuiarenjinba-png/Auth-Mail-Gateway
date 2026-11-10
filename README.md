# Auth Mail Gateway

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
- no registered app
- no app shared secret
- no Email Service binding
- no Cloudflare account ID or API token

Until Cloudflare configuration is completed, the gateway cannot send email.

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

- [Production handoff](docs/PRODUCTION_HANDOFF.md)
- [Cloudflare setup](docs/CLOUDFLARE_SETUP.md)
- [Application integration](docs/INTEGRATION.md)
- [Security review](docs/SECURITY_REVIEW.md)

## Secrets

Never commit:

- `.dev.vars`
- `.env`
- `APP_SHARED_SECRETS_JSON`
- Cloudflare API tokens
- Stripe secret keys

Each application must use a different shared HMAC secret.
