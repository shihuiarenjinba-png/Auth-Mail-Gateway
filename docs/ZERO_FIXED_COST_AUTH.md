# Zero-fixed-cost authentication architecture

## Decision

For pre-revenue products, do not require a paid transactional-email plan or a self-hosted residential SMTP server as the primary authentication path.

Preferred primary identity provider:

- Microsoft Entra External ID
- email one-time passcode for customer sign-up/sign-in
- hosted/browser-delegated authentication
- Stripe remains the product entitlement authority

The existing Auth Mail Gateway remains fail-closed and can be retained as an optional future fallback for branded magic-link email after revenue justifies a sender domain / email plan.

## Why not a residential/local SMTP server

A PC that stays online can run application code, but reliable public email delivery is a different problem.

A public sender still normally needs:

- a globally registered public domain
- public DNS
- SPF
- DKIM
- DMARC
- stable sender reputation
- preferably static public IP and reverse DNS / PTR
- outbound SMTP connectivity that is not blocked by the ISP

A locally invented domain is not routable on the public Internet. A residential/dynamic IP also creates a high spam/deliverability risk. Power, reboot, ISP, NAT, and local maintenance become authentication outages.

Therefore the local PC may be used for operator tooling, backups, log review, or emergency maintenance, but not as the sole production identity-email dependency.

## Zero-fixed-cost customer login flow

1. User opens product.
2. Product redirects to Microsoft Entra External ID.
3. User enters any supported email address.
4. Microsoft sends the one-time passcode.
5. Entra returns a signed identity token to the product callback.
6. Product backend validates issuer/audience/nonce/state.
7. Product resolves the verified identity to its internal customer record.
8. Product verifies the Stripe Product/Price/subscription.
9. Product issues its own HttpOnly session/cookie.
10. Stripe is checked again for sensitive entitlement changes.

The product must not infer Pro access from email verification alone.

## Stripe boundary

Stripe remains responsible for:

- Customer
- Product / Price
- subscription status
- billing portal
- cancellation / payment state

Stripe Customer Portal login is for billing management. It is not used as the application's general identity token.

## Auth Mail Gateway status

Keep:

- AUTH_MAIL_ENABLED=false
- Durable Object safety code
- HMAC/replay/rate-limit implementation
- Magic-Link implementation
- Email binding code

Do not require:

- Workers Paid Email Sending
- custom sender domain
- branded noreply sender

until revenue or product requirements justify them.

## Optional alternatives

### Cloudflare Access OTP

Useful for private beta / operator access. The Free Zero Trust plan is limited to fewer than 50 users, so it is not the long-term customer CIAM path.

### AWS SES

No fixed monthly commitment; pay per email. Still requires a public verified sender identity/domain for proper production mail.

### Resend

Free tier can be useful for early transactional mail, but branded production sending still introduces sender-domain management and provider dependency.

## Local machine role

The always-on local PC can be useful as a non-critical operator node:

- scheduled health checks
- offline backups
- deployment evidence collection
- reconciliation jobs
- emergency admin scripts

Never make customer authentication depend exclusively on that PC being online.

## Activation gate

Do not switch runtime authentication until:

- Entra External ID external tenant exists
- email OTP flow works in test
- callback is implemented
- token validation is tested
- Stripe entitlement binding is tested
- inactive/cancelled subscription denial is tested
- session cookie behavior is tested
- logout and recovery are tested

Until then, current Auth Mail Gateway remains disabled.
