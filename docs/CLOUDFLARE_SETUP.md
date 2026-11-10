# Cloudflare setup and cutover

This repository intentionally contains **no Cloudflare account ID, zone ID, sender domain, API token, or app secret**.

That is important because the Auth Mail Gateway Cloudflare account is different from other product accounts.

## Phase 1 — safe deployment

The committed Wrangler config is fail-closed:

- `AUTH_MAIL_ENABLED=false`
- sender is deliberately invalid
- no application is registered
- no email binding is required for the first deployment
- Durable Object state is configured in code

A first deployment can therefore expose only `/` and `/health` without sending mail.

## Phase 2 — onboard a sender domain

Cloudflare Email Service requires the sender domain to use Cloudflare DNS.

In the Cloudflare account that owns this gateway:

1. Open **Compute → Email Service → Email Sending**.
2. Select **Onboard Domain**.
3. Choose the owned domain.
4. Allow or add Cloudflare's SPF, DKIM, DMARC, and bounce records.
5. Wait until the domain reports ready.
6. Choose a sender such as:
   - `noreply@your-domain.example`

No inbox is required for the noreply address.

Arbitrary-recipient Email Sending requires Workers Paid. Verified-destination testing is more limited on Free.

## Phase 3 — choose Email Sending transport

The gateway supports two Cloudflare Email Service transports.

### REST path — recommended for the first handoff

This path needs no repository config change:

- variable: `CLOUDFLARE_EMAIL_ACCOUNT_ID`
- secret: `CLOUDFLARE_EMAIL_API_TOKEN`

Create a narrowly scoped token with **Email Sending: Edit**. Never use the Global API Key.

### Worker binding path

The gateway also supports a Worker Email Sending binding named `EMAIL`.

If you choose this path, add `send_email` to `wrangler.jsonc` in GitHub and redeploy. Do not rely on a dashboard-only binding, because later Wrangler deployments can treat the repository configuration as the source of truth.

When the binding exists, the gateway automatically prefers `env.EMAIL.send()`.

## Phase 4 — gateway variables and secrets

Variables:

```text
AUTH_MAIL_ENABLED=false
FROM_EMAIL=noreply@your-domain.example
PUBLIC_BASE_URL=https://auth.your-domain.example
APPS_CONFIG_JSON={...}
```

Secret:

```text
APP_SHARED_SECRETS_JSON={...}
```

Do not enable the gateway yet.

After sender, custom auth domain, state binding, email transport, app config, and app secret are present, `GET /health` should report `configured=true`, `enabled=false`, `ready=false`.

## Phase 5 — required custom domain

Map a stable domain such as:

```text
auth.your-domain.example
```

to this Worker.

Set:

```text
PUBLIC_BASE_URL=https://auth.your-domain.example
```

This domain is what users see in verification links. The gateway will not report `ready=true` unless `PUBLIC_BASE_URL` is explicitly set to a non-`workers.dev` / non-`pages.dev` HTTPS domain (localhost HTTP is allowed only for local development).

## Phase 6 — register applications

Each application gets:

- unique `app_id`
- unique random shared secret
- fixed HTTPS callback URL
- display name / email subject

The gateway's callback allowlist is the source of truth. Never let the requesting application supply an arbitrary redirect URL.

## Phase 7 — application-side setup

For each product:

1. Store the matching app shared secret in that product's Cloudflare account.
2. Implement the signed server-to-server request.
3. Verify Stripe entitlement before requesting an email.
4. Implement the callback and assertion exchange.
5. Verify Stripe entitlement again before issuing the product session.

Cloudflare accounts may differ. No Cloudflare API token is shared between product accounts.

## Phase 8 — E2E before enabling

Verify:

- health shows the correct sender domain, email provider, and `public_base_url_configured=true`
- SPF / DKIM pass
- a Magic Link expires after 10 minutes
- it cannot be reused
- an assertion expires after 2 minutes
- it cannot be reused
- replayed signed API requests are rejected
- the fourth link request to one address inside 15 minutes is rate-limited
- callback is always the configured allowlisted URL
- no email address appears in the callback URL
- inactive Stripe subscription is rejected by the product before email request
- subscription cancellation after email request is rejected by the product during callback
- secrets never appear in logs or client JavaScript

Only after all tests pass:

```text
AUTH_MAIL_ENABLED=true
```

## Cross-account warning

Do not copy old Cloudflare account IDs, Worker URLs, D1 IDs, or API tokens from DemandScope/NamiData into this project.

This gateway has its own Cloudflare account context. Product applications talk to it only over HTTPS with HMAC.


## CI deployment validation

Every push and pull request runs:

- unit/security tests,
- JavaScript syntax checks,
- `wrangler deploy --dry-run`.

The dry-run compiles the Worker and validates the Durable Object configuration without uploading to Cloudflare.
