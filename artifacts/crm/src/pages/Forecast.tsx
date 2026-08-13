import { useGetForecast, getGetForecastQueryKey } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp } from "lucide-react";
import { formatDollars } from "@/lib/format";

function monthLabel(month: string) {
  if (month === "total") return "Total";
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

const SUMMARY = [
  { key: "committed", label: "Committed", hint: "Deals in committed stages" },
  { key: "bestCase", label: "Best case", hint: "Committed + best-case deals" },
  { key: "pipeline", label: "Pipeline", hint: "All open weighted-stage deals" },
  { key: "closedWon", label: "Closed won", hint: "Booked this period" },
] as const;

export default function Forecast() {
  const { selectedOrgId } = useOrgStore();
  const orgId = selectedOrgId || "";

  const { data: forecast, isLoading } = useGetForecast(orgId, { months: 6 }, {
    query: { enabled: !!orgId, retry: false, queryKey: getGetForecastQueryKey(orgId, { months: 6 }) },
  });

  if (isLoading) return <div className="p-8"><div className="skeleton h-64 rounded-xl"></div></div>;

  const months = forecast?.months ?? [];
  const totals = forecast?.totals;
  const maxPipeline = Math.max(1, ...months.map((m) => m.pipeline + m.closedWon));

  return (
    <div>
      <header className="px-8 py-6 border-b border-primary/10 bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <h1 className="text-3xl font-bold tracking-tight font-display mb-1">Forecast</h1>
        <p className="text-sm text-muted-foreground">Committed, best case, and pipeline by expected close month.</p>
      </header>

      <div className="p-8 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {SUMMARY.map((s) => (
            <Card key={s.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold font-mono">{formatDollars(totals?.[s.key] ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5 text-primary" /> Next 6 months
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {months.map((m) => (
              <div key={m.month} className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{monthLabel(m.month)}</span>
                  <span className="font-mono text-muted-foreground">{formatDollars(m.pipeline + m.closedWon)}</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden flex">
                  <div className="bg-emerald-500/80 h-full" style={{ width: `${(m.closedWon / maxPipeline) * 100}%` }} />
                  <div className="bg-primary h-full" style={{ width: `${(m.committed / maxPipeline) * 100}%` }} />
                  <div className="bg-primary/50 h-full" style={{ width: `${(Math.max(m.bestCase - m.committed, 0) / maxPipeline) * 100}%` }} />
                  <div className="bg-primary/20 h-full" style={{ width: `${(Math.max(m.pipeline - m.bestCase, 0) / maxPipeline) * 100}%` }} />
                </div>
              </div>
            ))}
            <div className="flex gap-4 pt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500/80" /> Closed won</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Committed</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary/50" /> Best case</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary/20" /> Pipeline</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead className="text-right">Best case</TableHead>
                  <TableHead className="text-right">Pipeline</TableHead>
                  <TableHead className="text-right">Closed won</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="font-medium">{monthLabel(m.month)}</TableCell>
                    <TableCell className="text-right font-mono">{formatDollars(m.committed)}</TableCell>
                    <TableCell className="text-right font-mono">{formatDollars(m.bestCase)}</TableCell>
                    <TableCell className="text-right font-mono">{formatDollars(m.pipeline)}</TableCell>
                    <TableCell className="text-right font-mono">{formatDollars(m.closedWon)}</TableCell>
                  </TableRow>
                ))}
                {totals && (
                  <TableRow className="border-t-2">
                    <TableCell className="font-bold">Total</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatDollars(totals.committed)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatDollars(totals.bestCase)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatDollars(totals.pipeline)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatDollars(totals.closedWon)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
