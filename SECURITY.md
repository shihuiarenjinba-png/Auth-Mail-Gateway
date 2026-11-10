# Security model

Auth Mail Gateway proves only that a user can receive email at a requested address. It must never become the authority for paid-product entitlement.

## Trust boundaries

- Product backends keep Stripe/API secrets and decide entitlement.
- Auth Mail Gateway keeps only per-app HMAC secrets and short-lived email verification state.
- Browser clients never receive HMAC secrets, Stripe secrets, or Cloudflare Email API credentials.
- Cloudflare accounts for the gateway and product apps may be different.

## Required product flow

1. Product verifies the requested email has an active entitlement.
2. Product signs a server-to-server request to the gateway.
3. Gateway sends a single-use Magic Link.
4. Gateway verifies the Magic Link and returns a short-lived one-time assertion to the fixed callback URL.
5. Product consumes the assertion using its HMAC secret.
6. Product re-verifies entitlement.
7. Product issues its own session/cookie.

Skipping step 1 or 6 is a security bug.

## Invariants

- Magic Link lifetime: 10 minutes.
- Assertion lifetime: 2 minutes.
- Magic Link and assertion are single-use.
- Raw Magic Link and assertion tokens are not stored.
- HMAC timestamps outside five minutes are rejected.
- HMAC nonces are single-use.
- Redirect URLs come only from the gateway allowlist.
- Email addresses are not placed in callback URLs.
- Production readiness requires an explicit custom HTTPS PUBLIC_BASE_URL.
- workers.dev and pages.dev cannot be used as production PUBLIC_BASE_URL.
- Gateway never stores Stripe secret keys.
- IP addresses are not identity keys.
- Public product endpoints must not reveal whether an email has an active subscription.

## Abuse controls

The gateway enforces three requests per app + email address per 15 minutes.

Products should additionally apply their normal global abuse/WAF controls where appropriate. Do not weaken the per-email limit simply because a product is behind Cloudflare.

## Secrets

Never commit or write to Notion/chat:

- APP_SHARED_SECRETS_JSON values
- product-side AUTH_MAIL_APP_SECRET values
- Cloudflare API tokens
- Stripe secret keys

Use a different app secret for every product.

## Incident response

If a product app secret may be exposed:

1. Set AUTH_MAIL_ENABLED=false if gateway-wide risk is suspected.
2. Rotate only that application's shared secret in both the gateway and product.
3. Confirm the old secret can no longer call request/consume endpoints.
4. Review gateway Worker logs and Email Service logs.
5. Re-enable only after signed-request and E2E tests pass.

If the sender domain or Email Service account is compromised, keep AUTH_MAIL_ENABLED=false until domain authentication and account access are restored.

## Deployment rule

Do not enable AUTH_MAIL_ENABLED until sender-domain onboarding, Email Service binding, custom auth domain, application allowlist, shared secrets, and end-to-end tests all pass.
