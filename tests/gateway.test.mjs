import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { hmacHex } from "../src/crypto.js";
import { readFileSync } from "node:fs";

class FakeNamespace {
  constructor() { this.objects = new Map(); }
  idFromName(name) { return name; }
  get(name) {
    if (!this.objects.has(name)) this.objects.set(name, { record: null, events: [] });
    const object = this.objects.get(name);
    return {
      fetch: async (request) => {
        const url = new URL(request.url);
        const body = await request.json();
        if (url.pathname === "/record/create") {
          if (object.record) return Response.json({ error: "already_exists" }, { status: 409 });
          object.record = { ...body.record, used_at: null };
          return Response.json({ ok: true }, { status: 201 });
        }
        if (url.pathname === "/record/consume") {
          if (!object.record || object.record.used_at || object.record.expires_at <= Date.now()) return Response.json({ error: "not_found" }, { status: 404 });
          object.record.used_at = Date.now();
          return Response.json({ ok: true, record: object.record });
        }
        if (url.pathname === "/record/revoke") {
          object.record = null; object.events = [];
          return Response.json({ ok: true });
        }
        if (url.pathname === "/rate/check") {
          object.events = object.events.filter(ts => ts > body.now_ms - body.window_ms);
          if (object.events.length >= body.limit) return Response.json({ allowed: false, remaining: 0 }, { status: 429 });
          object.events.push(body.now_ms);
          return Response.json({ allowed: true, remaining: body.limit - object.events.length });
        }
        return Response.json({ error: "not_found" }, { status: 404 });
      }
    };
  }
}

const APP_SECRET = "S".repeat(48);

function env() {
  const sent = [];
  return {
    AUTH_MAIL_ENABLED: "true",
    FROM_EMAIL: "noreply@example.com",
    PUBLIC_BASE_URL: "https://auth.example.com",
    APPS_CONFIG_JSON: JSON.stringify({
      demandscope: {
        name: "DemandScope",
        callback_url: "https://app.example.com/api/auth-mail/callback"
      }
    }),
    APP_SHARED_SECRETS_JSON: JSON.stringify({ demandscope: APP_SECRET }),
    AUTH_STATE: new FakeNamespace(),
    EMAIL: {
      async send(message) { sent.push(message); return { messageId: "msg_test" }; }
    },
    _sent: sent
  };
}

async function signedRequest(path, body, e, { nonce = "nonce_1234567890abcdef", timestamp = String(Math.floor(Date.now() / 1000)) } = {}) {
  const raw = JSON.stringify(body);
  const signature = await hmacHex(APP_SECRET, `${timestamp}.${nonce}.${raw}`);
  return new Request("https://auth.example.com" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-auth-mail-app": "demandscope",
      "x-auth-mail-timestamp": timestamp,
      "x-auth-mail-nonce": nonce,
      "x-auth-mail-signature": signature
    },
    body: raw
  });
}

test("gateway is fail-closed until explicitly configured", async () => {
  const response = await worker.fetch(new Request("https://auth.example.com/health"), {
    AUTH_MAIL_ENABLED: "false",
    FROM_EMAIL: "noreply@example.invalid",
    APPS_CONFIG_JSON: "{}"
  });
  const body = await response.json();
  assert.equal(body.ready, false);
  assert.equal(body.enabled, false);
});

test("magic-link flow verifies email and returns a one-time assertion to the configured callback", async () => {
  const e = env();
  const request = await signedRequest("/v1/magic-link/request", { email: "Buyer@Example.com", state: "csrf_state_1", callback_url: "https://evil.example/" }, e);
  const created = await worker.fetch(request, e);
  assert.equal(created.status, 202);
  assert.equal(e._sent.length, 1);
  assert.equal(e._sent[0].to, "buyer@example.com");

  const verifyUrl = e._sent[0].text.match(/https:\/\/[^\s]+/)[0];
  const verified = await worker.fetch(new Request(verifyUrl), e);
  assert.equal(verified.status, 302);
  const callback = new URL(verified.headers.get("Location"));
  assert.equal(callback.origin, "https://app.example.com");
  assert.equal(callback.pathname, "/api/auth-mail/callback");
  assert.equal(callback.searchParams.get("state"), "csrf_state_1");
  assert.ok(callback.searchParams.get("code"));

  const code = callback.searchParams.get("code");
  const consume = await worker.fetch(await signedRequest("/v1/assertion/consume", { code }, e, { nonce: "nonce_2222222222222222" }), e);
  assert.equal(consume.status, 200);
  const result = await consume.json();
  assert.equal(result.verified, true);
  assert.equal(result.email, "buyer@example.com");

  const reuse = await worker.fetch(await signedRequest("/v1/assertion/consume", { code }, e, { nonce: "nonce_3333333333333333" }), e);
  assert.equal(reuse.status, 400);
});

