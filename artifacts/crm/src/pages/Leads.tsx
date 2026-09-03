import { useEffect, useState } from "react";
import {
  useListLeads, getListLeadsQueryKey,
  useUpdateLead, useDeleteLead, useQualifyLead, useRescoreLeads,
  useListLeadScoringRules, getListLeadScoringRulesQueryKey,
  useCreateLeadScoringRule, useUpdateLeadScoringRule, useDeleteLeadScoringRule,
  getListOpportunitiesQueryKey, getListAccountsQueryKey,
  useGetConversionPrediction, getGetConversionPredictionQueryKey,
  useRecomputeConversionPrediction
} from "@workspace/api-client-react";
import type { Lead, LeadCreate, LeadScoringRule, SegmentCondition } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgStore } from "@/store/org-store";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, UserPlus, Sparkles, Trash2, Pencil, ArrowUpRight, RefreshCw, CloudOff, Cloud, LoaderCircle } from "lucide-react";
import { formatDate, formatPredictionPercentage } from "@/lib/format";
import { useOfflineLeads } from "@/hooks/use-offline-leads";
import { subscribeToLeadQueue } from "@/lib/offline-leads";

const STATUS_COLORS: Record<string, string> = {
  new: "border-primary/40 text-primary",
  working: "border-amber-500/40 text-amber-400",
  qualified: "border-emerald-500/40 text-emerald-400",
  disqualified: "border-muted-foreground/40 text-muted-foreground",
};

