const enc = new TextEncoder();

export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function randomToken(size = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(value))));
  return Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(String(value))));
  return Array.from(signed, b => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function validOpaqueToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,96}$/.test(value);
}
