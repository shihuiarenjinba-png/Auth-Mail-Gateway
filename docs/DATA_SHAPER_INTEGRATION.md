# Data Shaper integration — HOLD until backend entitlement exists

Data Shaper can reuse this shared Auth Mail Gateway, but it must not be registered as a live application yet.

## Intended app identity

- app_id: `data-shaper`
- gateway responsibility: prove that the user can receive email at the requested address
- Data Shaper responsibility: verify the Stripe entitlement before requesting mail and again after consuming the assertion
- Gateway must never receive Data Shaper Stripe secrets

## Required Data Shaper backend before registration

Data Shaper is currently a browser-first Vite application. Before enabling cross-device Pro recovery, add a server-side backend that can:

1. verify the Data Shaper Stripe Product/Price and active subscription,
2. issue HMAC-signed requests to this Gateway,
3. hold `AUTH_MAIL_APP_SECRET` only on the server,
4. validate callback state,
5. consume the one-time Gateway assertion,
6. re-check the Stripe entitlement,
7. issue a Data Shaper-specific HttpOnly session/cookie.

Do not expose the shared secret in browser JavaScript.

## Future Gateway app entry

Only after the backend callback exists:

```json
{
  "data-shaper": {
    "name": "Data Shaper",
    "callback_url": "https://YOUR_DATA_SHAPER_DOMAIN/api/auth-mail/callback",
    "subject": "Data Shaper Pro login link / ログインリンク"
  }
}
```

Generate a separate per-app secret:

```bash
npm run generate:app-secret
```

Never reuse the DemandScope secret.

## Activation gate

Keep Data Shaper registration disabled until all of the following are true:

- Stripe Test Product/Price exists for Data Shaper
- entitlement verification endpoint is tested
- callback endpoint is live
- custom Data Shaper production domain is known
- Gateway sender domain is ready
- Gateway `/health` is ready
- Test-mode end-to-end recovery passes

No production billing or production email should be enabled as part of this document alone.
