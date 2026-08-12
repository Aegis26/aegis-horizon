import { useListWorkflows, getListWorkflowsQueryKey } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Lock, Plus, Workflow as WorkflowIcon } from "lucide-react";

export default function Automation() {
  const { selectedOrgId } = useOrgStore();
  
  const { data: workflows, error, isLoading } = useListWorkflows(selectedOrgId || "", {
    query: {
      enabled: !!selectedOrgId,
      retry: false,
      queryKey: getListWorkflowsQueryKey(selectedOrgId || "")
    }
  });

  if (error && error.status === 403) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
        <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-6">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight mb-2 font-display">Automation Locked</h2>
        <p className="text-muted-foreground mb-8">
          The Automation feature set is not enabled for your organization. 
          Upgrade your plan or customize your features to build workflows.
        </p>
        <Link href="/billing">
          <Button size="lg" className="font-display">Manage Features</Button>
        </Link>
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
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1">Automation</h1>
          <p className="text-sm text-muted-foreground">Visual workflows and triggers.</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4"/> Create workflow</Button>
      </header>

      <div className="p-8">
        {workflows?.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[384px] px-6 py-20 bg-background/30 rounded-lg border border-primary/10 text-center">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
              <WorkflowIcon className="h-10 w-10 text-primary opacity-50" />
            </div>
            <h3 className="font-display text-2xl font-bold mb-2">No workflows yet</h3>
            <p className="text-muted-foreground max-w-sm mb-6">
              Automate repetitive tasks like sending emails when an opportunity closes or updating account health scores.
            </p>
            <Button variant="outline" className="gap-2 bg-transparent text-foreground border-primary/20 hover:bg-primary/10 hover:border-primary/50">
              <Plus className="h-4 w-4" /> Start from Template
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {workflows?.map(wf => (
              <div key={wf.id} className="p-4 border rounded-lg bg-card">
                Workflow {wf.id}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
