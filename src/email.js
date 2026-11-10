import { emailProvider, senderEmail } from "./config.js";

export async function sendTransactionalEmail(env, { to, subject, text, html }) {
  const from = senderEmail(env);
  if (!from || emailProvider(env) !== "binding") throw new Error("Email binding is not configured");
  return env.EMAIL.send({ to, from, subject, text, html });
}
