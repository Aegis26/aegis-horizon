import { useMemo, useState } from "react";
import {
  getGetWeightedRevenueForecastQueryKey,
  getListAccountsQueryKey,
  getListChurnPredictionsQueryKey,
  useGetWeightedRevenueForecast,
  useListAccounts,
  useListChurnPredictions,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowRight, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPredictionPercentage } from "@/lib/format";

const QUERY_FRESHNESS_MS = 60_000;
const QUERY_CACHE_MS = 5 * 60_000;
const FORECAST_COLOR = "#00B4D8";
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
});

export default function DashboardInsights({ orgId }: { orgId: string }) {
  const [groupBy, setGroupBy] = useState<"weekly" | "monthly">("monthly");
  const forecastParams = useMemo(() => ({ groupBy }), [groupBy]);

  const { data: forecast, isLoading: forecastLoading } = useGetWeightedRevenueForecast(
    orgId,
    forecastParams,
    {
      query: {
        enabled: !!orgId,
        staleTime: QUERY_FRESHNESS_MS,
        gcTime: QUERY_CACHE_MS,
        queryKey: getGetWeightedRevenueForecastQueryKey(orgId, forecastParams),
      },
    },
  );
  const { data: churnPredictions, isLoading: churnLoading } = useListChurnPredictions(orgId, {
    query: {
      enabled: !!orgId,
      staleTime: QUERY_FRESHNESS_MS,
      gcTime: QUERY_CACHE_MS,
      queryKey: getListChurnPredictionsQueryKey(orgId),
    },
  });
  const { data: accounts, isLoading: accountsLoading } = useListAccounts(orgId, undefined, {
    query: {
      enabled: !!orgId,
      staleTime: QUERY_FRESHNESS_MS,
      gcTime: QUERY_CACHE_MS,
      queryKey: getListAccountsQueryKey(orgId),
    },
  });

  const accountNames = useMemo(
    () => new Map((accounts ?? []).map((account) => [account.id, account.name])),
    [accounts],
  );
  const atRiskAccounts = useMemo(
    () =>
      (churnPredictions ?? [])
        .filter(
          (prediction) =>
            !prediction.resolvedAt &&
            (prediction.riskLevel === "high" || prediction.riskLevel === "critical"),
        )
        .slice(0, 5),
    [churnPredictions],
  );

  return (
    <>
      <Card className="col-span-full border-primary/20 shadow-[0_0_16px_rgba(0,180,216,0.05)] bg-gradient-to-b from-card to-background">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 font-display text-xl text-primary">
              <TrendingUp className="h-5 w-5" />
              90-Day Weighted Revenue Forecast
            </CardTitle>
            <CardDescription>
              Predicted recognized revenue based on historical conversion rates and current pipeline velocity.
            </CardDescription>
          </div>
          <div className="w-32">
            <Select value={groupBy} onValueChange={(value: "weekly" | "monthly") => setGroupBy(value)}>
              <SelectTrigger className="bg-background/50 border-primary/20 focus:ring-primary h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {forecastLoading ? (
            <div className="mt-4 h-[350px] w-full skeleton rounded-xl" />
          ) : forecast?.periods?.length ? (
            <div className="h-[350px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={forecast.periods} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={FORECAST_COLOR} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={FORECAST_COLOR} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="periodStart"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => {
                      try {
                        return format(parseISO(value), groupBy === "weekly" ? "MMM d" : "MMM yyyy");
                      } catch {
                        return value;
                      }
                    }}
                    dy={10}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${value / 1000}k`}
                    dx={-10}
                  />
                  <RechartsTooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      let periodLabel = label;
                      try {
                        periodLabel = format(
                          parseISO(String(label)),
                          groupBy === "weekly" ? "MMM d, yyyy" : "MMMM yyyy",
                        );
                      } catch {
                        // Keep the server label when it cannot be parsed.
                      }
                      return (
                        <div className="bg-popover border border-border rounded-lg shadow-xl p-3">
                          <p className="text-sm text-muted-foreground mb-1">{periodLabel}</p>
                          <p className="text-lg font-bold text-primary font-mono">
                            {currencyFormatter.format(Number(payload[0].value ?? 0))}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {payload[0].payload.opportunityCount} active opportunities
                          </p>
                        </div>
                      );
                    }}
                    cursor={{ fill: "rgba(0,180,216,0.05)", stroke: "none" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="weightedRevenue"
                    stroke={FORECAST_COLOR}
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorRevenue)"
                    activeDot={{ r: 6, fill: FORECAST_COLOR, stroke: "#1A1F3A", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[350px] w-full flex items-center justify-center text-muted-foreground border border-dashed border-border/50 rounded-xl mt-4">
              No forecast data available
            </div>
          )}
        </CardContent>
      </Card>

      {(churnLoading || accountsLoading) && <div className="h-48 skeleton rounded-xl" />}

      {!churnLoading && !accountsLoading && atRiskAccounts.length > 0 && (
        <div className="animate-slideUpReveal">
          <Card className="border-destructive/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
            <CardHeader className="border-b border-destructive/10 bg-destructive/5">
              <CardTitle className="flex items-center justify-between font-display text-xl text-destructive">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Accounts at Risk
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {atRiskAccounts.map((prediction) => (
                  <div
                    key={prediction.id}
                    className="p-6 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center hover:bg-card/50 transition-colors"
                  >
                    <div className="space-y-2 max-w-xl">
                      <div className="flex items-center gap-3">
                        <Link href={`/accounts/${prediction.accountId}`}>
                          <h3 className="text-lg font-bold font-display hover:text-primary transition-colors cursor-pointer">
                            {accountNames.get(prediction.accountId) ?? "Unknown Account"}
                          </h3>
                        </Link>
                        <Badge
                          className={
                            prediction.riskLevel === "critical"
                              ? "bg-destructive text-destructive-foreground"
                              : "bg-warning/20 text-warning"
                          }
                        >
                          {prediction.riskLevel} Risk
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">Action needed:</span>{" "}
                        {prediction.recommendedAction}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {prediction.riskFactors.map((factor, index) => (
                          <span key={index} className="text-xs border border-border bg-background px-2 py-1 rounded">
                            {factor.factor}: {factor.detail}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-4 text-sm font-mono text-muted-foreground">
                      <div className="text-right">
                        <p className="uppercase text-[10px] tracking-wider mb-1">Score</p>
                        <p className="text-lg font-bold text-foreground">
                          {formatPredictionPercentage(prediction.riskScore)}
                        </p>
                      </div>
                      <Link href={`/accounts/${prediction.accountId}`}>
                        <Button size="sm" variant="outline" className="gap-2 border-primary/20 hover:border-primary/50">
                          Review <ArrowRight className="h-3 w-3" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}