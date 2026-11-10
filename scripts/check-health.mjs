const input = process.env.AUTH_MAIL_GATEWAY_URL || process.argv[2] || "";
let base;
try {
  const url = new URL(input);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname))) {
    throw new Error("Gateway URL must use HTTPS");
  }
  base = url.origin;
} catch {
  console.error("Usage: AUTH_MAIL_GATEWAY_URL=https://auth.example.com npm run verify:remote");
  process.exit(2);
}

const response = await fetch(base + "/health", { headers: { Accept: "application/json" } });
let body = {};
try { body = await response.json(); } catch {}

console.log(JSON.stringify({
  http_status: response.status,
  service: body.service || null,
  enabled: body.enabled === true,
  ready: body.ready === true,
  email_provider: body.email_provider || null,
  state_ready: body.state_ready === true,
  sender_domain: body.sender_domain || null,
  public_base_url_configured: body.public_base_url_configured === true,
  configured_apps: Number(body.configured_apps || 0)
}, null, 2));

if (!response.ok || body.service !== "auth-mail-gateway") process.exit(3);
if (body.ready !== true) process.exit(4);
