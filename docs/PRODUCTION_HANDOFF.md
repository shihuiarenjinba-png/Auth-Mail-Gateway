# Production handoff

This file is the operator checklist for finishing Auth Mail Gateway after the codebase and CI are complete.

## What is already done

- Shared gateway code is implemented.
- Magic Links are 10 minutes and one-time use.
- Verification assertions are 2 minutes and one-time use.
- App requests use HMAC-SHA256, timestamp validation, and nonce replay protection.
- Per-app/per-email rate limiting is 3 requests per 15 minutes.
- Redirect callbacks are allowlisted in gateway configuration.
- Stripe secrets stay inside each product; the gateway never receives them.
- Durable Object state is SQLite-backed.
- CI runs unit/security tests and a Wrangler deploy dry-run.
- The committed default remains fail-closed.

## Manual Cloudflare steps

Do these in the Cloudflare account that owns Auth Mail Gateway. Do not reuse account IDs, tokens, or Worker URLs from DemandScope or NamiData.

1. Confirm the GitHub repository `shihuiarenjinba-png/Auth-Mail-Gateway` and branch `main` are connected to the intended Cloudflare account.
2. Confirm the Worker name is `auth-mail-gateway`.
3. Add or select the owned sending domain in Cloudflare DNS.
4. In **Compute → Email Service → Email Sending**, onboard that domain and wait for SPF, DKIM, DMARC/bounce records to become ready.
5. Choose the sender address, for example `noreply@your-domain.example`.
6. Choose one email transport:
   - **REST path (no repository config change):** create an API token with **Email Sending: Edit**, then set `CLOUDFLARE_EMAIL_ACCOUNT_ID` and secret `CLOUDFLARE_EMAIL_API_TOKEN`.
   - **Worker binding path:** add a `send_email` binding named `EMAIL` to `wrangler.jsonc` in GitHub and redeploy. Do not configure this only in the dashboard because later Wrangler deploys may overwrite dashboard-only bindings.
7. Add a stable custom domain such as `auth.your-domain.example`.
8. Set gateway variables while keeping sending disabled:
   - `AUTH_MAIL_ENABLED=false`
   - `FROM_EMAIL=noreply@your-domain.example`
   - `PUBLIC_BASE_URL=https://auth.your-domain.example`
   - `APPS_CONFIG_JSON` with fixed application callbacks.
9. Generate a unique app secret locally with:
   - `npm run generate:secret`
10. Store the same DemandScope-specific secret in:
   - Gateway secret `APP_SHARED_SECRETS_JSON` under key `demandscope`
   - DemandScope secret `AUTH_MAIL_APP_SECRET`
11. In DemandScope set:
   - `AUTH_MAIL_GATEWAY_URL=https://auth.your-domain.example`
   - `AUTH_MAIL_APP_ID=demandscope`
12. With `AUTH_MAIL_ENABLED=false`, call `GET /health`. Expected:
   - `configured=true`
   - `enabled=false`
   - `ready=false`
   - correct `sender_domain`
   - expected `email_provider`
13. Only after the above is correct, enable the gateway for controlled E2E:
   - `AUTH_MAIL_ENABLED=true`
14. Run E2E using a real active DemandScope Pro email:
   - request link
   - receive email
   - verify SPF/DKIM
   - open link
   - confirm DemandScope callback
   - confirm Stripe subscription is checked again
   - confirm Pro cookie is issued
   - confirm link cannot be reused
   - confirm assertion cannot be reused
   - confirm fourth request inside 15 minutes is rate-limited
   - confirm cancelled/inactive subscription does not get Pro access
15. Leave `AUTH_MAIL_ENABLED=true` only after all checks pass.

## DemandScope callback entry

Use this allowlisted callback:

`https://web-stock-78r.pages.dev/api/magic-link/callback`

Recommended app record:

```json
{
  "demandscope": {
    "name": "DemandScope",
    "callback_url": "https://web-stock-78r.pages.dev/api/magic-link/callback",
    "subject": "DemandScope Pro login link / ログインリンク"
  }
}
```

## Secrets policy

Never put the following into GitHub, Notion, or chat:

- `APP_SHARED_SECRETS_JSON` values
- `AUTH_MAIL_APP_SECRET`
- `CLOUDFLARE_EMAIL_API_TOKEN`
- Stripe secret keys
- webhook secrets

## Stop conditions

Do not turn on live sending if any of these are true:

- wrong Cloudflare account
- wrong GitHub repository/branch
- sender domain is not ready
- `/health configured=false`
- callback differs from the allowlist
- DemandScope app secret does not match the gateway's DemandScope secret
- SPF/DKIM fail
- E2E produces a Pro cookie without a fresh Stripe entitlement check
