import { DeleteUserAccountBody } from "@workspace/api-zod";

/** The endpoint deliberately accepts no client-supplied identity fields. */
export function parseExactAccountDeletionBody(body: unknown) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1
  ) {
    return null;
  }
  const parsed = DeleteUserAccountBody.safeParse(body);
  return parsed.success ? parsed.data : null;
}