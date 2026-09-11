export type ClerkEmailAddressLike = {
  emailAddress: string;
  verification?: { status?: string | null } | null;
};

/** Only Clerk-verified addresses may claim a pre-provisioned local user. */
export function verifiedClerkEmails(clerkUser: {
  emailAddresses?: readonly ClerkEmailAddressLike[];
}): string[] {
  return [
    ...new Set(
      (clerkUser.emailAddresses ?? [])
        .filter((email) => email.verification?.status === "verified")
        .map((email) => email.emailAddress.toLowerCase().trim())
        .filter(Boolean),
    ),
  ];
}

export function isPendingUserForVerifiedEmail(
  user: { clerkId: string; email: string },
  verifiedEmails: readonly string[],
): boolean {
  const email = user.email.toLowerCase().trim();
  return (
    user.clerkId === `pending:${email}` &&
    verifiedEmails.some((verifiedEmail) => verifiedEmail.toLowerCase() === email)
  );
}