const LEAD_FIELDS = [
  "company", "title", "industry", "companySize", "annualRevenue", "intentScore",
  "country", "state", "productInterest", "source", "email",
];
const OPERATORS = ["equals", "not_equals", "contains", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"] as const;

export default function Leads() {
  const { selectedOrgId } = useOrgStore();
  const orgId = selectedOrgId || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editRule, setEditRule] = useState<LeadScoringRule | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);

  const {
    data: leads,
    isLoading,
    isError: leadsFailed,
    error: leadsError,
    refetch: refetchLeads,
  } = useListLeads(orgId, undefined, {
    query: {
      enabled: !!orgId,
      retry: false,
      networkMode: "always",
      queryKey: getListLeadsQueryKey(orgId),
    },
  });
  const { data: rules } = useListLeadScoringRules(orgId, {
    query: {
      enabled: !!orgId,
      retry: false,
      networkMode: "always",
      queryKey: getListLeadScoringRulesQueryKey(orgId),
    },
  });

  const { pendingLeads, online, syncing, queueLead, syncNow } = useOfflineLeads(orgId);
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();
  const qualifyLead = useQualifyLead();
  const rescore = useRescoreLeads();
  const createRule = useCreateLeadScoringRule();
  const updateRule = useUpdateLeadScoringRule();
  const deleteRule = useDeleteLeadScoringRule();

  useEffect(
    () =>
      subscribeToLeadQueue(({ syncedLead, orgId: syncedOrgId }) => {
        if (syncedLead && syncedOrgId === orgId) {
          queryClient.setQueryData<Lead[]>(getListLeadsQueryKey(orgId), (current = []) =>
            current.some((lead) => lead.id === syncedLead.id) ? current : [syncedLead, ...current],
          );
          void queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey(orgId) });
        }
      }),
    [orgId, queryClient],
  );

  const invalidateLeads = () => queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey(orgId) });
  const invalidateRules = () => queryClient.invalidateQueries({ queryKey: getListLeadScoringRulesQueryKey(orgId) });

  const onError = (title: string) => (e: unknown) =>
    toast({ title, description: (e as Error).message, variant: "destructive" });

  const apiConnected = !leadsFailed && leads !== undefined;
  const connectionAvailable = online || apiConnected;

  if (isLoading && pendingLeads.length === 0) return <div className="p-4 sm:p-8"><div className="skeleton h-64 rounded-xl"></div></div>;

  return (
    <div>
      <header className="px-4 py-4 sm:px-8 sm:py-6 border-b border-primary/10 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display mb-1">Leads</h1>
          <p className="text-sm text-muted-foreground">Score, route, and qualify inbound leads.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2 flex-1 sm:flex-none"
            disabled={rescore.isPending || !connectionAvailable}
            onClick={() =>
              rescore.mutate({ orgId }, {
                onSuccess: (r) => { invalidateLeads(); toast({ title: "Leads rescored", description: `${r.leadsRescored} leads rescored and routed.` }); },
                onError: onError("Rescore failed"),
              })
            }
          >
            <RefreshCw className="h-4 w-4" /> {rescore.isPending ? "Rescoring..." : "Rescore all"}
          </Button>
          <Button className="gap-2 flex-1 sm:flex-none" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add lead
          </Button>
        </div>
      </header>

      <div className="p-4 sm:p-8">
        <div className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${connectionAvailable ? "border-primary/20 bg-primary/5" : "border-amber-500/30 bg-amber-500/10"}`}>
          <div className="flex items-center gap-2">
            {connectionAvailable ? <Cloud className="h-4 w-4 text-primary" /> : <CloudOff className="h-4 w-4 text-amber-400" />}
            <span>{connectionAvailable ? "Connected" : "Offline"}</span>
            {pendingLeads.length > 0 && (
              <span className="text-muted-foreground">
                · {pendingLeads.length} lead{pendingLeads.length === 1 ? "" : "s"} pending sync
              </span>
            )}
          </div>
          {pendingLeads.length > 0 && connectionAvailable && (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5" disabled={syncing} onClick={() => void syncNow()}>
              <LoaderCircle className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing" : "Sync now"}
            </Button>
          )}
        </div>
        <Tabs defaultValue="leads">
          <TabsList className="mb-4">
            <TabsTrigger value="leads">Leads</TabsTrigger>
            <TabsTrigger value="rules">Scoring rules</TabsTrigger>
          </TabsList>

          <TabsContent value="leads">
            <Card className="overflow-hidden">
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="hidden lg:table-cell">Assigned to</TableHead>
                      <TableHead className="hidden lg:table-cell">Territory</TableHead>
                      <TableHead className="text-right">Created</TableHead>
                      <TableHead className="w-40"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leadsFailed && pendingLeads.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="p-0">
                          <div className="flex min-h-[320px] flex-col items-center justify-center bg-background/30 px-6 py-16 text-center">
                            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
                              <CloudOff className="h-10 w-10 text-destructive opacity-70" />
                            </div>
                            <h3 className="mb-2 font-display text-2xl font-bold">Could not load leads</h3>
                            <p className="mb-6 max-w-md text-muted-foreground">
                              {leadsError instanceof Error
                                ? leadsError.message
                                : "Check your connection and try again."}
                            </p>
                            <Button variant="outline" className="gap-2" onClick={() => void refetchLeads()}>
                              <RefreshCw className="h-4 w-4" /> Try again
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : pendingLeads.length === 0 && (!leads || leads.length === 0) ? (
                      <TableRow>
                        <TableCell colSpan={8} className="p-0">
                          <div className="flex flex-col items-center justify-center min-h-[320px] px-6 py-16 bg-background/30 text-center">
                            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                              <UserPlus className="h-10 w-10 text-primary opacity-50" />
                            </div>
                            <h3 className="font-display text-2xl font-bold mb-2">No leads yet</h3>
                            <p className="text-muted-foreground max-w-sm">Add a lead and scoring rules will rank it automatically.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                      {pendingLeads.map((lead) => (
                        <TableRow key={lead.id} className="bg-amber-500/5">
                          <TableCell className="font-medium text-foreground">{lead.data.firstName} {lead.data.lastName}</TableCell>
                          <TableCell className="text-muted-foreground">{lead.data.company ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="border-amber-500/40 text-amber-400">Pending sync</Badge></TableCell>
                          <TableCell className="text-right text-muted-foreground">—</TableCell>
                          <TableCell className="hidden text-muted-foreground lg:table-cell">Unassigned</TableCell>
                          <TableCell className="hidden text-muted-foreground lg:table-cell">—</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground/80">{formatDate(lead.createdAt)}</TableCell>
                          <TableCell><span className="text-xs text-muted-foreground">{lead.lastError ? "Retry queued" : "Queued"}</span></TableCell>
                        </TableRow>
                      ))}
                      {(leads ?? []).map((lead) => (
                        <TableRow key={lead.id}>
                          <TableCell className="font-medium text-foreground">{lead.firstName} {lead.lastName}</TableCell>
                          <TableCell className="text-muted-foreground">{lead.company ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`capitalize ${STATUS_COLORS[lead.status] ?? ""}`}>{lead.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">{lead.score}</TableCell>
                          <TableCell className="hidden text-muted-foreground lg:table-cell">{lead.assignedToName ?? "Unassigned"}</TableCell>
                          <TableCell className="hidden text-muted-foreground lg:table-cell">{lead.territoryName ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground/80">{formatDate(lead.createdAt)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              {lead.status !== "qualified" && lead.status !== "disqualified" && (
                                <Button
                                  size="sm" variant="outline" className="gap-1.5"
                                  disabled={qualifyLead.isPending}
                                  onClick={() =>
                                    qualifyLead.mutate({ orgId, leadId: lead.id, data: {} }, {
                                      onSuccess: () => {
                                        invalidateLeads();
                                        queryClient.invalidateQueries({ queryKey: getListOpportunitiesQueryKey(orgId) });
                                        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(orgId) });
                                        toast({ title: "Lead qualified", description: "An opportunity was created in your pipeline." });
                                      },
                                      onError: onError("Could not qualify lead"),
                                    })
                                  }
                                >
                                  <ArrowUpRight className="h-3.5 w-3.5" /> Qualify
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => setEditLead(lead)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button
                                size="sm" variant="ghost"
                                onClick={() =>
                                  deleteLead.mutate({ orgId, leadId: lead.id }, { onSuccess: invalidateLeads, onError: onError("Could not delete lead") })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      </>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rules">
            <div className="flex justify-end mb-3">
              <Button className="gap-2" onClick={() => { setEditRule(null); setRuleOpen(true); }}>
                <Sparkles className="h-4 w-4" /> New rule
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule</TableHead>
                      <TableHead>Conditions</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Priority</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!rules || rules.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No scoring rules yet. Rules add or set points when all conditions match.</TableCell></TableRow>
                    ) : (
                      rules.map((rule) => (
                        <TableRow key={rule.id}>
                          <TableCell className="font-medium text-foreground">{rule.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-md">
                            {rule.conditions.map((c, i) => (
                              <span key={i}>{i > 0 && " AND "}<span className="font-mono">{c.field} {c.operator.replace("_", " ")} {c.value ?? ""}</span></span>
                            ))}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{rule.actionType === "add" ? `+${rule.points}` : `= ${rule.points}`}</TableCell>
                          <TableCell className="text-right font-mono">{rule.priority}</TableCell>
                          <TableCell>
                            <Switch
                              checked={rule.isActive}
                              onCheckedChange={(isActive) =>
                                updateRule.mutate(
                                  { orgId, ruleId: rule.id, data: { name: rule.name, conditions: rule.conditions, actionType: rule.actionType, points: rule.points, priority: rule.priority, isActive } },
                                  { onSuccess: invalidateRules, onError: onError("Could not update rule") },
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => { setEditRule(rule); setRuleOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => deleteRule.mutate({ orgId, ruleId: rule.id }, { onSuccess: invalidateRules, onError: onError("Could not delete rule") })}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {(createOpen || editLead) && (
        <LeadFormDialog
          orgId={orgId}
          lead={editLead}
          pending={updateLead.isPending}
          onClose={() => { setCreateOpen(false); setEditLead(null); }}
          onSave={(data) => {
            const opts = {
              onSuccess: () => { setCreateOpen(false); setEditLead(null); invalidateLeads(); },
              onError: onError("Could not save lead"),
            };
            if (editLead) updateLead.mutate({ orgId, leadId: editLead.id, data }, opts);
            else {
              void queueLead(data as unknown as LeadCreate)
                .then(() => {
                  setCreateOpen(false);
                  toast({
                    title: online ? "Lead saved for sync" : "Lead queued offline",
                    description: online ? "Syncing with the server now." : "It will sync automatically when you're back online.",
                  });
                })
                .catch(onError("Could not queue lead"));
            }
          }}
        />
      )}

      {ruleOpen && (
        <RuleFormDialog
          rule={editRule}
          pending={createRule.isPending || updateRule.isPending}
          onClose={() => { setRuleOpen(false); setEditRule(null); }}
          onSave={(data) => {
            const opts = { onSuccess: () => { setRuleOpen(false); setEditRule(null); invalidateRules(); }, onError: onError("Could not save rule") };
            if (editRule) updateRule.mutate({ orgId, ruleId: editRule.id, data }, opts);
            else createRule.mutate({ orgId, data }, opts);
          }}
        />
      )}
    </div>
  );
}

function LeadFormDialog({ orgId, lead, onClose, onSave, pending }: {
  orgId: string;
  lead: Lead | null;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [form, setForm] = useState({
    firstName: lead?.firstName ?? "",
    lastName: lead?.lastName ?? "",
    email: lead?.email ?? "",
    company: lead?.company ?? "",
    title: lead?.title ?? "",
    industry: lead?.industry ?? "",
    companySize: lead?.companySize?.toString() ?? "",
    annualRevenue: lead?.annualRevenue ?? "",
    intentScore: lead?.intentScore?.toString() ?? "",
    country: lead?.country ?? "",
    state: lead?.state ?? "",
    productInterest: lead?.productInterest ?? "",
    source: lead?.source ?? "",
    status: lead?.status ?? "new",
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] w-[calc(100%-1rem)] overflow-y-auto p-4 sm:p-6">
        <DialogHeader><DialogTitle className="font-display">{lead ? "Edit lead" : "Add lead"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label>First name</Label><Input value={form.firstName} onChange={set("firstName")} /></div>
          <div className="space-y-2"><Label>Last name</Label><Input value={form.lastName} onChange={set("lastName")} /></div>
          <div className="space-y-2 sm:col-span-2"><Label>Email</Label><Input type="email" value={form.email} onChange={set("email")} /></div>
          <div className="space-y-2"><Label>Company</Label><Input value={form.company} onChange={set("company")} /></div>
          <div className="space-y-2"><Label>Title</Label><Input value={form.title} onChange={set("title")} /></div>
          <div className="space-y-2"><Label>Industry</Label><Input value={form.industry} onChange={set("industry")} /></div>
          <div className="space-y-2"><Label>Company size</Label><Input type="number" min="0" value={form.companySize} onChange={set("companySize")} className="font-mono" /></div>
          <div className="space-y-2"><Label>Annual revenue (USD)</Label><Input type="number" min="0" value={form.annualRevenue} onChange={set("annualRevenue")} className="font-mono" /></div>
          <div className="space-y-2"><Label>Intent score (0-100)</Label><Input type="number" min="0" max="100" value={form.intentScore} onChange={set("intentScore")} className="font-mono" /></div>
          <div className="space-y-2"><Label>Country</Label><Input value={form.country} onChange={set("country")} placeholder="US" /></div>
          <div className="space-y-2"><Label>State</Label><Input value={form.state} onChange={set("state")} placeholder="CA" /></div>
          <div className="space-y-2"><Label>Product interest</Label><Input value={form.productInterest} onChange={set("productInterest")} /></div>
          <div className="space-y-2"><Label>Source</Label><Input value={form.source} onChange={set("source")} placeholder="webinar, referral..." /></div>
          {lead && (
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(status) => setForm((f) => ({ ...f, status: status as typeof f.status }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["new", "working", "qualified", "disqualified"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {lead && (
          <div className="mt-6 border-t border-primary/10 pt-4">
            <LeadConversionPrediction orgId={orgId} leadId={lead.id} />
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!form.firstName || !form.lastName || !form.email || pending}
            onClick={() =>
              onSave({
                firstName: form.firstName,
                lastName: form.lastName,
                email: form.email,
                company: form.company || null,
                title: form.title || null,
                industry: form.industry || null,
                companySize: form.companySize ? Number(form.companySize) : null,
                annualRevenue: form.annualRevenue ? form.annualRevenue : null,
                intentScore: form.intentScore ? Number(form.intentScore) : null,
                country: form.country || null,
                state: form.state || null,
                productInterest: form.productInterest || null,
                source: form.source || null,
                ...(lead ? { status: form.status } : {}),
              })
            }
          >
            {pending ? "Saving..." : "Save lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleFormDialog({ rule, onClose, onSave, pending }: {
  rule: LeadScoringRule | null;
  onClose: () => void;
  onSave: (data: { name: string; conditions: SegmentCondition[]; actionType: "add" | "set"; points: number; priority?: number; isActive?: boolean }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [actionType, setActionType] = useState<"add" | "set">(rule?.actionType ?? "add");
  const [points, setPoints] = useState(rule?.points?.toString() ?? "10");
  const [priority, setPriority] = useState(rule?.priority?.toString() ?? "0");
  const [conditions, setConditions] = useState<SegmentCondition[]>(
    rule?.conditions?.length ? rule.conditions : [{ field: "industry", operator: "equals", value: "" }],
  );

  const updateCondition = (i: number, patch: Partial<SegmentCondition>) =>
    setConditions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">{rule ? "Edit scoring rule" : "New scoring rule"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Rule name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enterprise intent boost" /></div>
          <div>
            <Label className="mb-2 block">Conditions (all must match)</Label>
            <div className="space-y-2">
              {conditions.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select value={c.field} onValueChange={(field) => updateCondition(i, { field })}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>{LEAD_FIELDS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={c.operator} onValueChange={(operator) => updateCondition(i, { operator: operator as SegmentCondition["operator"] })}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o.replace("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                  {c.operator !== "is_empty" && c.operator !== "is_not_empty" && (
                    <Input className="flex-1" value={c.value ?? ""} onChange={(e) => updateCondition(i, { value: e.target.value })} />
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))} disabled={conditions.length === 1}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => setConditions((cs) => [...cs, { field: "industry", operator: "equals", value: "" }])}>
              <Plus className="h-3.5 w-3.5" /> Add condition
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Action</Label>
              <Select value={actionType} onValueChange={(v) => setActionType(v as "add" | "set")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Add points</SelectItem>
                  <SelectItem value="set">Set score</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Points</Label><Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} className="font-mono" /></div>
            <div className="space-y-2"><Label>Priority</Label><Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} className="font-mono" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name || !points || pending}
            onClick={() =>
              onSave({
                name,
                conditions,
                actionType,
                points: Number(points),
                priority: Number(priority) || 0,
                isActive: rule?.isActive ?? true,
              })
            }
          >
            {pending ? "Saving..." : "Save rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeadConversionPrediction({ orgId, leadId }: { orgId: string; leadId: string }) {
  const queryClient = useQueryClient();
  const { data: prediction, isLoading } = useGetConversionPrediction(orgId, leadId, {
    query: { queryKey: getGetConversionPredictionQueryKey(orgId, leadId) }
  });

  const recompute = useRecomputeConversionPrediction();

  const handleRecompute = () => {
    recompute.mutate(
      { orgId, leadId },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetConversionPredictionQueryKey(orgId, leadId) })
      }
    );
  };

  if (isLoading) {
    return <div className="h-20 skeleton rounded-md w-full"></div>;
  }

  if (!prediction) {
    return (
      <div className="bg-primary/5 rounded-md p-4 text-center border border-primary/10">
        <p className="text-sm text-muted-foreground mb-2">No AI prediction available yet.</p>
        <Button size="sm" variant="outline" onClick={handleRecompute} disabled={recompute.isPending} className="gap-2">
          <Sparkles className="h-3.5 w-3.5" /> Generate Prediction
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-background border border-primary/20 rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold font-display flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> AI Conversion Prediction
        </h4>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleRecompute} disabled={recompute.isPending}>
          <RefreshCw className={`h-3 w-3 mr-1 ${recompute.isPending ? "animate-spin" : ""}`} />
          Recompute
        </Button>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-center bg-card rounded-md border border-primary/10 p-3 flex-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Probability</p>
          <p className="text-2xl font-mono font-bold text-foreground">{formatPredictionPercentage(prediction.conversionProbability)}</p>
        </div>
        {prediction.predictedCloseDate && (
          <div className="text-center bg-card rounded-md border border-primary/10 p-3 flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Expected Close</p>
            <p className="text-xl font-mono font-medium text-foreground">{formatDate(prediction.predictedCloseDate)}</p>
          </div>
        )}
      </div>

      {prediction.factors && prediction.factors.length > 0 && (
        <div className="space-y-2 mt-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Key Factors</p>
          <div className="space-y-2">
            {prediction.factors.map((f, i) => (
              <div key={i} className="flex justify-between items-start text-sm bg-card/50 p-2 rounded border border-border/50">
                <div>
                  <p className="font-medium text-foreground">{f.factor}</p>
                  <p className="text-xs text-muted-foreground">{f.detail}</p>
                </div>
                <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${f.weight > 0 ? "text-success bg-success/10" : "text-destructive bg-destructive/10"}`}>
                  {f.weight > 0 ? "+" : ""}{f.weight}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
