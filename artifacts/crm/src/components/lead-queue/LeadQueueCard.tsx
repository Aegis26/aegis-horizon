import { Link } from "wouter";
import { formatDistanceToNowStrict } from "date-fns";
import { useListLeadQueue, getListLeadQueueQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Inbox, ArrowRight, RefreshCw } from "lucide-react";
import { LEAD_QUEUE_POLL_MS, LEAD_TYPE_LABELS } from "@/lib/lead-queue";
import { useLeadQueueActions } from "@/hooks/use-lead-queue-actions";

export default function LeadQueueCard({ orgId }: { orgId: string }) {
  const params = { status: "queued" as const };
  const { data, isLoading, isError, refetch } = useListLeadQueue(orgId, params, {
    query: { enabled: !!orgId, queryKey: getListLeadQueueQueryKey(orgId, params), refetchInterval: LEAD_QUEUE_POLL_MS },
  });
  const { act, pendingLeadId } = useLeadQueueActions(orgId);
  const top = [...(data?.items ?? [])]
    .sort((a, b) => b.score - a.score || +new Date(b.queuedAt) - +new Date(a.queuedAt))
    .slice(0, 10);

  return (
    <Card data-testid="card-lead-queue">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <Inbox className="h-5 w-5" />
          Lead Queue
          {data && (
            <span data-testid="text-queue-total" className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-xs text-primary">
              {data.totalQueued}
            </span>
          )}
        </CardTitle>
        <Link href="/lead-queue" data-testid="link-view-all-queue" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          View all <ArrowRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded" />)}</div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
            Could not load the queue.
            <Button size="sm" variant="outline" className="gap-2" onClick={() => void refetch()}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>
          </div>
        ) : top.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No prospects waiting. New inbound leads appear here.</div>
        ) : (
          <ul className="divide-y divide-primary/10">
            {top.map((item) => (
              <li key={item.id} data-testid={`row-queue-${item.id}`} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                <span className="w-10 shrink-0 text-center font-mono text-lg font-bold text-primary">{item.score}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">{item.company}</span>
                    {item.radar.city && <span className="text-xs text-muted-foreground">{item.radar.city}</span>}
                    <Badge variant="outline" className="text-[10px]">{LEAD_TYPE_LABELS[item.radar.lead_type] ?? item.radar.lead_type}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{item.radar.signal_summary}</p>
                  {item.existingAccountName && <p className="truncate text-xs text-amber-400">Existing account: {item.existingAccountName}</p>}
                  <span className="font-mono text-xs text-muted-foreground sm:hidden">{formatDistanceToNowStrict(new Date(item.queuedAt))} in queue</span>
                </div>
                <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
                  {formatDistanceToNowStrict(new Date(item.queuedAt))}
                </span>
                <Button
                  size="sm" variant="outline" data-testid={`button-claim-${item.id}`}
                  disabled={!!pendingLeadId}
                  onClick={() => act(item.id, { action: "claim" }, item.company)}
                >
                  {pendingLeadId === item.id ? "Claiming..." : "Claim"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
