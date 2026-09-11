import { Resend } from "resend";

/**
 * Send an email via Resend. The client is created per call (never cached) so
 * key rotation takes effect immediately.
 *
 * The aegishz.com sending domain must be verified in Resend.
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
  const { data, error } = await resend.emails.send({
    from: "Aegis Horizon <noreply@aegishz.com>",
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
