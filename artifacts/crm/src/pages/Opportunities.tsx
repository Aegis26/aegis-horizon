import { useMemo, useState } from "react";
import {
  useListOpportunities, getListOpportunitiesQueryKey,
  useListPipelines, getListPipelinesQueryKey,
  useListAccounts, getListAccountsQueryKey,
  useCreateOpportunity, useUpdateOpportunity, useConvertOpportunityToCustomer,
  useGetOpportunity, getGetOpportunityQueryKey,
  useCreateQuote, getListQuotesQueryKey,
  useGetClosePrediction, getGetClosePredictionQueryKey,
  useRecomputeClosePrediction,
} from "@workspace/api-client-react";
import type { Opportunity, ClosePrediction } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgStore } from "@/store/org-store";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Lock, Plus, Target, LayoutGrid, List, FileText, Trophy, History, Sparkles, RefreshCw } from "lucide-react";
import { formatDollars, formatDate, formatPredictionPercentage } from "@/lib/format";

function LockedState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
      <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-6">
        <Lock className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight mb-2 font-display">Sales Module Locked</h2>
      <p className="text-muted-foreground mb-8">
        The Opportunities and Pipeline feature set is not enabled for your organization.
        Upgrade your plan or customize your features to access this module.
      </p>
      <Link href="/billing">
        <Button size="lg" className="font-display">Manage Features</Button>
      </Link>
    </div>
  );
}

