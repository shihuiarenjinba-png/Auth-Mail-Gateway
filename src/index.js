import { AuthState } from "./state.js";
import { appConfig, appSecret, gatewayStatus, normalizeEmail, publicBaseUrl, senderEmail } from "./config.js";
import { hmacHex, randomToken, safeEqual, sha256Hex, validOpaqueToken } from "./crypto.js";
import { sendTransactionalEmail } from "./email.js";

export { AuthState };

const MAGIC_TTL_MS = 10 * 60 * 1000;
const ASSERTION_TTL_MS = 2 * 60 * 1000;
const SIGNATURE_SKEW_SECONDS = 300;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 3;

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function securityHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: securityHeaders("application/json; charset=utf-8")
  });
}

function safeHtml(message, status = 200) {
  return new Response(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Auth Mail Gateway</title><body style="font-family:system-ui;max-width:640px;margin:60px auto;padding:0 20px"><h1>Auth Mail Gateway</h1><p>${message}</p></body></html>`,
    { status, headers: securityHeaders("text/html; charset=utf-8") }
  );
}

function stateStub(env, name) {
  if (!env?.AUTH_STATE?.idFromName || !env?.AUTH_STATE?.get) throw new HttpError(503, "state_not_configured");
  return env.AUTH_STATE.get(env.AUTH_STATE.idFromName(name));
}

async function stateCall(env, name, path, body) {
  const response = await stateStub(env, name).fetch(
    new Request(`https://auth-state.internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    })
  );
  let data = {};
  try { data = await response.json(); } catch {}
  return { response, data };
}

async function createRecord(env, name, record) {
  return stateCall(env, name, "/record/create", { record });
}

async function consumeRecord(env, name) {
  return stateCall(env, name, "/record/consume", {});
}

async function revokeRecord(env, name) {
  return stateCall(env, name, "/record/revoke", {});
}

async function checkRate(env, name) {
  return stateCall(env, name, "/rate/check", {
    now_ms: Date.now(),
    window_ms: RATE_WINDOW_MS,
    limit: RATE_LIMIT
  });
}

async function readSignedJson(request, env) {
  const raw = await request.text();
  if (raw.length > 16_384) throw new HttpError(413, "request_too_large");

  const appId = request.headers.get("x-auth-mail-app") || "";
  const timestampRaw = request.headers.get("x-auth-mail-timestamp") || "";
  const nonce = request.headers.get("x-auth-mail-nonce") || "";
  const signature = (request.headers.get("x-auth-mail-signature") || "").toLowerCase();
  const app = appConfig(env, appId);
  const secret = appSecret(env, appId);

  if (!app || !secret) throw new HttpError(401, "unknown_app");
  if (!/^\d{10,13}$/.test(timestampRaw) || !/^[A-Za-z0-9_-]{16,96}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) {
    throw new HttpError(401, "invalid_signature_headers");
  }

  const timestamp = Number(timestampRaw);
  const timestampSeconds = timestamp > 10_000_000_000 ? Math.floor(timestamp / 1000) : timestamp;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > SIGNATURE_SKEW_SECONDS) throw new HttpError(401, "stale_signature");

  const expected = await hmacHex(secret, `${timestampRaw}.${nonce}.${raw}`);
  if (!safeEqual(expected, signature)) throw new HttpError(401, "invalid_signature");

  const nonceHash = await sha256Hex(`${appId}:${nonce}`);
  const replay = await createRecord(env, `replay:${nonceHash}`, {
    kind: "replay",
    app_id: appId,
    expires_at: Date.now() + SIGNATURE_SKEW_SECONDS * 1000
  });
  if (replay.response.status === 409) throw new HttpError(409, "replayed_request");
  if (!replay.response.ok) throw new HttpError(503, "state_error");

  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, "invalid_json"); }
  return { app, appId, body };
}

function emailBody(app, verifyUrl) {
  const safeName = escapeHtml(app.name);
  const safeUrl = escapeHtml(verifyUrl);
  const text = `${app.name} の本人確認リンクです。10分以内に開いてください。\n\n${verifyUrl}\n\nこの操作に心当たりがない場合は、このメールを無視してください。\n\nThis is your ${app.name} verification link. It expires in 10 minutes and can be used once.`;
  const html = `<p><strong>${safeName}</strong> の本人確認リンクです。</p><p><a href="${safeUrl}">本人確認を続ける / Continue verification</a></p><p>このリンクは10分間・1回限り有効です。</p><p>This link expires in 10 minutes and can be used once.</p><p>心当たりがない場合は、このメールを無視してください。</p>`;
  return { text, html };
}

