function parseObject(value) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : appId;
  const subject = typeof raw.subject === "string" && raw.subject.trim()
    ? raw.subject.trim().slice(0, 120)
    : `${name} login link / ログインリンク`;
  return { id: appId, name, callback_url: callback.toString(), subject };
}

export function appSecret(env, appId) {
  const all = parseObject(env?.APP_SHARED_SECRETS_JSON);
  const secret = all[appId];
  return typeof secret === "string" && secret.trim().length >= 32 ? secret.trim() : null;
}

export function configuredPublicBaseUrl(env) {
  const configured = typeof env?.PUBLIC_BASE_URL === "string" ? env.PUBLIC_BASE_URL.trim() : "";
  if (!configured) return null;
  const parsed = validHttpsUrl(configured, true);
  if (!parsed || parsed.pathname !== "/" || parsed.search) return null;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (!local && (/(?:^|\.)workers\.dev$/i.test(parsed.hostname) || /(?:^|\.)pages\.dev$/i.test(parsed.hostname))) return null;
  return parsed.origin;
}

export function publicBaseUrl(env, request) {
  const configured = configuredPublicBaseUrl(env);
  if (configured) return configured;
  try {
    const url = new URL(request.url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!local || url.protocol !== "http:") return null;
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
  const baseUrl = configuredPublicBaseUrl(env);
  const appIds = Object.keys(apps).filter(id => appConfig(env, id) && appSecret(env, id));
  return {
    enabled,
    ready: enabled && !!sender && !!baseUrl && stateReady && provider !== "none" && appIds.length > 0,
    sender_domain: sender ? sender.split("@")[1] : null,
    public_base_url: baseUrl,
    public_base_url_configured: !!baseUrl,
    email_provider: provider,
    state_ready: stateReady,
    configured_apps: appIds.length
  };
}