export default function Opportunities() {
  const { selectedOrgId } = useOrgStore();
  const orgId = selectedOrgId || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const enabled = { query: { enabled: !!orgId, retry: false } } as const;
  const { data: opps, error, isLoading } = useListOpportunities(orgId, undefined, {
    query: { enabled: !!orgId, retry: false, queryKey: getListOpportunitiesQueryKey(orgId) },
  });
  const { data: pipelines } = useListPipelines(orgId, {
    query: { ...enabled.query, queryKey: getListPipelinesQueryKey(orgId) },
  });
  const { data: accounts } = useListAccounts(orgId, undefined, {
    query: { ...enabled.query, queryKey: getListAccountsQueryKey(orgId) },
  });

  const updateOpp = useUpdateOpportunity();
  const createOpp = useCreateOpportunity();

  const pipeline = pipelines?.[0];
  const stages = useMemo(
    () => (pipeline?.stages ?? []).slice().sort((a, b) => a.order - b.order),
    [pipeline],
  );
  const accountName = (id: string | undefined) =>
    (id && accounts?.find((a) => a.id === id)?.name) || "";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListOpportunitiesQueryKey(orgId) });
    if (detailId) queryClient.invalidateQueries({ queryKey: getGetOpportunityQueryKey(orgId, detailId) });
  };

  if (error && (error as { status?: number }).status === 403) return <LockedState />;
  if (isLoading) return <div className="p-8"><div className="skeleton h-64 rounded-xl"></div></div>;

  const moveToStage = (oppId: string, stage: string) => {
    const opp = opps?.find((o) => o.id === oppId);
    if (!opp || opp.stage === stage) return;
    updateOpp.mutate(
      { orgId, opportunityId: oppId, data: { stage } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Stage updated", description: `Moved to ${stages.find((s) => s.key === stage)?.name ?? stage}.` });
        },
        onError: (e) => toast({ title: "Could not move deal", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  const openOpps = (opps ?? []).filter((o) => o.forecastCategory !== "closed_lost");
  const totalPipeline = openOpps
    .filter((o) => o.forecastCategory !== "closed_won")
    .reduce((sum, o) => sum + (o.value ? Number(o.value) : 0), 0);

  return (
    <div>
      <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Open pipeline: <span className="font-mono text-foreground">{formatDollars(totalPipeline)}</span>
            {" · "}{openOpps.filter((o) => o.forecastCategory !== "closed_won").length} open deals
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <Button variant={view === "kanban" ? "secondary" : "ghost"} size="sm" className="rounded-none" onClick={() => setView("kanban")}>
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" className="rounded-none" onClick={() => setView("list")}>
              <List className="h-4 w-4" />
            </Button>
          </div>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create opportunity
          </Button>
        </div>
      </header>

      {view === "kanban" ? (
        <div className="p-6 overflow-x-auto">
          <div className="flex gap-4 min-w-max items-start">
            {stages.map((stage) => {
              const stageOpps = (opps ?? []).filter((o) => o.stage === stage.key);
              const stageValue = stageOpps.reduce((s, o) => s + (o.value ? Number(o.value) : 0), 0);
              return (
                <div
                  key={stage.key}
                  className={`w-72 shrink-0 rounded-lg border ${dragOverStage === stage.key ? "border-primary bg-primary/5" : "border-border/60 bg-background/40"}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.key); }}
                  onDragLeave={() => setDragOverStage((s) => (s === stage.key ? null : s))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverStage(null);
                    const id = e.dataTransfer.getData("text/plain") || dragId;
                    if (id) moveToStage(id, stage.key);
                    setDragId(null);
                  }}
                >
                  <div className="px-3 py-2.5 border-b border-border/60 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold font-display">{stage.name}</span>
                      <Badge variant="outline" className="font-mono text-xs">{stageOpps.length}</Badge>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{formatDollars(stageValue)}</span>
                  </div>
                  <div className="p-2 space-y-2 min-h-[120px]">
                    {stageOpps.map((opp) => (
                      <div
                        key={opp.id}
                        draggable
                        onDragStart={(e) => { setDragId(opp.id); e.dataTransfer.setData("text/plain", opp.id); }}
                        onClick={() => setDetailId(opp.id)}
                        className="rounded-md border border-border/60 bg-card p-3 cursor-pointer hover:border-primary/40 transition-colors"
                      >
                        <p className="text-sm font-medium text-foreground leading-tight mb-1">{opp.name}</p>
                        <p className="text-xs text-muted-foreground truncate mb-2">{accountName(opp.accountId)}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-mono font-medium text-foreground">
                            {opp.value ? formatDollars(Number(opp.value)) : "—"}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground">{opp.probability ?? 0}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="p-8">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal Name</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Probability</TableHead>
                    <TableHead className="text-right">Expected Close</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {opps?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="p-0">
                        <div className="flex flex-col items-center justify-center min-h-[384px] px-6 py-20 bg-background/30 text-center">
                          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                            <Target className="h-10 w-10 text-primary opacity-50" />
                          </div>
                          <h3 className="font-display text-2xl font-bold mb-2">No opportunities yet</h3>
                          <p className="text-muted-foreground max-w-sm">
                            Create your first opportunity or qualify a lead to start building pipeline.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    opps?.map((opp) => (
                      <TableRow key={opp.id} className="cursor-pointer" onClick={() => setDetailId(opp.id)}>
                        <TableCell className="font-medium text-foreground">{opp.name}</TableCell>
                        <TableCell className="text-muted-foreground">{accountName(opp.accountId)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {(stages.find((s) => s.key === opp.stage)?.name ?? opp.stage).replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium text-foreground">
                          {opp.value ? formatDollars(Number(opp.value)) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground/80">
                          {opp.probability != null ? `${opp.probability}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground/80">
                          {formatDate(opp.expectedCloseDate)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <CreateOpportunityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        orgId={orgId}
        accounts={accounts ?? []}
        stages={stages}
        onCreate={(data) =>
          createOpp.mutate(
            { orgId, data },
            {
              onSuccess: () => {
                setCreateOpen(false);
                invalidate();
                toast({ title: "Opportunity created" });
              },
              onError: (e) => toast({ title: "Could not create opportunity", description: (e as Error).message, variant: "destructive" }),
            },
          )
        }
        pending={createOpp.isPending}
      />

      {detailId && (
        <OpportunityDetailDialog
          orgId={orgId}
          opportunityId={detailId}
          stages={stages}
          onClose={() => setDetailId(null)}
          onInvalidate={invalidate}
          onGoToQuotes={() => navigate("/quotes")}
        />
      )}
    </div>
  );
}

function CreateOpportunityDialog({
  open, onOpenChange, orgId, accounts, stages, onCreate, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  accounts: { id: string; name: string }[];
  stages: { key: string; name: string }[];
  onCreate: (data: { accountId: string; name: string; stage?: string; value?: string | null; expectedCloseDate?: string | null }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [stage, setStage] = useState("");
  const [value, setValue] = useState("");
  const [closeDate, setCloseDate] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display">Create opportunity</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Deal name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme expansion" />
          </div>
          <div className="space-y-2">
            <Label>Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Stage</Label>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger><SelectValue placeholder="First stage" /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value (USD)</Label>
              <Input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} placeholder="50000" className="font-mono" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Expected close date</Label>
            <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className="font-mono" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!name || !accountId || pending}
            onClick={() =>
              onCreate({
                accountId,
                name,
                stage: stage || undefined,
                value: value ? value : null,
                expectedCloseDate: closeDate || null,
              })
            }
          >
            {pending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpportunityDetailDialog({
  orgId, opportunityId, stages, onClose, onInvalidate, onGoToQuotes,
}: {
  orgId: string;
  opportunityId: string;
  stages: { key: string; name: string }[];
  onClose: () => void;
  onInvalidate: () => void;
  onGoToQuotes: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: opp } = useGetOpportunity(orgId, opportunityId, {
    query: { queryKey: getGetOpportunityQueryKey(orgId, opportunityId) },
  });
  const updateOpp = useUpdateOpportunity();
  const convert = useConvertOpportunityToCustomer();
  const createQuote = useCreateQuote();

  if (!opp) return null;
  const isClosed = opp.forecastCategory === "closed_won" || opp.forecastCategory === "closed_lost";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{opp.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div><span className="text-muted-foreground">Account</span><p className="font-medium">{opp.accountName ?? "—"}</p></div>
            <div><span className="text-muted-foreground">Owner</span><p className="font-medium">{opp.ownerName ?? "Unassigned"}</p></div>
            <div><span className="text-muted-foreground">Value</span><p className="font-mono font-medium">{opp.value ? formatDollars(Number(opp.value)) : "—"}</p></div>
            <div><span className="text-muted-foreground">Probability</span><p className="font-mono font-medium">{opp.probability ?? 0}%</p></div>
            <div><span className="text-muted-foreground">Expected close</span><p className="font-mono">{formatDate(opp.expectedCloseDate)}</p></div>
            <div><span className="text-muted-foreground">Forecast</span><p className="capitalize">{(opp.forecastCategory ?? "pipeline").replace("_", " ")}</p></div>
          </div>

          <div className="space-y-2">
            <Label>Stage</Label>
            <Select
              value={opp.stage}
              onValueChange={(stage) =>
                updateOpp.mutate(
                  { orgId, opportunityId, data: { stage } },
                  {
                    onSuccess: onInvalidate,
                    onError: (e) => toast({ title: "Could not update stage", description: (e as Error).message, variant: "destructive" }),
                  },
                )
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {opp.stageHistory.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2 flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> Stage history</p>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                {opp.stageHistory.map((h) => (
                  <div key={h.id} className="text-xs text-muted-foreground flex justify-between gap-2">
                    <span>
                      {h.fromStage ? `${stages.find((s) => s.key === h.fromStage)?.name ?? h.fromStage} → ` : "Created in "}
                      {stages.find((s) => s.key === h.toStage)?.name ?? h.toStage}
                      {h.changedByName ? ` · ${h.changedByName}` : ""}
                    </span>
                    <span className="font-mono shrink-0">{formatDate(h.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isClosed && (
            <div className="border-t border-primary/10 pt-4">
              <OpportunityClosePrediction orgId={orgId} opportunityId={opportunityId} />
            </div>
          )}
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            className="gap-2"
            disabled={createQuote.isPending}
            onClick={() =>
              createQuote.mutate(
                { orgId, data: { opportunityId } },
                {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getListQuotesQueryKey(orgId) });
                    toast({ title: "Quote created", description: "A draft quote was created from this opportunity." });
                    onGoToQuotes();
                  },
                  onError: (e) => toast({ title: "Could not create quote", description: (e as Error).message, variant: "destructive" }),
                },
              )
            }
          >
            <FileText className="h-4 w-4" /> {createQuote.isPending ? "Creating..." : "Create quote"}
          </Button>
          {!isClosed && (
            <Button
              className="gap-2"
              disabled={convert.isPending}
              onClick={() =>
                convert.mutate(
                  { orgId, opportunityId },
                  {
                    onSuccess: () => {
                      onInvalidate();
                      toast({ title: "Deal won", description: "Opportunity closed won and account marked as customer." });
                    },
                    onError: (e) => toast({ title: "Could not convert", description: (e as Error).message, variant: "destructive" }),
                  },
                )
              }
            >
              <Trophy className="h-4 w-4" /> {convert.isPending ? "Converting..." : "Mark won / convert"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpportunityClosePrediction({ orgId, opportunityId }: { orgId: string; opportunityId: string }) {
  const queryClient = useQueryClient();
  const { data: prediction, isLoading } = useGetClosePrediction(orgId, opportunityId, {
    query: { queryKey: getGetClosePredictionQueryKey(orgId, opportunityId) }
  });

  const recompute = useRecomputeClosePrediction();

  const handleRecompute = () => {
    recompute.mutate(
      { orgId, opportunityId },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetClosePredictionQueryKey(orgId, opportunityId) })
      }
    );
  };

  if (isLoading) {
    return <div className="h-20 skeleton rounded-md w-full"></div>;
  }

  if (!prediction) {
    return (
      <div className="bg-primary/5 rounded-md p-4 text-center border border-primary/10">
        <p className="text-sm text-muted-foreground mb-2">No close prediction available yet.</p>
        <Button size="sm" variant="outline" onClick={handleRecompute} disabled={recompute.isPending} className="gap-2">
          <Sparkles className="h-3.5 w-3.5" /> Analyze Deal
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-background border border-primary/20 rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold font-display flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Deal Prediction
        </h4>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] font-mono capitalize">
            Confidence: {formatPredictionPercentage(prediction.confidence)}
          </Badge>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleRecompute} disabled={recompute.isPending}>
            <RefreshCw className={`h-3 w-3 mr-1 ${recompute.isPending ? "animate-spin" : ""}`} />
            Recompute
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-center bg-card rounded-md border border-primary/10 p-3 flex-1 relative">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Win Probability</p>
          <p className="text-2xl font-mono font-bold text-foreground">{formatPredictionPercentage(prediction.predictedProbability)}</p>
          <p className="text-[10px] text-muted-foreground mt-1 absolute bottom-1 right-2">Base: {formatPredictionPercentage(prediction.baselineByStage)}</p>
        </div>
        {prediction.expectedCloseDate && (
          <div className="text-center bg-card rounded-md border border-primary/10 p-3 flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Expected Close</p>
            <p className="text-xl font-mono font-medium text-foreground">{formatDate(prediction.expectedCloseDate)}</p>
          </div>
        )}
      </div>

      {prediction.adjustmentFactors && prediction.adjustmentFactors.length > 0 && (
        <div className="space-y-2 mt-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Analysis Factors</p>
          <div className="space-y-2">
            {prediction.adjustmentFactors.map((f, i) => (
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
