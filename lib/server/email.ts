import "server-only";
// Transactional email through Resend's public API, from your own verified domain.
// Without RESEND_API_KEY the message is logged (template name only, no addresses or content).

export async function sendEmail(to: string, subject: string, text: string, template: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    console.info(`[email] not configured; skipped "${template}"`);
    return { sent: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) console.error(`[email] "${template}" failed with ${res.status}`);
  return { sent: res.ok };
}
