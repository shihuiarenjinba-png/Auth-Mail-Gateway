import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { hmacHex } from "../src/crypto.js";

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
        callback_url: "https://app.example.com/api/magic-link/callback"
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

test("gateway refuses readiness without an explicit non-platform public auth domain", async () => {
  const noBase = env();
  delete noBase.PUBLIC_BASE_URL;
  let response = await worker.fetch(new Request("https://gateway.workers.dev/health"), noBase);
  let body = await response.json();
  assert.equal(body.ready, false);
  assert.equal(body.public_base_url_configured, false);

  const platformBase = env();
  platformBase.PUBLIC_BASE_URL = "https://gateway.workers.dev";
  response = await worker.fetch(new Request("https://gateway.workers.dev/health"), platformBase);
  body = await response.json();
  assert.equal(body.ready, false);
  assert.equal(body.public_base_url_configured, false);

  const custom = env();
  response = await worker.fetch(new Request("https://auth.example.com/health"), custom);
  body = await response.json();
  assert.equal(body.ready, true);
  assert.equal(body.public_base_url_configured, true);
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
  assert.equal(callback.pathname, "/api/magic-link/callback");
  assert.equal(callback.searchParams.get("state"), "csrf_state_1");
  assert.equal(callback.searchParams.has("email"), false);
  assert.ok(callback.searchParams.get("code"));

  const reusedMagic = await worker.fetch(new Request(verifyUrl), e);
  assert.equal(reusedMagic.status, 400);

  const code = callback.searchParams.get("code");
  const consume = await worker.fetch(await signedRequest("/v1/assertion/consume", { code }, e, { nonce: "nonce_2222222222222222" }), e);
  assert.equal(consume.status, 200);
  const result = await consume.json();
  assert.equal(result.verified, true);
  assert.equal(result.email, "buyer@example.com");

  const reuse = await worker.fetch(await signedRequest("/v1/assertion/consume", { code }, e, { nonce: "nonce_3333333333333333" }), e);
  assert.equal(reuse.status, 400);
});


test("tampered and stale signed requests are rejected before email send", async () => {
  const e = env();
  const original = await signedRequest("/v1/magic-link/request", { email: "buyer@example.com" }, e, { nonce: "nonce_tamper_1234567890" });
  const tampered = new Request(original.url, {
    method: "POST",
    headers: original.headers,
    body: JSON.stringify({ email: "attacker@example.com" })
  });
  let response = await worker.fetch(tampered, e);
  assert.equal(response.status, 401);
  assert.equal(e._sent.length, 0);

  const stale = String(Math.floor(Date.now() / 1000) - 1000);
  response = await worker.fetch(
    await signedRequest("/v1/magic-link/request", { email: "buyer@example.com" }, e, {
      nonce: "nonce_stale_12345678901",
      timestamp: stale
    }),
    e
  );
  assert.equal(response.status, 401);
  assert.equal(e._sent.length, 0);
});

test("oversized state is rejected and cannot create a magic link", async () => {
  const e = env();
  const response = await worker.fetch(
    await signedRequest("/v1/magic-link/request", { email: "buyer@example.com", state: "x".repeat(257) }, e, {
      nonce: "nonce_state_12345678901"
    }),
    e
  );
  assert.equal(response.status, 400);
  assert.equal(e._sent.length, 0);
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


test("configured display text cannot inject email headers or HTML", async () => {
  const e = env();
  e.APPS_CONFIG_JSON = JSON.stringify({
    demandscope: {
      name: 'Demo <img src=x onerror=alert(1)>',
      subject: 'Login\r\nBcc: attacker@example.com',
      callback_url: 'https://app.example.com/api/magic-link/callback'
    }
  });

  const response = await worker.fetch(
    await signedRequest("/v1/magic-link/request", { email: "buyer@example.com" }, e, {
      nonce: "nonce_escape_1234567890"
    }),
    e
  );

  assert.equal(response.status, 202);
  assert.equal(e._sent.length, 1);
  assert.equal(e._sent[0].subject.includes("\r"), false);
  assert.equal(e._sent[0].subject.includes("\n"), false);
  assert.match(e._sent[0].html, /Demo &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(e._sent[0].html.includes("<img src=x"), false);
});


test("gateway is not ready without the Cloudflare EMAIL binding", async () => {
  const e = env();
  delete e.EMAIL;
  const response = await worker.fetch(new Request("https://auth.example.com/health"), e);
  const body = await response.json();
  assert.equal(body.ready, false);
  assert.equal(body.email_provider, "none");
});

test("production configuration rejects a localhost application callback", async () => {
  const e = env();
  e.APPS_CONFIG_JSON = JSON.stringify({
    demandscope: {
      name: "DemandScope",
      callback_url: "http://localhost:8788/api/magic-link/callback"
    }
  });
  const response = await worker.fetch(new Request("https://auth.example.com/health"), e);
  const body = await response.json();
  assert.equal(body.ready, false);
  assert.equal(body.configured_apps, 0);
});
