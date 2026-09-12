import { useEffect, useState } from "react";
import { useAuth, useClerk } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOrgStore } from "@/store/org-store";
import { purgeQueuedLeadsForUser } from "@/lib/offline-leads";
import {
  DELETE_ACCOUNT_CONFIRMATION,
  deleteAccount,
  getDeleteAccountErrorMessage,
  isDeleteAccountConfirmation,
} from "@/lib/delete-account";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function DeleteAccountDangerZone() {
  const { userId } = useAuth();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setOpen(false);
    setConfirmation("");
    setError(null);
    setIsDeleting(false);
  }, [userId]);

  const resetDialog = () => {
    if (isDeleting) return;
    setOpen(false);
    setConfirmation("");
    setError(null);
  };

  const clearDeletedAccountState = async () => {
    if (userId) {
      try {
        await purgeQueuedLeadsForUser(userId);
      } catch (cleanupError) {
        // The server has already completed the destructive operation. Local
        // cleanup is best effort and must not cause another delete attempt.
        console.warn("Could not clear deleted account's offline drafts.", cleanupError);
      }
    }

    try {
      queryClient.clear();
    } catch (cleanupError) {
      console.warn("Could not clear the deleted account's query cache.", cleanupError);
    }

    try {
      setSelectedOrgId(null);
    } catch (cleanupError) {
      console.warn("Could not clear the selected organization.", cleanupError);
    }
  };

  const handleDelete = async () => {
    if (!isDeleteAccountConfirmation(confirmation) || isDeleting) {
      setError(`Type ${DELETE_ACCOUNT_CONFIRMATION.confirmation} exactly to confirm.`);
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const response = await deleteAccount();
      if (response?.success !== true) {
        throw new Error("The account deletion response was incomplete. Please try again.");
      }

      await clearDeletedAccountState();

      // Clerk may already have invalidated the session as part of the server
      // operation. Sign-out is intentionally best effort: once the API has
      // confirmed deletion, never report failure or repeat the destructive API.
      try {
        await signOut();
      } catch (signOutError) {
        console.warn("Account deleted, but Clerk sign-out did not complete.", signOutError);
      }

      window.location.assign(`${basePath}/sign-up`);
    } catch (caughtError) {
      setError(getDeleteAccountErrorMessage(caughtError));
      setIsDeleting(false);
    }
  };

  return (
    <section
      aria-labelledby="delete-account-danger-zone-heading"
      className="border-t border-destructive/40 pt-8"
      data-testid="delete-account-danger-zone"
    >
      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader>
          <CardTitle
            id="delete-account-danger-zone-heading"
            className="flex items-center gap-2 font-display text-destructive"
          >
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            Critical Danger Zone
          </CardTitle>
          <CardDescription>
            Permanently delete your login account and the data you own. This
            cannot be undone, regardless of your role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => {
              setError(null);
              setConfirmation("");
              setOpen(true);
            }}
            disabled={isDeleting}
            aria-haspopup="dialog"
            data-testid="button-delete-account"
          >
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Delete My Entire Account
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) resetDialog();
          else setOpen(true);
        }}
      >
        <AlertDialogContent aria-describedby="delete-account-warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Delete your entire account permanently?
            </AlertDialogTitle>
            <AlertDialogDescription id="delete-account-warning" asChild>
              <div className="space-y-3 text-left">
                <p>
                  This permanently erases your account and cannot be undone.
                  There is no recovery path after completion.
                </p>
                <p className="font-semibold">The completed deletion will:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Delete your Clerk account and all login credentials.</li>
                  <li>
                    Delete every organization or workspace you own, including
                    co-owned workspaces, all team memberships, and all business
                    data in them.
                  </li>
                  <li>
                    Remove your membership from workspaces owned by other
                    people; those teams&apos; business records are not deleted.
                  </li>
                  <li>
                    Anonymize your authorship where needed for records that
                    remain in another person&apos;s workspace.
                  </li>
                  <li>
                    Make your email available for a new signup only after
                    deletion is confirmed complete.
                  </li>
                </ul>
                <p className="font-semibold text-destructive">
                  This action is permanent. If deletion is still pending or
                  cleanup fails, the server&apos;s message below will explain
                  what to do; keep this dialog open and retry as instructed.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="delete-account-confirmation">
              Type <strong>DELETE</strong> exactly to confirm
            </Label>
            <Input
              id="delete-account-confirmation"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setError(null);
              }}
              placeholder="DELETE"
              autoComplete="off"
              autoFocus
              disabled={isDeleting}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "delete-account-error" : undefined}
              data-testid="input-delete-account-confirmation"
            />
            {error && (
              <p
                id="delete-account-error"
                role="alert"
                className="text-sm text-destructive"
                data-testid="delete-account-error"
              >
                {error}
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting} onClick={resetDialog}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={isDeleting || !isDeleteAccountConfirmation(confirmation)}
              aria-busy={isDeleting}
              data-testid="button-confirm-delete-account"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {isDeleting
                ? "Deleting account..."
                : error
                  ? "Try again"
                  : "Permanently Delete Account"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}