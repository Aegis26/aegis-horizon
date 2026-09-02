import { useState } from "react";
import {
  useListWorkflows, getListWorkflowsQueryKey,
  useCreateWorkflow, useUpdateWorkflow, useDeactivateWorkflow, useTestWorkflow, useToggleWorkflow,
  useListWorkflowExecutions, getListWorkflowExecutionsQueryKey,
  useListLeads, getListLeadsQueryKey,
  useListOpportunities, getListOpportunitiesQueryKey,
  useListAccounts, getListAccountsQueryKey
} from "@workspace/api-client-react";
import type { Workflow, WorkflowInput, WorkflowExecution, WorkflowDryRun, WorkflowInputConditionsItem, WorkflowInputActionsItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, Play, Pause, Trash2, Edit2, Zap, AlertTriangle, Workflow as WorkflowIcon, History, Activity } from "lucide-react";
import { formatDate } from "@/lib/format";

export function WorkflowsTab({ orgId, canManage }: { orgId: string, canManage?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editData, setEditData] = useState<Workflow | null>(null);

  const [auditOpen, setAuditOpen] = useState<string | null>(null);

  const { data: workflows, isLoading } = useListWorkflows(orgId, {
    query: { queryKey: getListWorkflowsQueryKey(orgId) }
  });

  const toggleWf = useToggleWorkflow();

  if (isLoading) return <div className="h-64 skeleton rounded-xl"></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start sm:items-center flex-col sm:flex-row gap-4">
        <div>
          <h2 className="text-xl font-bold font-display">Active Workflows</h2>
          <p className="text-sm text-muted-foreground">Automate processes and trigger AI agents.</p>
        </div>
        {canManage && (
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" className="gap-2 flex-1 sm:flex-none border-primary/20 hover:bg-primary/5" onClick={() => {
              // Load the acceptance recipe
              setEditData({
                id: "",
                name: "Proposal follow-up",
                description: "Automatically create a follow-up task for proposals stuck in stage for 14 days",
                active: false,
                version: 1,
                lastDryRunVersion: 0,
                createdAt: new Date().toISOString(),
                trigger: { type: "time_based", entityType: "opportunity", schedule: "daily" },
                conditions: [
                  { field: "stage", operator: "equals", value: "Proposal" },
                  { field: "daysInStage", operator: "gte", value: "14" }
                ],
                actions: [
                  { type: "create_task", config: { title: "Follow up" } }
                ]
              } as Workflow);
              setFormOpen(true);
            }}>
              <Zap className="h-4 w-4 text-primary" /> Recipe: Proposal Follow-up
            </Button>
            <Button className="gap-2 flex-1 sm:flex-none" onClick={() => { setEditData(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" /> Create Workflow
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4">
        {(!workflows || workflows.length === 0) ? (
          <div className="text-center py-12 bg-card border border-primary/10 rounded-lg">
            <WorkflowIcon className="h-10 w-10 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="font-display font-medium text-foreground">No workflows defined</h3>
            <p className="text-sm text-muted-foreground mt-1">Create a workflow to automate your CRM.</p>
          </div>
        ) : (
          workflows.map(wf => (
            <div key={wf.id} className="bg-card border border-primary/10 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-bold text-foreground">{wf.name}</h3>
                  <div className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-mono border border-primary/20">
                    <Zap className="h-3 w-3" />
                    v{wf.version}
                  </div>
                  {!wf.lastDryRunVersion || wf.lastDryRunVersion < wf.version ? (
                    <div className="flex items-center gap-1 text-[10px] text-warning uppercase font-bold tracking-wider">
                      <AlertTriangle className="h-3 w-3"/> Needs Test
                    </div>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">{wf.description || "No description."}</p>
                <div className="flex gap-4 text-xs font-mono text-muted-foreground">
                  <span>Trigger: {wf.trigger.type} ({wf.trigger.entityType})</span>
                  <span>Actions: {wf.actions.length}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={wf.active}
                    disabled={!canManage}
                    onCheckedChange={(active) => {
                      if (active && (!wf.lastDryRunVersion || wf.lastDryRunVersion < wf.version)) {
                        toast({ title: "Testing required", description: "You must run a successful dry-run of the current version before activating.", variant: "destructive" });
                        return;
                      }
                      toggleWf.mutate(
                        { orgId, workflowId: wf.id, data: { active } },
                        {
                          onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey(orgId) }),
                          onError: (e: any) => toast({ title: "Failed to toggle", description: e.message, variant: "destructive" })
                        }
                      );
                    }}
                  />
                  <span className="text-sm font-medium">{wf.active ? "Active" : "Inactive"}</span>
                </div>
                <div className="h-8 w-px bg-border/50"></div>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => setAuditOpen(wf.id)}>
                  <History className="h-3.5 w-3.5" /> Audit
                </Button>
                {canManage && (
                  <Button size="sm" variant="ghost" onClick={() => { setEditData(wf); setFormOpen(true); }}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {formOpen && (
        <WorkflowFormDialog
          orgId={orgId}
          workflow={editData}
          onClose={() => { setFormOpen(false); setEditData(null); }}
          onSave={() => queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey(orgId) })}
        />
      )}

      {auditOpen && (
        <WorkflowAuditDialog orgId={orgId} workflowId={auditOpen} onClose={() => setAuditOpen(null)} />
      )}
    </div>
  );
}

function WorkflowFormDialog({ orgId, workflow, onClose, onSave }: { orgId: string, workflow: Workflow | null, onClose: () => void, onSave: () => void }) {
  const { toast } = useToast();
  const createWf = useCreateWorkflow();
  const updateWf = useUpdateWorkflow();
  const testWf = useTestWorkflow();

  const [name, setName] = useState(workflow?.name || "");
  const [description, setDescription] = useState(workflow?.description || "");
  const [triggerType, setTriggerType] = useState<any>(workflow?.trigger.type || "record_created");
  const [triggerEntity, setTriggerEntity] = useState<any>(workflow?.trigger.entityType || "lead");
  const [triggerField, setTriggerField] = useState(workflow?.trigger.field || "");
  const [triggerSchedule, setTriggerSchedule] = useState<any>(workflow?.trigger.schedule || "daily");

  const [conditions, setConditions] = useState<WorkflowInputConditionsItem[]>(workflow?.conditions || []);
  const [actions, setActions] = useState<WorkflowInputActionsItem[]>(workflow?.actions || [{ type: "create_task", config: { title: "" } }]);

  const [dryRunResult, setDryRunResult] = useState<WorkflowDryRun | null>(null);
  const [dryRunEntityId, setDryRunEntityId] = useState<string>("");

  const { data: leads } = useListLeads(orgId, undefined, { query: { enabled: triggerEntity === 'lead', queryKey: getListLeadsQueryKey(orgId) } });
  const { data: opps } = useListOpportunities(orgId, undefined, { query: { enabled: triggerEntity === 'opportunity', queryKey: getListOpportunitiesQueryKey(orgId) } });
  const { data: accounts } = useListAccounts(orgId, undefined, { query: { enabled: triggerEntity === 'account', queryKey: getListAccountsQueryKey(orgId) } });

  const pending = createWf.isPending || updateWf.isPending;

  const handleSave = () => {
    const payload: WorkflowInput = {
      name, description,
      trigger: {
        type: triggerType,
        entityType: triggerEntity,
        field: triggerType === 'field_change' ? triggerField : undefined,
        schedule: triggerType === 'time_based' ? triggerSchedule : undefined
      },
      conditions, actions
    };
    if (workflow?.id) {
      updateWf.mutate({ orgId, workflowId: workflow.id, data: payload }, {
        onSuccess: () => { toast({ title: "Saved" }); onSave(); onClose(); },
        onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
      });
    } else {
      createWf.mutate({ orgId, data: payload }, {
        onSuccess: () => { toast({ title: "Created" }); onSave(); onClose(); },
        onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
      });
    }
  };

  const handleTest = () => {
    if (!workflow?.id) {
      toast({ title: "Save first", description: "You must save the workflow before testing." });
      return;
    }

    if (!dryRunEntityId) {
      toast({ title: "Entity required", description: "Select a record for the dry run.", variant: "destructive" });
      return;
    }

    testWf.mutate({ orgId, workflowId: workflow.id, data: { entityType: triggerEntity as any, entityId: dryRunEntityId } }, {
      onSuccess: (res) => setDryRunResult(res),
      onError: (e: any) => toast({ title: "Test Failed", description: e.message, variant: "destructive" })
    });
  };

  const getOptions = () => {
    if (triggerEntity === 'lead') return leads?.map(l => ({ id: l.id, label: `${l.firstName} ${l.lastName}` })) || [];
    if (triggerEntity === 'opportunity') return opps?.map(o => ({ id: o.id, label: o.name })) || [];
    return accounts?.map(a => ({ id: a.id, label: a.name })) || [];
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{workflow ? "Edit Workflow" : "Create Workflow"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label>Workflow Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Trigger Event</Label>
              <Select value={triggerType} onValueChange={setTriggerType}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="record_created">Record Created</SelectItem>
                  <SelectItem value="field_change">Field Change</SelectItem>
                  <SelectItem value="time_based">Time Based</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Target Entity</Label>
              <Select value={triggerEntity} onValueChange={setTriggerEntity}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="opportunity">Opportunity</SelectItem>
                  <SelectItem value="account">Account</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {triggerType === 'field_change' && (
              <div className="space-y-2 col-span-2">
                <Label>Field to Monitor</Label>
                <Input value={triggerField} onChange={e => setTriggerField(e.target.value)} placeholder="e.g. stage, status, score" />
              </div>
            )}

            {triggerType === 'time_based' && (
              <div className="space-y-2 col-span-2">
                <Label>Schedule</Label>
                <Select value={triggerSchedule} onValueChange={setTriggerSchedule}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex justify-between items-center">
              <span>Conditions (AND)</span>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setConditions([...conditions, { field: "", operator: "equals", value: "" }])}>+ Add Condition</Button>
            </Label>
            {conditions.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2 text-center border border-dashed rounded">Always run when triggered</p>
            ) : (
              conditions.map((cond, i) => (
                <div key={i} className="flex gap-2 items-center bg-card border border-primary/10 p-2 rounded">
                  <Input
                    value={cond.field}
                    onChange={e => { const c = [...conditions]; c[i].field = e.target.value; setConditions(c); }}
                    placeholder="Field name"
                    className="h-8"
                  />
                  <Select value={cond.operator} onValueChange={(v: any) => { const c = [...conditions]; c[i].operator = v; setConditions(c); }}>
                    <SelectTrigger className="h-8 w-[140px]"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equals">Equals</SelectItem>
                      <SelectItem value="contains">Contains</SelectItem>
                      <SelectItem value="gt">Greater Than</SelectItem>
                      <SelectItem value="lt">Less Than</SelectItem>
                      <SelectItem value="gte">Greater or Equal</SelectItem>
                      <SelectItem value="lte">Less or Equal</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={String(cond.value || "")}
                    onChange={e => { const c = [...conditions]; c[i].value = e.target.value; setConditions(c); }}
                    placeholder="Value"
                    className="h-8"
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-4 w-4"/>
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex justify-between items-center">
              <span>Actions</span>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setActions([...actions, { type: "create_task", config: { title: "" } }])}>+ Add Action</Button>
            </Label>
            {actions.map((act, i) => (
              <div key={i} className="flex flex-col gap-2 bg-card border border-primary/10 p-2 rounded">
                <div className="flex gap-2 items-center">
                  <Select value={act.type} onValueChange={(v: any) => { const a = [...actions]; a[i].type = v; a[i].config = {}; setActions(a); }}>
                    <SelectTrigger className="h-8 flex-1"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="create_task">Create Task</SelectItem>
                      <SelectItem value="create_recommendation">AI Recommendation</SelectItem>
                      <SelectItem value="create_opportunity">Create Opportunity</SelectItem>
                      <SelectItem value="update_field">Update Field</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setActions(actions.filter((_, idx) => idx !== i))} disabled={actions.length === 1}>
                    <Trash2 className="h-4 w-4"/>
                  </Button>
                </div>

                {act.type === 'create_task' && (
                  <Input
                    value={String(act.config?.title || "")}
                    onChange={e => { const a = [...actions]; a[i].config = { ...a[i].config, title: e.target.value }; setActions(a); }}
                    placeholder="Task Title"
                    className="h-8 bg-background"
                  />
                )}
                {act.type === 'create_recommendation' && (
                  <Input
                    value={String(act.config?.action || "")}
                    onChange={e => { const a = [...actions]; a[i].config = { ...a[i].config, action: e.target.value }; setActions(a); }}
                    placeholder="Recommended Action"
                    className="h-8 bg-background"
                  />
                )}
                {act.type === 'create_opportunity' && (
                  <Input
                    value={String(act.config?.name || "")}
                    onChange={e => { const a = [...actions]; a[i].config = { ...a[i].config, name: e.target.value }; setActions(a); }}
                    placeholder="Opportunity Name"
                    className="h-8 bg-background"
                  />
                )}
                {act.type === 'update_field' && (
                  <div className="flex gap-2">
                    <Input
                      value={String(act.config?.field || "")}
                      onChange={e => { const a = [...actions]; a[i].config = { ...a[i].config, field: e.target.value }; setActions(a); }}
                      placeholder="Field Name"
                      className="h-8 bg-background flex-1"
                    />
                    <Input
                      value={String(act.config?.value || "")}
                      onChange={e => { const a = [...actions]; a[i].config = { ...a[i].config, value: e.target.value }; setActions(a); }}
                      placeholder="New Value"
                      className="h-8 bg-background flex-1"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {workflow?.id && (
            <div className="bg-primary/5 p-4 rounded-md border border-primary/20 space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="text-sm font-semibold font-display">Safe Dry-Run</h4>
                <div className="flex items-center gap-2">
                  <Select value={dryRunEntityId} onValueChange={setDryRunEntityId}>
                    <SelectTrigger className="h-8 w-[200px]"><SelectValue placeholder="Select target..."/></SelectTrigger>
                    <SelectContent>
                      {getOptions().map(opt => (
                        <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={handleTest} disabled={testWf.isPending || !dryRunEntityId}>
                    <Play className="h-3 w-3 mr-2"/> Run Test
                  </Button>
                </div>
              </div>
              {dryRunResult && (
                <div className="text-sm space-y-2 bg-background p-3 rounded border border-primary/10 animate-scaleInEntrance">
                  <p><strong>Conditions Matched:</strong> {dryRunResult.conditionsMatched ? "Yes" : "No"}</p>
                  <p><strong>Planned Actions:</strong> {dryRunResult.plannedActions.length}</p>
                  <div className="pl-2 border-l-2 border-primary/30">
                    {dryRunResult.plannedActions.map((pa, idx) => (
                      <p key={idx} className="font-mono text-xs">{pa.type} - {pa.status}</p>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground pt-2">Dry-run successful. You can now activate this version.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={pending || !name || actions.length === 0}>
            {pending ? "Saving..." : "Save Workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowAuditDialog({ orgId, workflowId, onClose }: { orgId: string, workflowId: string, onClose: () => void }) {
  const { data: executions, isLoading } = useListWorkflowExecutions(orgId, {
    query: { queryKey: getListWorkflowExecutionsQueryKey(orgId) }
  });

  const workflowExecutions = executions?.filter(e => e.workflowId === workflowId) || [];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Execution Audit Log
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {isLoading ? (
            <div className="h-32 skeleton rounded"></div>
          ) : workflowExecutions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No executions recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {workflowExecutions.map(ex => (
                <div key={ex.id} className="border border-border/50 rounded-md p-3 text-sm">
                  <div className="flex justify-between mb-2">
                    <span className="font-mono font-bold">{ex.entityType} {ex.entityId}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                      ex.status === 'success' ? 'bg-success/20 text-success' :
                      ex.status === 'failed' ? 'bg-destructive/20 text-destructive' : 'bg-primary/20 text-primary'
                    }`}>
                      {ex.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">Triggered at {formatDate(ex.createdAt)}</p>
                  {ex.actionResults.length > 0 && (
                    <div className="pl-3 border-l border-primary/20 space-y-1">
                      {ex.actionResults.map((ar, i) => (
                        <div key={i} className="text-xs font-mono">
                          {ar.type}: <span className={ar.status === 'success' ? "text-success" : "text-destructive"}>{ar.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {ex.errorMessage && <p className="text-xs text-destructive mt-2">{ex.errorMessage}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}