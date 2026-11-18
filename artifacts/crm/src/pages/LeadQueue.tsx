import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { useListLeadQueue, getListLeadQueueQueryKey } from "@workspace/api-client-react";
import type { LeadQueueItem, ListLeadQueueStatus } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Inbox, RefreshCw, CloudOff, Undo2 } from "lucide-react";
import { formatDate } from "@/lib/format";
import { DISMISS_REASONS, LEAD_QUEUE_POLL_MS, LEAD_TYPE_LABELS } from "@/lib/lead-queue";
import type { DismissReason } from "@/lib/lead-queue";
import { useLeadQueueActions } from "@/hooks/use-lead-queue-actions";

const SELECT = "block w-full rounded border bg-background p-2 text-sm sm:w-auto";

export default function LeadQueue() {
  const { selectedOrgId } = useOrgStore();
  const orgId = selectedOrgId || "";
  const [status, setStatus] = useState<ListLeadQueueStatus>("queued");
  const [type, setType] = useState("all");
  const [minScore, setMinScore] = useState("0");
  const [source, setSource] = useState("all");
  const [existing, setExisting] = useState("all");
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    setStatus("queued"); setType("all"); setMinScore("0"); setSource("all"); setExisting("all"); setDetailId(null);
  }, [orgId]);

  const params = { status };
  const { data, isLoading, isError, error, refetch } = useListLeadQueue(orgId, params, {
    query: { enabled: !!orgId, queryKey: getListLeadQueueQueryKey(orgId, params), refetchInterval: LEAD_QUEUE_POLL_MS },
  });
  const canManage = !!data?.canManage;
  useEffect(() => { if (data && !data.canManage && status === "assigned") setStatus("queued"); }, [data, status]);

  const items = data?.items;
  const sources = useMemo(() => Array.from(new Set((items ?? []).map((i) => i.radar.source))).sort(), [items]);
  const visible = useMemo(() =>
    (items ?? [])
      .filter((i) =>
        (type === "all" || i.radar.lead_type === type) &&
        i.score >= Number(minScore) &&
        (source === "all" || i.radar.source === source) &&
        (existing === "all" || (existing === "yes") === !!i.existingAccountName))
      .sort((a, b) => b.score - a.score || +new Date(b.queuedAt) - +new Date(a.queuedAt)),
  [items, type, minScore, source, existing]);
  const detail = items?.find((i) => i.id === detailId) ?? null;

  const { act, pendingLeadId, pending } = useLeadQueueActions(orgId);
  const filtering = type !== "all" || minScore !== "0" || source !== "all" || existing !== "all";

  return (
    <div>
      <header className="px-4 py-4 sm:px-8 sm:py-6 border-b border-primary/10 flex flex-col gap-1 bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display mb-1 flex items-center gap-3">
          Lead Queue
          {data && <span data-testid="text-queued-count" className="rounded-full bg-primary/15 px-2.5 py-0.5 font-mono text-sm text-primary">{data.totalQueued}</span>}
        </h1>
        <p className="text-sm text-muted-foreground">Claim scored inbound prospects before they become customers.</p>
      </header>

      <div className="p-4 sm:p-8">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-4">
          <div><Label htmlFor="q-status">Status</Label>
            <select id="q-status" data-testid="select-status" className={SELECT} value={status} onChange={(e) => { setStatus(e.target.value as ListLeadQueueStatus); setDetailId(null); }}>
              <option value="queued">Queued</option><option value="dismissed">Dismissed</option>
              {canManage && <option value="assigned">Assigned</option>}
            </select>
          </div>
          <div><Label htmlFor="q-type">Lead type</Label>
            <select id="q-type" data-testid="select-type" className={SELECT} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All types</option>
              {Object.entries(LEAD_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><Label htmlFor="q-score">Score at least</Label>
            <select id="q-score" data-testid="select-score" className={SELECT} value={minScore} onChange={(e) => setMinScore(e.target.value)}>
              <option value="0">Any score</option>
              {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </div>
          <div><Label htmlFor="q-source">Source</Label>
            <select id="q-source" data-testid="select-source" className={SELECT} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="all">All sources</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><Label htmlFor="q-existing">Existing account</Label>
            <select id="q-existing" data-testid="select-existing" className={SELECT} value={existing} onChange={(e) => setExisting(e.target.value)}>
              <option value="all">Any</option><option value="yes">Existing account</option><option value="no">New company</option>
            </select>
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            {isLoading || !data ? (
              isError ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-16 text-center">
                  <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10"><CloudOff className="h-10 w-10 text-destructive opacity-70" /></div>
                  <h3 className="mb-2 font-display text-2xl font-bold">Could not load the queue</h3>
                  <p className="mb-6 max-w-md text-muted-foreground">{error instanceof Error ? error.message : "Check your connection and try again."}</p>
                  <Button variant="outline" className="gap-2" data-testid="button-retry" onClick={() => void refetch()}><RefreshCw className="h-4 w-4" /> Try again</Button>
                </div>
              ) : (
                <div className="space-y-2 p-4">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-12 rounded" />)}</div>
              )
            ) : visible.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-16 text-center">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10"><Inbox className="h-10 w-10 text-primary opacity-50" /></div>
                <h3 className="mb-2 font-display text-2xl font-bold">{filtering ? "No leads match these filters" : status === "queued" ? "Queue is clear" : `No ${status} leads`}</h3>
                <p className="max-w-sm text-muted-foreground">New inbound prospects land here, ranked by score.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14 text-right">Score</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="hidden md:table-cell">Signal</TableHead>
                    <TableHead className="hidden lg:table-cell">Source</TableHead>
                    <TableHead className="text-right">{status === "assigned" ? "Assigned to" : status === "dismissed" ? "Reason" : "Age"}</TableHead>
                    <TableHead className="w-28"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((item) => (
                    <TableRow key={item.id} data-testid={`row-lead-queue-${item.id}`} className="cursor-pointer" onClick={() => setDetailId(item.id)}>
                      <TableCell className="text-right font-mono text-lg font-bold text-primary">{item.score}</TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{item.company}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {item.radar.city && <span className="mr-1 text-xs text-muted-foreground">{item.radar.city}</span>}
                          <Badge variant="outline" className="text-[10px]">{LEAD_TYPE_LABELS[item.radar.lead_type] ?? item.radar.lead_type}</Badge>
                          {item.existingAccountName && <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-400">Existing account: {item.existingAccountName}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-sm md:table-cell"><p className="truncate text-sm text-muted-foreground">{item.radar.signal_summary}</p></TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{item.radar.source}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {status === "assigned" ? item.assignedToName ?? "—" : status === "dismissed" ? item.dismissReason ?? "—" : formatDistanceToNowStrict(new Date(item.queuedAt))}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">
                          {item.status === "queued" ? (
                            <Button size="sm" variant="outline" data-testid={`button-claim-${item.id}`} disabled={pending} onClick={() => act(item.id, { action: "claim" }, item.company)}>
                              {pendingLeadId === item.id ? "Claiming..." : "Claim"}
                            </Button>
                          ) : canManage && item.canReturn ? (
                            <Button size="sm" variant="outline" className="gap-1.5" data-testid={`button-return-${item.id}`} disabled={pending} onClick={() => act(item.id, { action: "return" }, item.company)}>
                              <Undo2 className="h-3.5 w-3.5" /> Return
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" data-testid={`button-view-${item.id}`} onClick={() => setDetailId(item.id)}>View</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {detail && data && (
        <LeadQueueDetail
          key={detail.id}
          item={detail}
          canManage={canManage}
          members={data.members}
          pending={pending}
          onClose={() => setDetailId(null)}
          onAct={(action) => act(detail.id, action, detail.company, () => setDetailId(null))}
        />
      )}
    </div>
  );
}

function LeadQueueDetail({ item, canManage, members, pending, onClose, onAct }: {
  item: LeadQueueItem;
  canManage: boolean;
  members: { id: string; name: string }[];
  pending: boolean;
  onClose: () => void;
  onAct: (action: { action: "claim" | "assign" | "return" | "dismiss"; assigneeId?: string; reason?: DismissReason }) => void;
}) {
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState<DismissReason | "">("");
  const r = item.radar;
  const queued = item.status === "queued";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] w-[calc(100%-1rem)] overflow-y-auto p-4 sm:p-6" data-testid="dialog-lead-queue-detail">
        <DialogHeader><DialogTitle className="font-display">{item.company}</DialogTitle></DialogHeader>
        <section className="space-y-3 rounded border border-primary/30 bg-primary/5 p-4">
          <div className="flex flex-wrap gap-2">
            <Badge>{r.score}/10</Badge>
            <Badge variant="outline">{LEAD_TYPE_LABELS[r.lead_type] ?? r.lead_type}</Badge>
            <Badge variant="outline" className="capitalize">{item.status}</Badge>
            {item.existingAccountName && <Badge variant="outline" className="border-amber-500/40 text-amber-400">Existing account: {item.existingAccountName}</Badge>}
          </div>
          <p className="text-sm">{r.signal_summary}</p>
          {r.suggested_offer && <p className="text-sm"><strong>Suggested offer: </strong>{r.suggested_offer}</p>}
          {r.talking_points && r.talking_points.length > 0 && (
            <>
              <h3 className="text-sm font-semibold">Talking points</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">{r.talking_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>
          )}
          <p className="text-sm text-muted-foreground">Source: {r.source} · Detected {formatDate(r.detected_at)}</p>
          {r.source_url && /^https?:\/\//i.test(r.source_url) && <a className="text-sm text-primary underline" href={r.source_url} target="_blank" rel="noopener noreferrer" data-testid="link-source">Open source</a>}
        </section>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          {[
            ["Location", [r.city, r.state].filter(Boolean).join(", ")],
            ["Industry", r.industry],
            ["Employees", r.employee_estimate?.toString()],
            ["Website", r.website],
            ["Contact", r.contact_name],
            ["Email", r.contact_email],
            ["Phone", r.contact_phone],
            ["Assigned to", item.assignedToName],
            ["Dismiss reason", item.dismissReason],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="min-w-0"><dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt><dd className="truncate">{v}</dd></div>
          ))}
        </dl>

        {item.activities.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">History</h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {item.activities.map((a) => (
                <li key={a.id}><span className="capitalize text-foreground">{a.action}</span> by {a.actor} · {formatDistanceToNowStrict(new Date(a.at))} ago{a.reason ? ` · ${a.reason}` : ""}</li>
              ))}
            </ul>
          </div>
        )}

        {queued && (
          <div className="space-y-3 border-t border-primary/10 pt-4">
            {canManage && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1"><Label htmlFor="q-assignee">Assign to</Label>
                  <select id="q-assignee" data-testid="select-assignee" className="block w-full rounded border bg-background p-2 text-sm" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">Select member</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <Button variant="outline" data-testid="button-assign" disabled={!assignee || pending} onClick={() => onAct({ action: "assign", assigneeId: assignee })}>Assign</Button>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1"><Label htmlFor="q-reason">Dismiss reason</Label>
                <select id="q-reason" data-testid="select-dismiss-reason" className="block w-full rounded border bg-background p-2 text-sm capitalize" value={reason} onChange={(e) => setReason(e.target.value as DismissReason | "")}>
                  <option value="">Select reason</option>
                  {DISMISS_REASONS.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                </select>
              </div>
              <Button variant="outline" className="text-destructive" data-testid="button-dismiss" disabled={!reason || pending} onClick={() => reason && onAct({ action: "dismiss", reason })}>Dismiss</Button>
            </div>
          </div>
        )}

        <DialogFooter className="mt-2 gap-2">
          <Button variant="ghost" onClick={onClose} data-testid="button-close-detail">Close</Button>
          {queued && <Button data-testid="button-claim-detail" disabled={pending} onClick={() => onAct({ action: "claim" })}>{pending ? "Working..." : "Claim"}</Button>}
          {!queued && canManage && item.canReturn && (
            <Button className="gap-1.5" data-testid="button-return-detail" disabled={pending} onClick={() => onAct({ action: "return" })}><Undo2 className="h-4 w-4" /> Return to queue</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
