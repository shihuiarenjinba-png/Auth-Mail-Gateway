# Operator handoff

The code side is prepared. Do not enable live mail until every item below is complete.

## 1. Confirm the intended Cloudflare account

Use only the Cloudflare account created for Auth Mail Gateway.

Do not reuse DemandScope/NamiData:

- Account ID
- API token
- Worker URL
- D1 binding
- product secrets

## 2. Confirm Git deployment

Connect this repository and `main` to the intended Worker, or deploy this repository with Wrangler from the intended account.

The committed config:

- preserves dashboard variables with `keep_vars=true`;
- declares the `EMAIL` Send Email binding;
- declares the SQLite-backed `AUTH_STATE` Durable Object;
- commits no production variables;
- remains fail-closed until runtime settings exist.

## 3. Onboard sender domain

In Cloudflare Email Service:

1. Onboard the owned domain.
2. Wait for SPF, DKIM, DMARC and bounce records to become ready.
3. Choose `noreply@YOUR_DOMAIN`.
4. If using arbitrary external recipients, use a Workers Paid plan.

## 4. Add runtime variables

Keep disabled:

```text
AUTH_MAIL_ENABLED=false
FROM_EMAIL=noreply@YOUR_DOMAIN
PUBLIC_BASE_URL=https://auth.YOUR_DOMAIN
APPS_CONFIG_JSON={"demandscope":{"name":"DemandScope","callback_url":"https://web-stock-78r.pages.dev/api/magic-link/callback","subject":"DemandScope Pro login link / ログインリンク"}}
```

The production `PUBLIC_BASE_URL` must be a custom HTTPS domain. `workers.dev` and `pages.dev` are intentionally rejected for readiness.

## 5. Generate the DemandScope app secret

Run locally:

```bash
npm run generate:app-secret
```

Do not paste the generated value into Notion, GitHub source, chat, browser JavaScript, or URLs.

Store the same generated value in:

Gateway secret:

```text
APP_SHARED_SECRETS_JSON={"demandscope":"<secret>"}
```

DemandScope secret:

```text
AUTH_MAIL_APP_SECRET=<same secret>
```

DemandScope variables:

```text
AUTH_MAIL_GATEWAY_URL=https://auth.YOUR_DOMAIN
AUTH_MAIL_APP_ID=demandscope
```

## 6. Verify Gateway health

Run:

```bash
AUTH_MAIL_GATEWAY_URL=https://auth.YOUR_DOMAIN npm run verify:remote
```

The command must exit successfully and report:

- `service=auth-mail-gateway`
- `ready=true`
- `state_ready=true`
- `public_base_url_configured=true`
- `email_provider=binding`
- the expected sender domain
- at least one configured app

## 7. E2E before enabling

Then enable only for the controlled E2E window and test:

- active DemandScope subscription sends a link;
- non-subscriber does not receive one;
- Magic Link expires after 10 minutes;
- Magic Link cannot be reused;
- assertion expires after 2 minutes;
- assertion cannot be reused;
- replayed signed requests fail;
- fourth request to the same email within 15 minutes is blocked;
- app-wide fan-out above 60 requests/minute is blocked;
- callback always returns to the configured DemandScope URL;
- callback URL contains no email address;
- cancelled subscription fails the second Stripe verification;
- Pro cookie is issued only after the second Stripe check.

If any item fails, immediately set:

```text
AUTH_MAIL_ENABLED=false
```

## 8. Production enablement

Only after all E2E checks pass:

```text
AUTH_MAIL_ENABLED=true
```

Then verify `/health` again.
