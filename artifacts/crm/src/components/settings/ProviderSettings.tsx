import {
  useListCommunicationProviders, getListCommunicationProvidersQueryKey,
  useForceProviderSync,
  useBindCommunicationProvider,
  useUnbindCommunicationProvider,
  useGetCommunicationSettings, getGetCommunicationSettingsQueryKey,
  useUpdateCommunicationSettings
} from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, ServerCrash, CheckCircle2, AlertCircle, Link as LinkIcon, Unlink, ShieldAlert, Cpu } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function ProviderSettings() {
  const { selectedOrgId } = useOrgStore();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useListCommunicationProviders(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getListCommunicationProvidersQueryKey(selectedOrgId || "") }
  });

  const { data: commSettings, isLoading: settingsLoading } = useGetCommunicationSettings(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getGetCommunicationSettingsQueryKey(selectedOrgId || "") }
  });

  const syncProvider = useForceProviderSync();
  const bindProvider = useBindCommunicationProvider();
  const unbindProvider = useUnbindCommunicationProvider();
  const updateSettings = useUpdateCommunicationSettings();

  const handleToggleAi = (checked: boolean) => {
    if (!selectedOrgId) return;
    updateSettings.mutate({
      orgId: selectedOrgId,
      data: { aiAnalysisEnabled: checked }
    }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetCommunicationSettingsQueryKey(selectedOrgId), data);
        toast({ title: "Settings Updated", description: "Communication AI settings saved." });
        queryClient.invalidateQueries({ queryKey: getGetCommunicationSettingsQueryKey(selectedOrgId) });
      },
      onError: () => {
        toast({ title: "Update Failed", description: "Failed to update communication settings.", variant: "destructive" });
      }
    });
  };

  const handleSync = (providerId: string) => {
    if (!selectedOrgId) return;
    syncProvider.mutate({
      orgId: selectedOrgId,
      provider: providerId as any
    }, {
      onSuccess: (res) => {
        toast({ title: "Sync Triggered", description: `Synced ${res.recordsSynced} records for ${res.provider}` });
        queryClient.invalidateQueries({ queryKey: getListCommunicationProvidersQueryKey(selectedOrgId) });
      },
      onError: (err: any) => {
        // Handle 403 clearly
        const is403 = err?.status === 403 || err?.message?.includes("403") || err?.message?.includes("Forbidden");
        const msg = is403 ? "You lack permissions to sync this provider." : err?.message || "Check your provider connection.";
        toast({ title: "Sync Failed", description: msg, variant: "destructive" });
      }
    });
  };

  const handleBind = (providerId: string) => {
    if (!selectedOrgId) return;
    bindProvider.mutate({
      orgId: selectedOrgId,
      provider: providerId as any
    }, {
      onSuccess: () => {
        toast({ title: "Provider Bound", description: "This organization can now use this provider." });
        queryClient.invalidateQueries({ queryKey: getListCommunicationProvidersQueryKey(selectedOrgId) });
      },
      onError: (err: any) => {
        toast({ title: "Binding Failed", description: err?.message || "Could not bind provider.", variant: "destructive" });
      }
    });
  };

  const handleUnbind = (providerId: string) => {
    if (!selectedOrgId) return;
    unbindProvider.mutate({
      orgId: selectedOrgId,
      provider: providerId as any
    }, {
      onSuccess: () => {
        toast({ title: "Provider Unbound", description: "Provider has been disconnected from this organization." });
        queryClient.invalidateQueries({ queryKey: getListCommunicationProvidersQueryKey(selectedOrgId) });
      },
      onError: (err: any) => {
        toast({ title: "Unbinding Failed", description: err?.message || "Could not unbind provider.", variant: "destructive" });
      }
    });
  };

  if (isLoading || settingsLoading) {
    return <Card><CardContent className="p-6"><div className="spinner mx-auto"/></CardContent></Card>;
  }

  const errorMsg = error ? (error as any)?.message || "Failed to load provider status" : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <RefreshCw className="h-5 w-5" />
            Workspace Providers
          </CardTitle>
          <CardDescription>
            Connect external providers (Email, Calendar) to your workspace. Provider bindings apply to the entire organization, not just your personal user account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorMsg && (
            <div className="mb-4 flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
              <ServerCrash className="h-5 w-5 mt-0.5" />
              <div>
                <p className="font-semibold text-sm">Provider Configuration Error</p>
                <p className="text-sm opacity-90">{errorMsg}</p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {data?.providers?.map((p: any) => {
              const isBoundThisOrg = p.bindingStatus === 'bound_this_org';
              const isAvailable = p.bindingStatus === 'available_unbound';
              const isBoundOtherOrg = p.bindingStatus === 'bound_other_org';

              const isSyncing = syncProvider.isPending && syncProvider.variables?.provider === p.provider;
              const isBinding = bindProvider.isPending && bindProvider.variables?.provider === p.provider;
              const isUnbinding = unbindProvider.isPending && unbindProvider.variables?.provider === p.provider;

              return (
                <div key={p.provider} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border border-border/50 rounded-lg bg-card/50 gap-4">
                  <div className="flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-md flex items-center justify-center border ${isBoundThisOrg ? "bg-primary/10 border-primary/20 text-primary" : "bg-muted border-border text-muted-foreground"}`}>
                      {isBoundThisOrg ? <CheckCircle2 className="h-5 w-5" /> : <LinkIcon className="h-5 w-5" />}
                    </div>
                    <div>
                      <h4 className="font-semibold capitalize">{p.provider.replace("_", " ")}</h4>
                      <div className="flex items-center gap-2 text-xs mt-1">
                        {isBoundThisOrg && (
                          <span className="flex items-center gap-1 text-emerald-500 font-medium">
                            <CheckCircle2 className="h-3 w-3" /> Bound to this workspace
                          </span>
                        )}
                        {isAvailable && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <AlertCircle className="h-3 w-3" /> Available to claim
                          </span>
                        )}
                        {isBoundOtherOrg && (
                          <span className="flex items-center gap-1 text-amber-500">
                            <ShieldAlert className="h-3 w-3" /> Claimed by another workspace
                          </span>
                        )}
                        {isBoundThisOrg && p.sync?.lastSyncedAt && (
                          <span className="text-muted-foreground ml-2 font-mono">Last sync: {formatDate(p.sync.lastSyncedAt)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isBoundThisOrg ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSync(p.provider)}
                          disabled={isSyncing}
                        >
                          {isSyncing ? <span className="animate-spin mr-2"><RefreshCw className="h-3 w-3"/></span> : <RefreshCw className="h-3 w-3 mr-2" />}
                          Force Sync
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleUnbind(p.provider)}
                          disabled={isUnbinding}
                        >
                          {isUnbinding ? <span className="animate-spin mr-2"><RefreshCw className="h-3 w-3"/></span> : <Unlink className="h-3 w-3 mr-2" />}
                          Unbind
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleBind(p.provider)}
                        disabled={!isAvailable || isBinding}
                      >
                        {isBinding ? <span className="animate-spin mr-2"><RefreshCw className="h-3 w-3"/></span> : <LinkIcon className="h-3 w-3 mr-2" />}
                        {isBoundOtherOrg ? "Unavailable" : "Claim Provider"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}

            {(!data?.providers || data.providers.length === 0) && !errorMsg && (
              <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
                No communication providers found.
              </div>
            )}
          </div>

          <div className="mt-4 p-4 bg-muted/50 rounded-md text-xs text-muted-foreground border border-border/50">
            <strong>Note:</strong> Binding a provider authorizes exactly this Aegis organization to sync its data. Unbinding disconnects it from this workspace but does not revoke the underlying OAuth token at the provider level.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <Cpu className="h-5 w-5" />
            Communication AI
          </CardTitle>
          <CardDescription>
            Enable intelligence features for emails and call recordings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-card/50">
            <div className="space-y-1 mr-4">
              <Label htmlFor="ai-toggle" className="font-semibold text-base">Analyze communications with AI</Label>
              <p className="text-sm text-muted-foreground">
                When enabled, customer email snippets and call transcripts are sent to Anthropic for processing to generate summaries, sentiment analysis, and keyword extraction.
              </p>
            </div>
            <Switch
              id="ai-toggle"
              checked={commSettings?.aiAnalysisEnabled ?? false}
              onCheckedChange={handleToggleAi}
              disabled={updateSettings.isPending || settingsLoading}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}