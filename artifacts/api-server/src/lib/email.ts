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
  if (!data?.id) {
    throw new Error("Resend did not return a message id");
  }
  return { id: data.id };
}

export type EmailSender = (args: {
  to: string;
  subject: string;
  html: string;
}) => Promise<{ id: string }>;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

/**
 * Sends an invitation for an already-created membership. The URL is supplied
 * by the invitation route and contains a signed, seven-day token. Do not put
 * raw membership or invitation tokens in the database.
 */
export async function sendInvitationEmail(
  email: string,
  orgName: string,
  invitationLink: string,
  sender: EmailSender = sendEmail,
): Promise<{ id: string }> {
  const safeOrgName = escapeHtml(orgName);
  const safeInvitationLink = escapeHtml(invitationLink);
  const subjectOrgName = orgName.replace(/[\r\n]+/g, " ").trim().slice(0, 160);

  const result = await sender({
    to: email,
    subject: `You're invited to join ${subjectOrgName || "Aegis Horizon"}`,
    html: `
      <h1>Welcome to Aegis Horizon</h1>
      <p>You've been invited to join <strong>${safeOrgName}</strong>.</p>
      <p><a href="${safeInvitationLink}">Click here to accept your invitation</a></p>
      <p>This link expires in 7 days. If it expires, ask an organization administrator to send the invitation again.</p>
    `,
  });
  if (!result?.id) {
    throw new Error("Email provider did not return a message id");
  }
  return result;
}
