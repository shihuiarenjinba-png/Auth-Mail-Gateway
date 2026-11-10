# Operator handoff — Cloudflare activation

The code is intentionally fail-closed. Complete this checklist in the **Cloudflare account created for Auth Mail Gateway**, not the DemandScope/NamiData account.

Do not paste any secret value into GitHub, Notion, issues, or chat.

## 1. Confirm repository deployment connection

In Cloudflare:

1. Open **Workers & Pages**.
2. Select the Auth Mail Gateway Worker/project.
3. Confirm the connected repository is:
   - `shihuiarenjinba-png/Auth-Mail-Gateway`
4. Confirm production branch:
   - `main`
5. Confirm deploy command uses this repository's Wrangler configuration.
6. Do not copy account IDs, Worker URLs, D1 IDs, or API tokens from DemandScope/NamiData.

Expected repository main after code preparation:

`598b978ff559d4436e67ff059aa49fe7dd0fc63d` or a later verified commit.

## 2. Confirm Workers plan

Arbitrary-recipient Cloudflare Email Sending requires Workers Paid.

Verified-destination testing can be done with more limited free capabilities, but customer Magic Links require arbitrary-recipient sending.

## 3. Onboard an owned sender domain

Cloudflare **Compute → Email Service → Email Sending → Onboard Domain**.

Confirm the domain is in the same Cloudflare account and uses Cloudflare DNS.

Wait until Cloudflare reports the sending domain ready.

Verify:

- SPF
- DKIM
- DMARC
- bounce records

Recommended sender:

`noreply@YOUR_DOMAIN`

No inbox is required for the noreply address.

## 4. Create the stable auth hostname

Recommended:

`auth.YOUR_DOMAIN`

Map it as a custom domain to the Auth Mail Gateway Worker.

Do not use workers.dev or pages.dev as production `PUBLIC_BASE_URL`; the code rejects those for readiness.

## 5. Add Email Sending binding

Preferred Worker binding:

`EMAIL`

Use Cloudflare Email Service's Email Sending binding.

The Worker code automatically prefers `env.EMAIL.send()`.

Only if the binding cannot be used, configure the REST fallback with a restricted Email Sending API token.

## 6. Generate the DemandScope app secret

From a local checkout of this repository:

```bash
npm install
npm run generate:app-secret
```

This prints a fresh 384-bit URL-safe secret.

Copy it directly into Cloudflare Secrets. Do not save it in a document.

## 7. Configure the Gateway

Non-secret variables:

```text
AUTH_MAIL_ENABLED=false
FROM_EMAIL=noreply@YOUR_DOMAIN
PUBLIC_BASE_URL=https://auth.YOUR_DOMAIN
```

`APPS_CONFIG_JSON`:

```json
{
  "demandscope": {
    "name": "DemandScope",
    "callback_url": "https://web-stock-78r.pages.dev/api/magic-link/callback",
    "subject": "DemandScope Pro login link / ログインリンク"
  }
}
```

Secret:

`APP_SHARED_SECRETS_JSON`

Structure:

```json
{
  "demandscope": "<THE GENERATED DEMANDSCOPE SECRET>"
}
```

Keep `AUTH_MAIL_ENABLED=false`.

## 8. Configure DemandScope

In the **DemandScope Cloudflare account**, add:

Variable:

```text
AUTH_MAIL_GATEWAY_URL=https://auth.YOUR_DOMAIN
AUTH_MAIL_APP_ID=demandscope
```

Secret:

```text
AUTH_MAIL_APP_SECRET=<THE SAME DEMANDSCOPE SECRET>
```

Do not put the Gateway Cloudflare API token or account ID into DemandScope.

## 9. Pre-enable checks

Gateway:

```text
GET https://auth.YOUR_DOMAIN/health
```

Expected before enable:

- service = auth-mail-gateway
- enabled = false
- ready = false
- public_base_url_configured = true
- sender_domain = YOUR_DOMAIN
- state_ready = true
- configured_apps >= 1
- email_provider = binding (preferred)

DemandScope:

```text
GET https://web-stock-78r.pages.dev/api/magic-link/status
```

It should remain unavailable while Gateway is disabled.

## 10. Enable only for E2E

After every setting above is correct, change only:

```text
AUTH_MAIL_ENABLED=true
```

Then verify Gateway `/health` returns `ready=true`.

## 11. E2E checklist

Use a DemandScope Pro test/customer email that you control.

- [ ] DemandScope confirms an active Stripe subscription before requesting email
- [ ] Magic Link email arrives from `noreply@YOUR_DOMAIN`
- [ ] SPF passes
- [ ] DKIM passes
- [ ] Link hostname is `auth.YOUR_DOMAIN`
- [ ] Link expires after 10 minutes
- [ ] Link cannot be reused
- [ ] Callback only returns to the fixed DemandScope callback
- [ ] Callback URL does not contain the email address
- [ ] Assertion is one-time
- [ ] Assertion expires after 2 minutes
- [ ] Browser recovery state matches; mismatched state is rejected
- [ ] DemandScope re-checks Stripe after email verification
- [ ] Active subscription receives the `demand_pro` HttpOnly cookie
- [ ] Cancelled/inactive subscription does not receive Pro access
- [ ] Fourth request to the same app/email within 15 minutes is rate-limited
- [ ] Replayed signed API request is rejected

If any item fails, set `AUTH_MAIL_ENABLED=false` again.

## 12. After PASS

Keep the Gateway reusable. For each new product:

1. Add one app entry to `APPS_CONFIG_JSON`.
2. Generate a new unique app secret.
3. Add the matching secret to `APP_SHARED_SECRETS_JSON`.
4. Add the Gateway URL/app ID/secret to that product backend.
5. Require product-specific entitlement checks before request and after assertion.
6. Run the same E2E checklist before exposing the recovery UI.
