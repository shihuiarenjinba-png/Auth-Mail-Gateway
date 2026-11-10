import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const config = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8");

function fail(message) {
  throw new Error(message);
}

if (config.name !== "auth-mail-gateway") fail("Unexpected Worker name.");
if (config.keep_vars !== true) fail("wrangler.jsonc must keep dashboard variables on deploy.");
if (Object.prototype.hasOwnProperty.call(config, "vars")) fail("Fail-closed config must not commit production vars.");
if (!Array.isArray(config.send_email) || !config.send_email.some(x => x?.name === "EMAIL")) fail("EMAIL send binding is required.");
const bindings = config?.durable_objects?.bindings || [];
if (!bindings.some(x => x?.name === "AUTH_STATE" && x?.class_name === "AuthState")) fail("AUTH_STATE Durable Object binding missing.");
const migrations = config?.migrations || [];
if (!migrations.some(x => Array.isArray(x?.new_sqlite_classes) && x.new_sqlite_classes.includes("AuthState"))) {
  fail("AuthState must use the SQLite Durable Object backend.");
}

const ignored = new Set([".git", "node_modules", ".wrangler-dist"]);
const patterns = [
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g,
  /\bwhsec_[A-Za-z0-9]{12,}\b/g
];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (ignored.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      walk(path);
      continue;
    }
    if (!st.isFile() || st.size > 2_000_000) continue;
    const text = readFileSync(path, "utf8");
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) fail(`Possible committed secret in ${relative(root, path)}`);
    }
  }
}
walk(root);

console.log("PASS preflight: fail-closed config, EMAIL binding, SQLite Durable Object, no obvious Stripe/Webhook secrets.");
