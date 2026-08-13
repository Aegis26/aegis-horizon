import { Resend } from "resend";

/**
 * Send an email via Resend. The client is created per call (never cached) so
 * key rotation takes effect immediately.
 *
 * NOTE: until a sending domain is verified in Resend, Resend only allows
 * sending from onboarding@resend.dev and only to the account owner's email.
 * Set RESEND_FROM_EMAIL once a domain is verified.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
}): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const resend = new Resend(apiKey);
  const from =
    process.env.RESEND_FROM_EMAIL ?? "Aegis Horizon <onboarding@resend.dev>";

  const { data, error } = await resend.emails.send({
    from,
    to: [args.to],
    subject: args.subject,
    html: args.html,
    attachments: args.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });
  if (error) {
    throw new Error(`Resend: ${error.message}`);
  }
  return { id: data?.id ?? "" };
}
