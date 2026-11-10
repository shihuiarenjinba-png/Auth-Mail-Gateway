function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export class AuthState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.storage = ctx.storage;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    let input = {};
    try { input = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }

    if (url.pathname === "/record/create") {
      const record = input?.record;
      const now = Date.now();
      if (!record || typeof record !== "object" || !Number.isInteger(record.expires_at) || record.expires_at <= now || record.expires_at > now + 24 * 60 * 60 * 1000) {
        return json({ error: "invalid_record" }, 400);
      }
      const existing = await this.storage.get("record");
      if (existing) return json({ error: "already_exists" }, 409);
      await this.storage.put("record", { ...record, used_at: null });
      if (this.storage.setAlarm) await this.storage.setAlarm(record.expires_at + 60_000);
      return json({ ok: true }, 201);
    }

    if (url.pathname === "/record/consume") {
      const now = Date.now();
      const record = await this.storage.get("record");
      if (!record || record.used_at || !Number.isInteger(record.expires_at) || record.expires_at <= now) {
        return json({ error: "not_found" }, 404);
      }
      record.used_at = now;
      await this.storage.put("record", record);
      return json({ ok: true, record });
    }

    if (url.pathname === "/record/revoke") {
      await this.storage.deleteAll();
      return json({ ok: true });
    }

    if (url.pathname === "/rate/check") {
      const now = Number(input?.now_ms);
      const windowMs = Number(input?.window_ms);
      const limit = Number(input?.limit);
      if (!Number.isFinite(now) || !Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > 24 * 60 * 60 * 1000 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return json({ error: "invalid_rate_request" }, 400);
      }
      const stored = await this.storage.get("events");
      const before = Array.isArray(stored) ? stored : [];
      const events = before.filter(ts => Number.isFinite(ts) && ts > now - windowMs);
      if (events.length >= limit) {
        await this.storage.put("events", events);
        return json({ allowed: false, remaining: 0 }, 429);
      }
      events.push(now);
      await this.storage.put("events", events);
      if (this.storage.setAlarm) await this.storage.setAlarm(now + windowMs + 60_000);
      return json({ allowed: true, remaining: Math.max(0, limit - events.length) });
    }

    return json({ error: "not_found" }, 404);
  }

  async alarm() {
    await this.storage.deleteAll();
  }
}
