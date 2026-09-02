import { useState } from "react";
import {
  useListAgents, getListAgentsQueryKey,
  useCreateAgent, useUpdateAgent, useDeactivateAgent, useRunAgent,
  useListAgentExecutions, getListAgentExecutionsQueryKey,
  useListLeads, getListLeadsQueryKey,
  useListOpportunities, getListOpportunitiesQueryKey,
  useListAccounts, getListAccountsQueryKey
} from "@workspace/api-client-react";
import type { AiAgent, AgentInput, AgentExecution } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, Bot, Edit2, Play, Activity, AlertTriangle, History } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function AgentsTab({ orgId, canManage }: { orgId: string, canManage?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editData, setEditData] = useState<AiAgent | null>(null);
  const [runAgentId, setRunAgentId] = useState<string | null>(null);
  const [auditAgentId, setAuditAgentId] = useState<string | null>(null);

  const { data: agents, isLoading } = useListAgents(orgId, {
    query: { queryKey: getListAgentsQueryKey(orgId) }
  });

  const deactivateAgent = useDeactivateAgent();
  const runAgent = useRunAgent();

  const [isBudgetExhausted, setIsBudgetExhausted] = useState(false);

  if (isLoading) return <div className="h-64 skeleton rounded-xl"></div>;

  const toggleAgent = (agent: AiAgent, checked: boolean) => {
    if (!checked) {
      deactivateAgent.mutate({ orgId, agentId: agent.id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey(orgId) }),
        onError: (e: any) => toast({ title: "Failed to deactivate", description: e.message, variant: "destructive" })
      });
    } else {
      toast({ title: "Must edit to activate", description: "Open the agent configuration to activate it." });
    }
  };

  const handleManualRun = (agent: AiAgent, entityType: string, entityId: string) => {
    runAgent.mutate(
      { orgId, agentId: agent.id, data: { entityType: entityType as any, entityId } },
      {
        onSuccess: (res) => {
          toast({ title: "Agent Run Completed", description: "The agent executed synchronously." });
          queryClient.invalidateQueries({ queryKey: getListAgentExecutionsQueryKey(orgId) });
        },
        onError: (e: any) => {
          if (e.status === 429) {
            setIsBudgetExhausted(true);
          } else {
            toast({ title: "Run Failed", description: e.message, variant: "destructive" })
          }
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold font-display">AI Agents</h2>
          <p className="text-sm text-muted-foreground">Autonomous agents that execute workflows and analysis.</p>
        </div>
        {canManage && (
          <Button className="gap-2" onClick={() => { setEditData(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4" /> Create Agent
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(!agents || agents.length === 0) ? (
          <div className="col-span-full text-center py-12 bg-card border border-primary/10 rounded-lg">
            <Bot className="h-10 w-10 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="font-display font-medium text-foreground">No Agents</h3>
            <p className="text-sm text-muted-foreground mt-1">Deploy an AI agent to handle automated sequences.</p>
          </div>
        ) : (
          agents.map(agent => (
            <div key={agent.id} className="bg-card border border-primary/10 rounded-lg p-5 flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" />
                    <h3 className="font-bold text-foreground">{agent.name}</h3>
                  </div>
                  <Switch checked={agent.active} disabled={!canManage} onCheckedChange={(c) => toggleAgent(agent, c)} />
                </div>

                <div className="flex gap-2 text-[10px] font-mono uppercase font-bold tracking-wider">
                  <span className="px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                    {agent.type.replace(/_/g, " ")}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary border border-secondary/20">
                    {agent.executionFrequency}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2">
                  {agent.systemPrompt || "No custom prompt provided."}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-border/50">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAuditAgentId(agent.id)}>
                  <History className="h-3 w-3" /> Audit
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setRunAgentId(agent.id)}>
                  <Play className="h-3 w-3" /> Run
                </Button>
                {canManage && (
                  <Button size="sm" variant="ghost" onClick={() => { setEditData(agent); setFormOpen(true); }}>
                    <Edit2 className="h-3.5 w-3.5" /> Edit
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {formOpen && (
        <AgentFormDialog
          orgId={orgId}
          agent={editData}
          onClose={() => { setFormOpen(false); setEditData(null); }}
          onSave={() => queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey(orgId) })}
        />
      )}

      {runAgentId && (
        <RunAgentDialog
          orgId={orgId}
          agent={agents?.find(a => a.id === runAgentId) || null}
          onClose={() => setRunAgentId(null)}
        />
      )}

      {auditAgentId && (
        <AgentAuditDialog
          orgId={orgId}
          agent={agents?.find(a => a.id === auditAgentId) || null}
          onClose={() => setAuditAgentId(null)}
        />
      )}
    </div>
  );
}

function AgentFormDialog({ orgId, agent, onClose, onSave }: { orgId: string, agent: AiAgent | null, onClose: () => void, onSave: () => void }) {
  const { toast } = useToast();
  const createAg = useCreateAgent();
  const updateAg = useUpdateAgent();

  const [name, setName] = useState(agent?.name || "");
  const [type, setType] = useState<any>(agent?.type || "lead_qualifier");
  const [frequency, setFrequency] = useState<any>(agent?.executionFrequency || "daily");
  const [prompt, setPrompt] = useState(agent?.systemPrompt || "");

  const pending = createAg.isPending || updateAg.isPending;

  const handleSave = () => {
    const payload: AgentInput = {
      name, type, executionFrequency: frequency, systemPrompt: prompt, active: true, config: {}
    };

    if (agent) {
      updateAg.mutate({ orgId, agentId: agent.id, data: payload }, {
        onSuccess: () => { toast({ title: "Agent updated" }); onSave(); onClose(); },
        onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
      });
    } else {
      createAg.mutate({ orgId, data: payload }, {
        onSuccess: () => { toast({ title: "Agent created" }); onSave(); onClose(); },
        onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
      });
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">{agent ? "Edit AI Agent" : "Create AI Agent"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Agent Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lead Qualification Bot" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Agent Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead_qualifier">Lead Qualifier</SelectItem>
                  <SelectItem value="follow_up_sequencer">Follow-up Sequencer</SelectItem>
                  <SelectItem value="renewal_monitor">Renewal Monitor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="realtime">Real-time</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>System Prompt (Optional)</Label>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Provide specific instructions on tone, limits, or context..."
              className="min-h-[100px]"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={pending || !name}>
            {pending ? "Saving..." : "Save Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunAgentDialog({ orgId, agent, onClose }: { orgId: string, agent: AiAgent | null, onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const runAgent = useRunAgent();

  const [entityId, setEntityId] = useState("");
  const [isBudgetExhausted, setIsBudgetExhausted] = useState(false);

  // Decide entity type based on agent type
  let entityType = "lead";
  if (agent?.type.includes("renewal") || agent?.type.includes("account")) entityType = "account";
  if (agent?.type.includes("opportunity")) entityType = "opportunity";

  // Fetch relevant entities
  const { data: leads } = useListLeads(orgId, undefined, { query: { enabled: entityType === 'lead', queryKey: getListLeadsQueryKey(orgId) } });
  const { data: opps } = useListOpportunities(orgId, undefined, { query: { enabled: entityType === 'opportunity', queryKey: getListOpportunitiesQueryKey(orgId) } });
  const { data: accounts } = useListAccounts(orgId, undefined, { query: { enabled: entityType === 'account', queryKey: getListAccountsQueryKey(orgId) } });

  const handleRun = () => {
    if (!agent || !entityId) return;
    setIsBudgetExhausted(false);

    runAgent.mutate(
      { orgId, agentId: agent.id, data: { entityType: entityType as any, entityId } },
      {
        onSuccess: (res) => {
          toast({ title: "Agent Run Completed", description: "The agent executed synchronously." });
          queryClient.invalidateQueries({ queryKey: getListAgentExecutionsQueryKey(orgId) });
          onClose();
        },
        onError: (e: any) => {
          if (e.status === 429) {
            setIsBudgetExhausted(true);
          } else {
            toast({ title: "Run Failed", description: e.message, variant: "destructive" });
          }
        }
      }
    );
  };

  const getOptions = () => {
    if (entityType === 'lead') return leads?.map(l => ({ id: l.id, label: `${l.firstName} ${l.lastName}` })) || [];
    if (entityType === 'opportunity') return opps?.map(o => ({ id: o.id, label: o.name })) || [];
    return accounts?.map(a => ({ id: a.id, label: a.name })) || [];
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Play className="h-4 w-4" /> Run {agent?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">Select a target {entityType} to run this agent against synchronously.</p>
          <div className="space-y-2">
            <Label className="capitalize">{entityType}</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger><SelectValue placeholder="Select target..."/></SelectTrigger>
              <SelectContent>
                {getOptions().map(opt => (
                  <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isBudgetExhausted && (
            <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg text-sm text-warning animate-fadeInBlur">
              <div className="flex items-center gap-2 font-display font-medium mb-1">
                <AlertTriangle className="h-4 w-4" /> Usage Limit Reached
              </div>
              <p className="text-xs text-warning-foreground">Your organization has exhausted its monthly AI token budget.</p>
            </div>
          )}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleRun} disabled={runAgent.isPending || !entityId}>
            {runAgent.isPending ? "Running..." : "Run Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentAuditDialog({ orgId, agent, onClose }: { orgId: string, agent: AiAgent | null, onClose: () => void }) {
  const { data: executions, isLoading } = useListAgentExecutions(orgId, {
    query: { queryKey: getListAgentExecutionsQueryKey(orgId), enabled: !!agent }
  });

  const agentExecutions = executions?.filter(e => e.agentId === agent?.id) || [];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> {agent?.name} Audit Log
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {isLoading ? (
            <div className="h-32 skeleton rounded"></div>
          ) : agentExecutions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No executions recorded yet.</p>
          ) : (
            <div className="space-y-4">
              {agentExecutions.map(ex => (
                <div key={ex.id} className="border border-border/50 rounded-md p-4 text-sm bg-card shadow-sm">
                  <div className="flex justify-between mb-2 pb-2 border-b border-border/50">
                    <span className="font-mono font-bold flex items-center gap-2">
                      <Bot className="h-3.5 w-3.5 text-primary"/>
                      {ex.entityType} {ex.entityId?.slice(-6) || 'none'}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                      ex.status === 'success' ? 'bg-success/20 text-success' :
                      ex.status === 'failed' ? 'bg-destructive/20 text-destructive' : 'bg-primary/20 text-primary'
                    }`}>
                      {ex.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Executed At</p>
                      <p className="text-xs font-mono">{formatDate(ex.executedAt)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Tokens Used</p>
                      <p className="text-xs font-mono text-primary">{ex.tokensUsed.toLocaleString()}</p>
                    </div>
                  </div>

                  {ex.decisionRationale && (
                    <div className="mb-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Decision Rationale</p>
                      <p className="text-xs italic bg-background/50 p-2 rounded border border-border/30">"{ex.decisionRationale}"</p>
                    </div>
                  )}

                  {ex.actions && ex.actions.length > 0 ? (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Actions Taken</p>
                      <div className="space-y-2">
                        {ex.actions.map((act, i) => (
                          <div key={i} className="text-xs p-2 rounded bg-primary/5 border border-primary/10 flex items-start justify-between">
                            <div>
                              <span className="font-mono font-bold block mb-1">{act.action}</span>
                              {act.sent === false && (
                                <Badge variant="outline" className="text-[9px] bg-warning/10 text-warning border-warning/20 mb-1">
                                  Human Approval Required (Sent: False)
                                </Badge>
                              )}
                              {act.taskId && <p className="text-muted-foreground mt-1">Task: {act.taskId.slice(-6)}</p>}
                              {act.opportunityId && <p className="text-muted-foreground mt-1">Opp: {act.opportunityId.slice(-6)}</p>}
                            </div>
                            {act.status && <Badge variant="outline" className="text-[9px] mt-1">{act.status}</Badge>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No actions taken.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}