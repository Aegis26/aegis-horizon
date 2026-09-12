import { getActiveWindowSessionToken } from "@/lib/window-auth";

/**
 * Browser navigations cannot attach the per-window session header. Fetch the
 * authorized bytes explicitly, then open a short-lived Blob URL without
 * exposing the session capability in a URL or relying on cookies.
 */
export async function openAuthenticatedDownload(url: string): Promise<void> {
  const token = getActiveWindowSessionToken();
  if (!token) throw new Error("Your window session has ended.");
  const response = await fetch(url, {
    credentials: "omit",
    headers: { "x-aegis-window-session": token },
  });
  if (!response.ok) throw new Error("The download could not be authorized.");
  const blobUrl = URL.createObjectURL(await response.blob());
  window.open(blobUrl, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}