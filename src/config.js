function parseObject(value) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function singleLine(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function validHttpsUrl(value, allowLocal = false) {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:" && local)) return null;
    if (url.username || url.password || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function senderEmail(env) {
  const email = normalizeEmail(env?.FROM_EMAIL);
  if (!email) return null;
  const domain = email.split("@")[1];
  if (/(?:^|\.)pages\.dev$/i.test(domain) || /(?:^|\.)workers\.dev$/i.test(domain) || /\.invalid$/i.test(domain)) return null;
  return email;
}

export function appConfig(env, appId) {
  if (typeof appId !== "string" || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(appId)) return null;
  const all = parseObject(env?.APPS_CONFIG_JSON);
  const raw = all[appId];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const callback = validHttpsUrl(raw.callback_url, true);
  if (!callback || callback.search) return null;
  const name = singleLine(raw.name, 80) || appId;
  const subject = singleLine(raw.subject, 120) || `${name} login link / ログインリンク`;
  return { id: appId, name, callback_url: callback.toString(), subject };
}

export function appSecret(env, appId) {
  const all = parseObject(env?.APP_SHARED_SECRETS_JSON);
  const secret = all[appId];
  return typeof secret === "string" && secret.trim().length >= 32 ? secret.trim() : null;
}

export function publicBaseUrl(env, request) {
  const configured = typeof env?.PUBLIC_BASE_URL === "string" ? env.PUBLIC_BASE_URL.trim() : "";
  if (configured) {
    const parsed = validHttpsUrl(configured, true);
    if (!parsed || parsed.pathname !== "/" || parsed.search) return null;
    return parsed.origin;
  }
  try {
    const url = new URL(request.url);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function emailProvider(env) {
  if (env?.EMAIL && typeof env.EMAIL.send === "function") return "binding";
  const account = String(env?.CLOUDFLARE_EMAIL_ACCOUNT_ID || "").trim();
  const token = String(env?.CLOUDFLARE_EMAIL_API_TOKEN || "").trim();
  if (/^[a-f0-9]{32}$/i.test(account) && token.length >= 20) return "rest";
  return "none";
}

export function gatewayStatus(env) {
  const apps = parseObject(env?.APPS_CONFIG_JSON);
  const enabled = env?.AUTH_MAIL_ENABLED === "true";
  const sender = senderEmail(env);
  const stateReady = !!env?.AUTH_STATE?.idFromName && !!env?.AUTH_STATE?.get;
  const provider = emailProvider(env);
  const appIds = Object.keys(apps).filter(id => appConfig(env, id) && appSecret(env, id));
  const configured = !!sender && stateReady && provider !== "none" && appIds.length > 0;
  return {
    enabled,
    configured,
    ready: enabled && configured,
    sender_domain: sender ? sender.split("@")[1] : null,
    email_provider: provider,
    state_ready: stateReady,
    configured_apps: appIds.length
  };
}
