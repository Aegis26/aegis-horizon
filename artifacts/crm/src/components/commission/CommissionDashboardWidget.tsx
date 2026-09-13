import { useState } from "react";
import {
  CalendarDays,
  Coins,
  RefreshCw,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { useGetEarnedCommissions } from "@workspace/api-client-react";
import { useWindowAuth } from "@/components/auth/WindowAuthProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  earnedCommissionsQueryKey,
  type CommissionPeriod,
} from "@/lib/commissions";

const PERIODS: Array<{ value: CommissionPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7days", label: "Past 7 Days" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const utcDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function formatMoney(value: string | number | null | undefined): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? moneyFormatter.format(amount) : "$0.00";
}

function formatUtcDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : utcDateFormatter.format(date);
}

export default function CommissionDashboardWidget({ orgId }: { orgId: string }) {
  const { isLoaded: authLoaded, isSignedIn, user } = useWindowAuth();
  const [period, setPeriod] = useState<CommissionPeriod>("today");
  const identityId = user?.id ?? user?.clerkId ?? "anonymous";
  const queryEnabled = Boolean(orgId && authLoaded && isSignedIn && user?.id);

  const queryKey = earnedCommissionsQueryKey(orgId, identityId, period);
  const {
    data,
    error,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useGetEarnedCommissions(
    orgId,
    { period },
    {
      query: {
        enabled: queryEnabled,
        queryKey,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: false,
      },
    },
  );

  return (
    <Card data-testid="card-commission-dashboard">
      <CardHeader className="gap-4 border-b border-border/50">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 font-display text-xl">
              <Coins className="h-5 w-5 text-primary" aria-hidden="true" />
              Commission earnings
            </CardTitle>
            <p
              className="mt-1 text-sm text-muted-foreground"
              data-testid="text-commission-period-note"
            >
              Closed Won deals · amounts in USD · dates shown in UTC
            </p>
          </div>
          <div
            className="flex flex-wrap gap-2"
            aria-label="Commission period"
            data-testid="group-commission-period"
          >
            {PERIODS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={period === option.value ? "default" : "outline"}
                onClick={() => setPeriod(option.value)}
                data-testid={`button-commission-period-${option.value}`}
                aria-pressed={period === option.value}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {isLoading ? (
          <div
            className="grid grid-cols-1 gap-4 md:grid-cols-3"
            data-testid="loading-commission-dashboard"
          >
            {[1, 2, 3].map((item) => (
              <div key={item} className="skeleton h-24 rounded-lg" />
            ))}
            <div className="skeleton h-48 rounded-lg md:col-span-3" />
          </div>
        ) : isError ? (
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center"
            role="alert"
            data-testid="error-commission-dashboard"
          >
            <p className="font-medium">Commission earnings could not be loaded.</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "Please try again in a moment."}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
              data-testid="button-retry-commission-dashboard"
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {isFetching ? "Retrying..." : "Retry"}
            </Button>
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Metric
                label="Total commission"
                value={formatMoney(data.totalCommission)}
                icon={Coins}
                testId="metric-total-commission"
              />
              <Metric
                label="Deals closed"
                value={String(data.dealCount ?? 0)}
                icon={Target}
                testId="metric-commission-deal-count"
              />
              <Metric
                label="Average per deal"
                value={formatMoney(data.averageCommission)}
                icon={TrendingUp}
                testId="metric-average-commission"
              />
            </div>

            {data.records.length === 0 ? (
              <div
                className="rounded-lg border border-dashed border-border/70 px-6 py-10 text-center"
                data-testid="empty-commission-records"
              >
                <CalendarDays
                  className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="font-medium">No commissions earned in this period.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Closed Won opportunities will appear here once a commission
                  is recorded.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <Table data-testid="table-commission-records">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Opportunity</TableHead>
                      <TableHead className="text-right">Deal value</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead className="whitespace-nowrap">Earned (UTC)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.records.map((record) => (
                      <TableRow
                        key={record.id}
                        data-testid={`row-commission-record-${record.id}`}
                      >
                        <TableCell
                          className="min-w-[140px] font-medium"
                          data-testid={`text-commission-employee-${record.id}`}
                        >
                          <span className="flex items-center gap-2">
                            <Users
                              className="h-4 w-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                            {record.employeeName || "Unknown employee"}
                          </span>
                        </TableCell>
                        <TableCell
                          className="min-w-[180px]"
                          data-testid={`text-commission-opportunity-${record.id}`}
                        >
                          {record.opportunityName || "Unnamed opportunity"}
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap text-right font-mono"
                          data-testid={`text-commission-deal-value-${record.id}`}
                        >
                          {formatMoney(record.opportunityValue)}
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap text-right font-mono"
                          data-testid={`text-commission-rate-${record.id}`}
                        >
                          {record.commissionPercentage}%
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap text-right font-mono font-semibold text-success"
                          data-testid={`text-commission-earned-${record.id}`}
                        >
                          {formatMoney(record.commissionAmount)}
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap text-sm text-muted-foreground"
                          data-testid={`text-commission-date-${record.id}`}
                        >
                          {formatUtcDate(record.earnedDate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        ) : (
          <div
            className="rounded-lg border border-dashed border-border/70 px-6 py-10 text-center text-sm text-muted-foreground"
            data-testid="empty-commission-dashboard"
          >
            Commission data is not available yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  testId,
}: {
  label: string;
  value: string;
  icon: typeof Coins;
  testId: string;
}) {
  return (
    <div
      className="rounded-lg border border-border/60 bg-background/40 p-4"
      data-testid={testId}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      </div>
      <p
        className="font-mono text-2xl font-semibold text-foreground"
        data-testid={`${testId}-value`}
      >
        {value}
      </p>
    </div>
  );
}