import { useOrgStore } from "@/store/org-store";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Lock, Plus, Workflow as WorkflowIcon, Bot, CheckSquare, Activity, AlertTriangle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useGetAiBudgetStatus,
  getGetAiBudgetStatusQueryKey,
  useGetMe,
  getGetMeQueryKey,
  useUpdateCommunicationSettings,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { WorkflowsTab } from "@/components/automation/WorkflowsTab";
import { AgentsTab } from "@/components/automation/AgentsTab";
import { TasksTab } from "@/components/automation/TasksTab";

export default function Automation() {
  const { selectedOrgId } = useOrgStore();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const enableAi = useUpdateCommunicationSettings();

  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const role = me?.orgs.find(o => o.org.id === selectedOrgId)?.role || "user";
  const canManage = ["owner", "admin", "manager"].includes(role);

  const { data: budget, error, isLoading, refetch } = useGetAiBudgetStatus(selectedOrgId || "", {
    query: {
      enabled: !!selectedOrgId,
      retry: false,
      queryKey: getGetAiBudgetStatusQueryKey(selectedOrgId || "")
    }
  });

  if (error && (error as any).status === 403) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
        <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-6">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight mb-2 font-display">Automation Locked</h2>
        <p className="text-muted-foreground mb-8">
          The Automation & AI feature set is not enabled for your organization.
          Upgrade your plan or customize your features to build workflows and AI agents.
        </p>
        <Link href="/billing">
          <Button size="lg" className="font-display">Manage Features</Button>
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center mx-auto">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="mb-2 font-display text-2xl font-bold tracking-tight">Could not load AI status</h2>
        <p className="mb-8 text-muted-foreground">
          {(error as Error).message || "The AI service status could not be loaded."}
        </p>
        <Button variant="outline" onClick={() => void refetch()}>Try Again</Button>
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-8"><div className="skeleton h-64 rounded-xl"></div></div>;
  }

  return (
    <div>
      <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1">Automation Hub</h1>
          <p className="text-sm text-muted-foreground">Workflows, AI Agents, and Tasks.</p>
        </div>
        {budget && (
          <div className="flex flex-col items-end text-xs font-mono">
            <span className="text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
              <Activity className="h-3 w-3" /> Token Budget
            </span>
            <span className={budget.remaining < 5000 ? "text-destructive" : "text-primary"}>
              {budget.used.toLocaleString()} / {budget.budget.toLocaleString()}
            </span>
          </div>
        )}
      </header>

      <div className="p-8 max-w-7xl mx-auto">
        {budget && !budget.consentEnabled && (
          <div className="mb-6 bg-warning/10 border border-warning/30 p-4 rounded-lg flex items-start gap-3 animate-slideUpReveal">
            <Lock className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-warning font-display">AI Processing Consent Required</h3>
              <p className="text-sm text-warning-foreground mt-1">
                Enable AI processing to use Copilot summaries, drafts, next actions, and AI agents.
                Selected CRM content will be sent to Anthropic when you request these features.
              </p>
            </div>
            {canManage ? (
              <Button
                size="sm"
                disabled={enableAi.isPending}
                onClick={() => {
                  if (!selectedOrgId) return;
                  enableAi.mutate(
                    { orgId: selectedOrgId, data: { aiAnalysisEnabled: true } },
                    {
                      onSuccess: () => {
                        void queryClient.invalidateQueries({
                          queryKey: getGetAiBudgetStatusQueryKey(selectedOrgId),
                        });
                        toast({
                          title: "AI features enabled",
                          description: "Copilot and AI agents are now available for this organization.",
                        });
                      },
                      onError: (updateError) => {
                        toast({
                          title: "Could not enable AI",
                          description: (updateError as Error).message,
                          variant: "destructive",
                        });
                      },
                    },
                  );
                }}
              >
                {enableAi.isPending ? "Enabling..." : "Enable AI"}
              </Button>
            ) : (
              <span className="text-xs text-warning-foreground">Ask an organization manager to enable AI.</span>
            )}
          </div>
        )}

        <Tabs defaultValue="workflows" className="w-full">
          <TabsList className="bg-card border border-primary/10 mb-6 h-12 w-full justify-start overflow-x-auto shadow-sm">
            <TabsTrigger value="workflows" className="gap-2 font-display data-[state=active]:bg-primary/10 data-[state=active]:text-primary"><WorkflowIcon className="h-4 w-4"/> Workflows</TabsTrigger>
            <TabsTrigger value="agents" className="gap-2 font-display data-[state=active]:bg-primary/10 data-[state=active]:text-primary"><Bot className="h-4 w-4"/> AI Agents</TabsTrigger>
            <TabsTrigger value="tasks" className="gap-2 font-display data-[state=active]:bg-primary/10 data-[state=active]:text-primary"><CheckSquare className="h-4 w-4"/> Tasks</TabsTrigger>
          </TabsList>

          <TabsContent value="workflows" className="mt-0 outline-none">
            <WorkflowsTab orgId={selectedOrgId!} canManage={canManage} />
          </TabsContent>

          <TabsContent value="agents" className="mt-0 outline-none">
            <AgentsTab orgId={selectedOrgId!} canManage={canManage} />
          </TabsContent>

          <TabsContent value="tasks" className="mt-0 outline-none">
            <TasksTab orgId={selectedOrgId!} canManage={canManage} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
