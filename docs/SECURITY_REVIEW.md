# Security review

## Trust model

Auth Mail Gateway proves possession of an email inbox. It does not grant product entitlement.

Each product:
1. verifies its own Stripe entitlement before asking the gateway to email,
2. verifies Stripe entitlement again after consuming a gateway assertion,
3. issues its own application session.

The gateway never receives Stripe secret keys.

## Controls implemented

- Fail-closed default configuration.
- HMAC-SHA256 authentication for server-to-server calls.
- Five-minute timestamp skew window.
- One-time nonce replay protection.
- Request body limit.
- Fixed callback allowlist; request bodies cannot choose redirect destinations.
- Ten-minute, one-time Magic Link.
- Two-minute, one-time assertion.
- Per-app/per-email rate limiting.
- Normalized email addresses.
- HTML escaping for app display names and verification URLs.
- Newline/control-character stripping from display names and email subjects.
- Anti-framing / no-store / no-referrer response headers.
- No raw Magic Link tokens stored in product databases.
- No Stripe credentials in the gateway.
- Separate `configured`, `enabled`, and `ready` health states.

## Residual risks

- Magic Links are bearer credentials. Anyone who obtains a live link before first use can use it.
- Email-account compromise defeats email-possession authentication.
- Timing differences at the product layer may provide weak signals about whether a subscription exists; public responses remain intentionally identical.
- Deliverability depends on sender-domain reputation, SPF/DKIM/DMARC, suppression lists, and Cloudflare Email Service availability.
- Application shared secrets must be rotated if exposed.
- The email transport token, if using REST mode, can send mail for onboarded domains in that Cloudflare account and must be tightly scoped/protected.

## Operational requirements

- Use a unique app shared secret per product.
- Keep Cloudflare and product secrets only in platform secret stores.
- Do not add arbitrary callback URLs dynamically.
- Review Email Service delivery/suppression logs after launch.
- Rotate the REST API token if staff/access changes.
- Re-run CI and Wrangler dry-run after any binding or Durable Object configuration change.