async function requestMagicLink(request, env) {
  const status = gatewayStatus(env);
  if (!status.ready) throw new HttpError(503, "gateway_not_ready");

  const { app, appId, body } = await readSignedJson(request, env);
  const email = normalizeEmail(body?.email);
  if (!email) throw new HttpError(400, "invalid_email");
  const state = body?.state == null ? "" : String(body.state);
  if (state.length > 256) throw new HttpError(400, "state_too_long");

  const emailHash = await sha256Hex(email);
  const rate = await checkRate(env, `rate:${appId}:${emailHash}`);
  if (rate.response.status === 429) throw new HttpError(429, "rate_limited");
  if (!rate.response.ok) throw new HttpError(503, "state_error");

  const rawToken = randomToken();
  const tokenHash = await sha256Hex(rawToken);
  const created = await createRecord(env, `magic:${tokenHash}`, {
    kind: "magic",
    app_id: appId,
    email,
    email_hash: emailHash,
    state,
    expires_at: Date.now() + MAGIC_TTL_MS
  });
  if (!created.response.ok) throw new HttpError(503, "state_error");

  const base = publicBaseUrl(env, request);
  if (!base) {
    await revokeRecord(env, `magic:${tokenHash}`);
    throw new HttpError(503, "public_base_url_invalid");
  }
  const verifyUrl = `${base}/v1/magic-link/verify?token=${encodeURIComponent(rawToken)}`;
  const content = emailBody(app, verifyUrl);

  try {
    await sendTransactionalEmail(env, {
      to: email,
      subject: app.subject,
      text: content.text,
      html: content.html
    });
  } catch {
    await revokeRecord(env, `magic:${tokenHash}`);
    throw new HttpError(502, "email_send_failed");
  }

  return json({ accepted: true, expires_in_seconds: MAGIC_TTL_MS / 1000 }, 202);
}

async function verifyMagicLink(request, env) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!validOpaqueToken(token)) return safeHtml("リンクが無効または期限切れです。", 400);

  const tokenHash = await sha256Hex(token);
  const consumed = await consumeRecord(env, `magic:${tokenHash}`);
  if (!consumed.response.ok) return safeHtml("リンクが無効または期限切れです。", 400);
  const record = consumed.data?.record;
  if (!record || record.kind !== "magic" || !record.app_id || !record.email) return safeHtml("リンクが無効です。", 400);

  const app = appConfig(env, record.app_id);
  if (!app) return safeHtml("このサービスの設定が無効です。", 400);

  const code = randomToken();
  const codeHash = await sha256Hex(code);
  const created = await createRecord(env, `assertion:${codeHash}`, {
    kind: "assertion",
    app_id: record.app_id,
    email: record.email,
    verified_at: Date.now(),
    state: typeof record.state === "string" ? record.state : "",
    expires_at: Date.now() + ASSERTION_TTL_MS
  });
  if (!created.response.ok) return safeHtml("認証結果の作成に失敗しました。", 503);

  const callback = new URL(app.callback_url);
  callback.searchParams.set("code", code);
  if (record.state) callback.searchParams.set("state", record.state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: callback.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function consumeAssertion(request, env) {
  const status = gatewayStatus(env);
  if (!status.ready) throw new HttpError(503, "gateway_not_ready");
  const { appId, body } = await readSignedJson(request, env);
  const code = body?.code;
  if (!validOpaqueToken(code)) throw new HttpError(400, "invalid_code");

  const codeHash = await sha256Hex(code);
  const consumed = await consumeRecord(env, `assertion:${codeHash}`);
  if (!consumed.response.ok) throw new HttpError(400, "invalid_or_expired_code");
  const record = consumed.data?.record;
  if (!record || record.kind !== "assertion" || record.app_id !== appId || !normalizeEmail(record.email)) {
    throw new HttpError(403, "assertion_app_mismatch");
  }
  return json({
    verified: true,
    email: record.email,
    verified_at: record.verified_at
  });
}

function health(env) {
  const status = gatewayStatus(env);
  return json({
    service: "auth-mail-gateway",
    version: "0.1.0",
    enabled: status.enabled,
    configured: status.configured,
    ready: status.ready,
    email_provider: status.email_provider,
    state_ready: status.state_ready,
    sender_domain: status.sender_domain,
    configured_apps: status.configured_apps,
    magic_link_ttl_seconds: MAGIC_TTL_MS / 1000,
    assertion_ttl_seconds: ASSERTION_TTL_MS / 1000
  });
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return health(env);
  if (request.method === "GET" && url.pathname === "/") {
    return json({ service: "auth-mail-gateway", status: gatewayStatus(env).ready ? "ready" : "disabled" });
  }
  if (request.method === "POST" && url.pathname === "/v1/magic-link/request") return requestMagicLink(request, env);
  if (request.method === "GET" && url.pathname === "/v1/magic-link/verify") return verifyMagicLink(request, env);
  if (request.method === "POST" && url.pathname === "/v1/assertion/consume") return consumeAssertion(request, env);
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code }, error.status);
      return json({ error: "internal_error" }, 500);
    }
  }
};