test("signed app requests are replay protected", async () => {
  const e = env();
  const body = { email: "buyer@example.com" };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "nonce_replay_123456789";
  const first = await worker.fetch(await signedRequest("/v1/magic-link/request", body, e, { nonce, timestamp }), e);
  assert.equal(first.status, 202);
  const second = await worker.fetch(await signedRequest("/v1/magic-link/request", body, e, { nonce, timestamp }), e);
  assert.equal(second.status, 409);
});

test("per-email rate limit blocks the fourth request within 15 minutes", async () => {
  const e = env();
  for (let i = 0; i < 3; i++) {
    const res = await worker.fetch(await signedRequest("/v1/magic-link/request", { email: "rate@example.com" }, e, { nonce: `nonce_rate_${i}_1234567890` }), e);
    assert.equal(res.status, 202);
  }
  const fourth = await worker.fetch(await signedRequest("/v1/magic-link/request", { email: "rate@example.com" }, e, { nonce: "nonce_rate_4_1234567890" }), e);
  assert.equal(fourth.status, 429);
});


test("stale signed requests are rejected before sending email", async () => {
  const e = env();
  const stale = String(Math.floor(Date.now() / 1000) - 601);
  const res = await worker.fetch(
    await signedRequest("/v1/magic-link/request", { email: "buyer@example.com" }, e, {
      nonce: "nonce_stale_1234567890",
      timestamp: stale
    }),
    e
  );
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "stale_signature");
  assert.equal(e._sent.length, 0);
});

test("invalid HMAC signature is rejected before state or email work", async () => {
  const e = env();
  const raw = JSON.stringify({ email: "buyer@example.com" });
  const res = await worker.fetch(new Request("https://auth.example.com/v1/magic-link/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-auth-mail-app": "demandscope",
      "x-auth-mail-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-auth-mail-nonce": "nonce_invalid_123456789",
      "x-auth-mail-signature": "0".repeat(64)
    },
    body: raw
  }), e);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "invalid_signature");
  assert.equal(e._sent.length, 0);
});

test("configured names and subjects cannot inject HTML or mail headers", async () => {
  const e = env();
  e.APPS_CONFIG_JSON = JSON.stringify({
    demandscope: {
      name: "<img src=x onerror=alert(1)>\r\nInjected",
      subject: "Login\r\nBcc: attacker@example.com",
      callback_url: "https://app.example.com/api/auth-mail/callback"
    }
  });
  const res = await worker.fetch(
    await signedRequest("/v1/magic-link/request", { email: "buyer@example.com" }, e, {
      nonce: "nonce_escape_1234567890"
    }),
    e
  );
  assert.equal(res.status, 202);
  assert.equal(e._sent.length, 1);
  assert.ok(!/[\r\n]/.test(e._sent[0].subject));
  assert.match(e._sent[0].subject, /Login Bcc:/);
  assert.ok(!e._sent[0].html.includes("<img src=x"));
  assert.match(e._sent[0].html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("responses include anti-framing and no-store headers", async () => {
  const response = await worker.fetch(new Request("https://auth.example.com/health"), env());
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
});

test("committed Wrangler defaults remain fail-closed and contain no production sender", () => {
  const cfg = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(cfg.vars.AUTH_MAIL_ENABLED, "false");
  assert.match(cfg.vars.FROM_EMAIL, /\.invalid$/);
  assert.equal(cfg.vars.APPS_CONFIG_JSON, "{}");
  assert.equal("send_email" in cfg, false);
  assert.deepEqual(cfg.migrations[0].new_sqlite_classes, ["AuthState"]);
});
