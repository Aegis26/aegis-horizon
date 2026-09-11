/**
 * Resolve Clerk's redirect context without allowing a protocol-relative or
 * slash-backslash URL to escape the current origin.
 *
 * `new URL()` is intentionally used for host parsing: browsers treat
 * backslashes as URL separators, so checking only for a leading "/" is not
 * sufficient for values such as `/\evil.example`.
 */
export function getSafeAuthRedirectUrl(
  requested: string | null,
  defaultPath: string,
  origin: string,
): string {
  if (!requested) return defaultPath;

  // Keep the existing contract of accepting absolute paths, plus
  // same-origin absolute URLs. Reject backslashes before URL normalization so
  // they cannot be converted into host separators by the parser.
  const isAbsoluteUrl = /^[a-z][a-z\d+.-]*:/i.test(requested);
  if ((!requested.startsWith("/") && !isAbsoluteUrl) || requested.includes("\\")) {
    return defaultPath;
  }

  try {
    const base = new URL(origin);
    const parsed = new URL(requested, base);
    if (parsed.origin !== base.origin) return defaultPath;

    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!path.startsWith("/") || path.startsWith("//")) return defaultPath;
    return path;
  } catch {
    return defaultPath;
  }
}

export function isInvitationAuthRedirect(redirectUrl: string, basePath: string): boolean {
  const normalizedBase = basePath.replace(/\/$/, "");
  const path = redirectUrl.split(/[?#]/, 1)[0];
  return path === `${normalizedBase}/invite` || path === "/invite";
}