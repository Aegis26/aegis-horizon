import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useDeleteOrganization, getGetOrgQueryKey } from "@workspace/api-client-react";
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
import { purgeQueuedLeadsForOrganization } from "@/lib/offline-leads";
import {
  DELETE_ORGANIZATION_CONFIRMATION,
  isDeleteOrganizationConfirmation,
} from "@/lib/delete-organization";
import { useToast } from "@/hooks/use-toast";

interface DeleteOrganizationDangerZoneProps {
  orgId: string;
  orgName: string;
  role?: string;
}

export function DeleteOrganizationDangerZone({
  orgId,
  orgName,
  role,
}: DeleteOrganizationDangerZoneProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { selectedOrgId, setSelectedOrgId } = useOrgStore();
  const { toast } = useToast();
  const deleteOrganization = useDeleteOrganization();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // A switched organization must never inherit an open dialog, confirmation,
  // or an error from the organization that was previously selected.
  useEffect(() => {
    setOpen(false);
    setConfirmation("");
    setError(null);
    setIsDeleting(false);
  }, [orgId]);

  const resetDialog = () => {
    if (isDeleting) return;
    setOpen(false);
    setConfirmation("");
    setError(null);
  };

  const handleDelete = async () => {
    if (!isDeleteOrganizationConfirmation(confirmation) || isDeleting) {
      setError("Type DELETE exactly to confirm.");
      return;
    }

    const deletingOrgId = orgId;
    setIsDeleting(true);
    setError(null);

    try {
      await deleteOrganization.mutateAsync({
        orgId: deletingOrgId,
        data: DELETE_ORGANIZATION_CONFIRMATION,
      });

      let offlineCleanupError: Error | null = null;
      try {
        await purgeQueuedLeadsForOrganization(deletingOrgId);
      } catch (caughtError) {
        // Server deletion has already succeeded. Do not ask the user to retry
        // a destructive request just because local IndexedDB cleanup failed.
        offlineCleanupError =
          caughtError instanceof Error
            ? caughtError
            : new Error("Local offline drafts could not be cleared.");
      }

      // Remove all cached org-scoped records before navigating away. Clearing
      // the auth/me cache as well makes the next home render authoritative,
      // even when local cleanup reports an error.
      queryClient.removeQueries({ queryKey: getGetOrgQueryKey(deletingOrgId) });
      queryClient.clear();
      if (selectedOrgId === deletingOrgId) {
        setSelectedOrgId(null);
      }
      if (offlineCleanupError) {
        toast({
          title: "Organization deleted",
          description: `The organization was deleted, but local offline drafts could not be cleared: ${offlineCleanupError.message}`,
          variant: "destructive",
        });
      }
      setOpen(false);
      setIsDeleting(false);
      setLocation("/");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to delete organization. Please try again.",
      );
      setIsDeleting(false);
    }
  };

  if (!role) {
    return null;
  }

  if (role !== "owner") {
    return (
      <section
        aria-labelledby="danger-zone-heading"
        className="border-t border-border pt-8"
        data-testid="delete-organization-danger-zone"
      >
        <h2 id="danger-zone-heading" className="font-display text-lg font-bold">
          Danger Zone
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Only the organization owner can delete the workspace
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="border-t border-destructive/40 pt-8"
      data-testid="delete-organization-danger-zone"
    >
      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader>
          <CardTitle id="danger-zone-heading" className="flex items-center gap-2 font-display text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Permanently delete <strong className="text-foreground">{orgName}</strong> and all associated data.
            This action cannot be undone.
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
            data-testid="button-delete-organization"
          >
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Delete Organization
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
        <AlertDialogContent aria-describedby="delete-organization-warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Delete {orgName} permanently?
            </AlertDialogTitle>
            <AlertDialogDescription id="delete-organization-warning" asChild>
              <div className="space-y-3 text-left">
                <p>
                  This permanently deletes <strong>{orgName}</strong> and cannot be undone.
                </p>
                <p>The following data will be erased:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>All accounts, opportunities, contacts, and leads</li>
                  <li>All documents, quotes, and automations</li>
                  <li>All team members and team memberships</li>
                </ul>
                <p className="font-semibold text-warning">
                  Any active workspace subscription will be canceled as part of deletion.
                </p>
                <p className="text-warning-foreground">
                  An external cleanup failure can leave deletion pending or partially cleaned.
                  Retrying resumes cleanup; it does not restore deleted data or an intact workspace.
                </p>
                <p className="font-semibold text-destructive">
                  Your login account will remain, but this organization and its data cannot be recovered.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="delete-organization-confirmation">
              Type <strong>DELETE</strong> to confirm
            </Label>
            <Input
              id="delete-organization-confirmation"
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
              aria-describedby={error ? "delete-organization-error" : undefined}
              data-testid="input-delete-organization-confirmation"
            />
            {error && (
              <p
                id="delete-organization-error"
                role="alert"
                className="text-sm text-destructive"
                data-testid="delete-organization-error"
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
              disabled={isDeleting || !isDeleteOrganizationConfirmation(confirmation)}
              aria-busy={isDeleting}
              data-testid="button-confirm-delete-organization"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {isDeleting ? "Deleting organization..." : error ? "Try again" : "Permanently Delete Organization"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}