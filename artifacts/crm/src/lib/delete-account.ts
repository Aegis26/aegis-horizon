import {
  deleteUserAccount,
  type UserAccountDeletionResponse,
} from "@workspace/api-client-react";

export const DELETE_ACCOUNT_CONFIRMATION = {
  confirmation: "DELETE",
} as const;

export function isDeleteAccountConfirmation(value: string): boolean {
  return value === DELETE_ACCOUNT_CONFIRMATION.confirmation;
}

/**
 * Keep the account deletion request on the generated API client. Its shared
 * custom transport supplies the Clerk session bearer/cookie behavior used by
 * the rest of the application and gives callers the API's explicit error
 * response.
 */
export function deleteAccount(): Promise<UserAccountDeletionResponse> {
  return deleteUserAccount(DELETE_ACCOUNT_CONFIRMATION);
}

export function getDeleteAccountErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "We could not delete your account. Nothing was deleted; check your connection and try again.";
}