# Application integration

Auth Mail Gateway proves **email possession**. It does not decide whether a user is entitled to a paid product.

Each application remains responsible for its own Stripe subscription verification.

## Trust boundary

```text
Application backend
  1. Verify Stripe subscription for the requested email
  2. Send HMAC-authenticated request to Auth Mail Gateway
       ↓
Auth Mail Gateway
  3. Send one-time email link
  4. Verify link and issue short-lived one-time assertion code
       ↓
Application callback
  5. Exchange assertion code with HMAC authentication
  6. Re-verify Stripe subscription
  7. Issue the application's own session / HttpOnly cookie
```

The gateway never receives Stripe secret keys.

## Per-application configuration

Gateway non-secret variable `APPS_CONFIG_JSON`:

```json
{
  "demandscope": {
    "name": "DemandScope",
    "callback_url": "https://web-stock-78r.pages.dev/api/magic-link/callback",
    "subject": "DemandScope Pro login link / ログインリンク"
  }
}
```

Gateway secret `APP_SHARED_SECRETS_JSON`:

```json
{
  "demandscope": "GENERATE_AT_LEAST_32_RANDOM_CHARACTERS"
}
```

The same per-app shared secret is stored as a Secret in the application's Cloudflare account. Do not put the secret in GitHub, Notion, client-side JavaScript, or URLs.

Different applications should use different secrets.

Generate a 384-bit URL-safe secret locally:

```bash
npm run generate:app-secret
```

Copy the output directly into the Gateway secret and the matching product secret. Do not paste the generated value into GitHub, Notion, issues, logs, or chat.

## Signed server-to-server request

Required headers:

- `x-auth-mail-app`
- `x-auth-mail-timestamp` — Unix seconds
- `x-auth-mail-nonce` — random 16+ character nonce
- `x-auth-mail-signature` — lowercase hex HMAC-SHA256

Canonical string:

```text
{timestamp}.{nonce}.{raw JSON body}
```

HMAC key: the application's shared secret.

Requests outside a five-minute clock window are rejected. A nonce can only be used once.

## Request a Magic Link

`POST /v1/magic-link/request`

Body:

```json
{
  "email": "buyer@example.com",
  "state": "application-generated-csrf-state"
}
```

The callback URL is **not accepted from the request body**. It comes only from the gateway allowlist in `APPS_CONFIG_JSON`, preventing open redirects.

Response:

```json
{
  "accepted": true,
  "expires_in_seconds": 600
}
```

## Email verification

The user receives a gateway URL:

```text
https://auth.example.com/v1/magic-link/verify?token=...
```

The token is valid for ten minutes and can be consumed once.

The gateway then redirects to the configured application callback:

```text
https://application.example/api/auth-mail/callback?code=...&state=...
```

The email address is never put in the callback URL.

## Consume an assertion

The application backend sends an HMAC-authenticated:

`POST /v1/assertion/consume`

Body:

```json
{
  "code": "one-time-code-from-callback"
}
```

Success:

```json
{
  "verified": true,
  "email": "buyer@example.com",
  "verified_at": 1794283200000
}
```

The assertion expires after two minutes and is one-time use.

After this response, the application **must verify its Stripe subscription again** before issuing Pro access.

## DemandScope migration

DemandScope currently contains its own disabled local Magic Link implementation. When the shared gateway URL is ready:

1. Keep the existing local email sender disabled.
2. Add DemandScope Secrets:
   - `AUTH_MAIL_GATEWAY_URL`
   - `AUTH_MAIL_APP_ID=demandscope`
   - `AUTH_MAIL_APP_SECRET`
3. Add a server-side DemandScope endpoint that:
   - accepts the purchase email,
   - verifies the active DemandScope Stripe subscription,
   - signs and sends the gateway request.
4. Add `/api/auth-mail/callback`:
   - validates the returned `state`,
   - exchanges the code with the gateway,
   - verifies the DemandScope Stripe subscription again,
   - issues the existing `demand_pro` HttpOnly cookie.
5. Remove the old direct email sending path only after gateway E2E passes.

The two Cloudflare accounts do not need to be the same. Communication is HTTPS + per-app HMAC; no cross-account Cloudflare credentials are shared.
