# Production handoff

This is the operator checklist for finishing Auth Mail Gateway after code and CI are complete.

## Already complete

- Shared gateway implementation.
- 10-minute, one-time Magic Links.
- 2-minute, one-time verification assertions.
- HMAC-SHA256 application authentication.
- Five-minute signature timestamp window.
- Nonce replay protection.
- Per-app/per-email rate limit: 3 requests per 15 minutes.
- Fixed callback allowlist.
- SQLite-backed Durable Object state.
- Gateway stores no Stripe secret keys.
- Production readiness rejects workers.dev/pages.dev as PUBLIC_BASE_URL.
- CI runs tests, syntax checks, and Wrangler deploy dry-run.
- Committed configuration remains fail-closed.

## Manual Cloudflare work

Use only the Cloudflare account intended for Auth Mail Gateway. Do not reuse account IDs, tokens, Worker URLs, or D1 IDs from DemandScope/NamiData.

1. Confirm GitHub repository `shihuiarenjinba-png/Auth-Mail-Gateway` and branch `main` are connected to the intended Cloudflare account.
2. Confirm the Worker is `auth-mail-gateway`.
3. Add/select the owned sending domain in Cloudflare DNS.
4. Open **Compute → Email Service → Email Sending → Onboard Domain**.
5. Wait until Cloudflare's SPF, DKIM, DMARC/bounce records are ready.
6. Choose the sender address, for example `noreply@your-domain.example`.
7. Choose one transport:
   - **REST path (recommended first):** create an API token with **Email Sending: Edit**, set `CLOUDFLARE_EMAIL_ACCOUNT_ID`, and store `CLOUDFLARE_EMAIL_API_TOKEN` as a Secret.
   - **Worker binding path:** add `send_email: [{ "name": "EMAIL" }]` to `wrangler.jsonc` in GitHub and redeploy. Do not rely on a dashboard-only binding because later Wrangler deploys may overwrite dashboard-only configuration.
8. Add a stable custom domain such as `auth.your-domain.example`.
9. Set gateway variables with sending still OFF:
   - `AUTH_MAIL_ENABLED=false`
   - `FROM_EMAIL=noreply@your-domain.example`
   - `PUBLIC_BASE_URL=https://auth.your-domain.example`
   - `APPS_CONFIG_JSON` with fixed callbacks.
10. Generate a DemandScope app secret locally:
    - `npm run generate:secret`
11. Store that same secret only in platform secret stores:
    - Gateway `APP_SHARED_SECRETS_JSON` under `demandscope`
    - DemandScope `AUTH_MAIL_APP_SECRET`
12. In DemandScope set:
    - `AUTH_MAIL_GATEWAY_URL=https://auth.your-domain.example`
    - `AUTH_MAIL_APP_ID=demandscope`
13. With `AUTH_MAIL_ENABLED=false`, call `GET /health`. Expected:
    - `configured=true`
    - `enabled=false`
    - `ready=false`
    - `public_base_url_configured=true`
    - correct `sender_domain`
    - expected `email_provider`
14. Only after the above is correct, temporarily set `AUTH_MAIL_ENABLED=true` for controlled E2E.
15. E2E with a real active DemandScope Pro email:
    - request Magic Link,
    - receive email,
    - verify SPF/DKIM,
    - open link,
    - confirm redirect goes only to DemandScope callback,
    - confirm DemandScope re-checks Stripe,
    - confirm Pro cookie is issued,
    - confirm Magic Link cannot be reused,
    - confirm assertion cannot be reused,
    - confirm fourth request inside 15 minutes is rate-limited,
    - confirm an inactive/cancelled subscription does not get Pro access.
16. Leave `AUTH_MAIL_ENABLED=true` only after every check passes.

## DemandScope allowlist entry

Callback:

`https://web-stock-78r.pages.dev/api/magic-link/callback`

Recommended non-secret app configuration:

```json
{
  "demandscope": {
    "name": "DemandScope",
    "callback_url": "https://web-stock-78r.pages.dev/api/magic-link/callback",
    "subject": "DemandScope Pro login link / ログインリンク"
  }
}
```

## Never store in GitHub / Notion / chat

- `APP_SHARED_SECRETS_JSON` values
- `AUTH_MAIL_APP_SECRET`
- `CLOUDFLARE_EMAIL_API_TOKEN`
- Stripe secret keys
- Stripe webhook secrets

## Stop conditions

Do not enable live sending if any of these are true:

- wrong Cloudflare account,
- wrong GitHub repository or branch,
- Email Sending domain not ready,
- `/health configured=false`,
- `public_base_url_configured=false`,
- callback differs from the allowlist,
- app secrets do not match,
- SPF/DKIM fail,
- product grants Pro without a fresh Stripe entitlement check.
