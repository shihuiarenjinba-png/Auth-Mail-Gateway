import { emailProvider, senderEmail } from "./config.js";

export async function sendTransactionalEmail(env, { to, subject, text, html }) {
  const from = senderEmail(env);
  const provider = emailProvider(env);
  if (!from || provider === "none") throw new Error("Email provider is not configured");

  if (provider === "binding") {
    return env.EMAIL.send({ to, from, subject, text, html });
  }

  const account = String(env.CLOUDFLARE_EMAIL_ACCOUNT_ID).trim();
  const token = String(env.CLOUDFLARE_EMAIL_API_TOKEN).trim();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ to, from, subject, text, html })
    }
  );
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok || body?.success === false) {
    throw new Error("Cloudflare Email Service rejected the message");
  }
  return body?.result || null;
}
