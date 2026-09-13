import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Percent, RefreshCw, Save, Users } from "lucide-react";
import {
  useGetCommissionSettings,
  useUpdateCommissionSettings,
  type Member,
} from "@workspace/api-client-react";
import { useWindowAuth } from "@/components/auth/WindowAuthProvider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/format";
import {
  commissionSettingsQueryKey,
} from "@/lib/commissions";

type DraftSetting = {
  commissionPercentage: string;
  isActive: boolean;
};

type Drafts = Record<string, DraftSetting>;
type ValidationErrors = Record<string, string>;

const percentagePattern = /^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/;

function validatePercentage(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return "Enter a percentage.";
  if (!percentagePattern.test(normalized)) {
    return "Use a number from 0 to 100 with up to 2 decimals.";
  }
  const amount = Number(normalized);
  return amount >= 0 && amount <= 100
    ? null
    : "Use a number from 0 to 100 with up to 2 decimals.";
}

export default function CommissionSettingsSection({
  orgId,
  members,
}: {
  orgId: string;
  members: Member[];
}) {
  const { isLoaded: authLoaded, isSignedIn, user } = useWindowAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const identityId = user?.id ?? user?.clerkId ?? "anonymous";
  const settingsKey = commissionSettingsQueryKey(orgId, identityId);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const settingsQuery = useGetCommissionSettings(orgId, {
    query: {
      queryKey: settingsKey,
      enabled: Boolean(orgId && authLoaded && isSignedIn && user?.id),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: false,
    },
  });

  const memberIds = useMemo(
    () => members.map((member) => member.user.id),
    [members],
  );

  useEffect(() => {
    if (!settingsQuery.data || members.length === 0) return;
    const savedByUserId = new Map(
      settingsQuery.data.settings.map((setting) => [setting.userId, setting]),
    );
    const nextDrafts: Drafts = {};
    for (const member of members) {
      const saved = savedByUserId.get(member.user.id);
      nextDrafts[member.user.id] = {
        commissionPercentage: saved?.commissionPercentage ?? "0",
        isActive: saved?.isActive ?? true,
      };
    }
    setDrafts(nextDrafts);
    setValidationErrors({});
    setSaveError(null);
  }, [members, settingsQuery.data]);

  const saveMutation = useUpdateCommissionSettings({
    mutation: {
      onSuccess: (response) => {
        queryClient.setQueryData(settingsKey, response);
        queryClient.invalidateQueries({ queryKey: settingsKey });
        setSaveError(null);
        toast({
          title: "Commission settings saved",
          description: "Rates and active status are now up to date.",
        });
      },
      onError: (error) => {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to save commission settings.";
        setSaveError(message);
        toast({
          title: "Could not save commission settings",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  const updateDraft = (userId: string, update: Partial<DraftSetting>) => {
    setDrafts((current) => ({
      ...current,
      [userId]: { ...current[userId], ...update },
    }));
    if (update.commissionPercentage !== undefined) {
      setValidationErrors((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
    }
    setSaveError(null);
  };

  const handleSave = () => {
    const nextErrors: ValidationErrors = {};
    for (const member of members) {
      const draft = drafts[member.user.id];
      const error = validatePercentage(draft?.commissionPercentage ?? "");
      if (error) nextErrors[member.user.id] = error;
    }
    setValidationErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    saveMutation.mutate({
      orgId,
      data: {
        settings: members.map((member) => {
        const draft = drafts[member.user.id];
        return {
          userId: member.user.id,
          commissionPercentage: draft.commissionPercentage.trim(),
          isActive: draft.isActive,
        };
        }),
      },
    });
  };

  if (settingsQuery.isLoading) {
    return (
      <Card data-testid="loading-commission-settings">
        <CardHeader>
          <CardTitle className="font-display">Commission settings</CardTitle>
          <CardDescription>Loading team commission rates...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="skeleton h-16 rounded-lg" />
          <div className="skeleton h-16 rounded-lg" />
          <div className="skeleton h-16 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (settingsQuery.isError) {
    return (
      <Card data-testid="error-commission-settings">
        <CardHeader>
          <CardTitle className="font-display">Commission settings</CardTitle>
          <CardDescription>
            We could not load the team&apos;s commission rates.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm text-destructive" role="alert">
            {settingsQuery.error instanceof Error
              ? settingsQuery.error.message
              : "Please try again."}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void settingsQuery.refetch()}
            disabled={settingsQuery.isFetching}
            data-testid="button-retry-commission-settings"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${settingsQuery.isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {settingsQuery.isFetching ? "Retrying..." : "Retry"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-commission-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display">
          <Percent className="h-5 w-5 text-primary" aria-hidden="true" />
          Commission settings
        </CardTitle>
        <CardDescription>
          Set the percentage earned when each team member&apos;s opportunity is
          marked Closed Won. The owner is the only role that can manage these
          settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {members.length === 0 ? (
          <div
            className="rounded-lg border border-dashed border-border/70 px-6 py-10 text-center"
            data-testid="empty-commission-settings"
          >
            <Users
              className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="font-medium">No team members to configure.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {members.map((member) => {
              const draft = drafts[member.user.id] ?? {
                commissionPercentage: "0",
                isActive: true,
              };
              const error = validationErrors[member.user.id];
              const displayName = member.user.fullName || member.user.email;
              return (
                <div
                  key={member.id}
                  className="grid gap-4 rounded-lg border border-border/60 bg-background/30 p-4 lg:grid-cols-[minmax(0,1fr)_180px_130px]"
                  data-testid={`row-commission-setting-${member.user.id}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {getInitials(member.user.fullName, member.user.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium" data-testid={`text-commission-member-${member.user.id}`}>
                        {displayName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {member.user.email}
                      </p>
                      {member.role === "owner" && (
                        <Badge variant="secondary" className="mt-1 text-[10px]">
                          Owner
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`commission-percentage-${member.user.id}`}>
                      Commission rate
                    </Label>
                    <div className="relative">
                      <Input
                        id={`commission-percentage-${member.user.id}`}
                        type="text"
                        inputMode="decimal"
                        value={draft.commissionPercentage}
                        onChange={(event) =>
                          updateDraft(member.user.id, {
                            commissionPercentage: event.target.value,
                          })
                        }
                        aria-invalid={Boolean(error)}
                        className={error ? "border-destructive pr-8" : "pr-8"}
                        data-testid={`input-commission-percentage-${member.user.id}`}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                    {error ? (
                      <p
                        className="flex items-start gap-1 text-xs text-destructive"
                        data-testid={`error-commission-percentage-${member.user.id}`}
                      >
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        {error}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">0–100%, up to 2 decimals</p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-start lg:justify-center">
                    <div>
                      <Label htmlFor={`commission-active-${member.user.id}`}>Status</Label>
                      <p className="text-xs text-muted-foreground">
                        {draft.isActive ? "Earns commission" : "Commission paused"}
                      </p>
                    </div>
                    <Switch
                      id={`commission-active-${member.user.id}`}
                      checked={draft.isActive}
                      onCheckedChange={(checked) =>
                        updateDraft(member.user.id, { isActive: checked })
                      }
                      aria-label={`${displayName} commission status`}
                      data-testid={`switch-commission-active-${member.user.id}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {saveError ? (
          <p
            className="flex items-center gap-2 text-sm text-destructive"
            role="alert"
            data-testid="error-save-commission-settings"
          >
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {saveError}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Changes apply to future Closed Won opportunities.
          </p>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saveMutation.isPending || memberIds.length === 0}
            data-testid="button-save-commission-settings"
          >
            {saveMutation.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {saveMutation.isPending ? "Saving..." : "Save commission settings"}
          </Button>
        </div>
        {saveMutation.isSuccess && !saveMutation.isPending && !saveError ? (
          <p
            className="flex items-center gap-2 text-sm text-success"
            data-testid="status-commission-settings-saved"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Commission settings saved.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}