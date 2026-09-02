import { useGetOrgDashboard, getGetOrgDashboardQueryKey, useListChurnPredictions, getListChurnPredictionsQueryKey, useListAccounts, getListAccountsQueryKey } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, Target, Activity, AlertTriangle, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { formatPredictionPercentage } from "@/lib/format";

export default function Dashboard() {
  const { selectedOrgId } = useOrgStore();

  const { data: dashboard, isLoading } = useGetOrgDashboard(selectedOrgId || "", {
    query: {
      enabled: !!selectedOrgId,
      queryKey: getGetOrgDashboardQueryKey(selectedOrgId || "")
    }
  });

  const { data: churnPredictions } = useListChurnPredictions(selectedOrgId || "", {
    query: {
      enabled: !!selectedOrgId,
      queryKey: getListChurnPredictionsQueryKey(selectedOrgId || "")
    }
  });

  const { data: accounts } = useListAccounts(selectedOrgId || "", undefined, {
    query: {
      enabled: !!selectedOrgId,
      queryKey: getListAccountsQueryKey(selectedOrgId || "")
    }
  });

  const getAccountName = (id: string) => accounts?.find(a => a.id === id)?.name || "Unknown Account";

  // Filter for active risks (unresolved and high/critical)
  const atRiskAccounts = churnPredictions?.filter(p =>
    !p.resolvedAt && (p.riskLevel === 'high' || p.riskLevel === 'critical')
  ).slice(0, 5) || [];

  if (isLoading || !dashboard) {
    return <div className="p-8 space-y-6">
      <div className="skeleton h-8 w-48 rounded"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1,2,3,4].map(i => <div key={i} className="skeleton h-32 rounded-xl"></div>)}
      </div>
    </div>;
  }

  return (
    <div>
      <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1">Overview</h1>
          <p className="text-sm text-muted-foreground">Your command center.</p>
        </div>
      </header>

      <div className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-2px_rgba(0,180,216,0.08)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Plan</p>
              <div className="w-10 h-10 bg-primary/10 rounded-md flex items-center justify-center">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-[28px] font-bold capitalize font-display leading-[1.2] mb-2 text-foreground">{dashboard.plan}</div>
              <p className="text-xs font-semibold text-success">
                {dashboard.enabledFeatureCount} features enabled
              </p>
            </CardContent>
          </Card>

          <Card className="transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-2px_rgba(0,180,216,0.08)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Team Members</p>
              <div className="w-10 h-10 bg-primary/10 rounded-md flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-[28px] font-bold font-mono leading-[1.2] mb-2 text-foreground">{dashboard.memberCount}</div>
            </CardContent>
          </Card>

          <Card className="transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-2px_rgba(0,180,216,0.08)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Accounts</p>
              <div className="w-10 h-10 bg-primary/10 rounded-md flex items-center justify-center">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-[28px] font-bold font-mono leading-[1.2] mb-2 text-foreground">{dashboard.accountCount}</div>
            </CardContent>
          </Card>

          <Card className="transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-2px_rgba(0,180,216,0.08)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Open Opportunities</p>
              <div className="w-10 h-10 bg-primary/10 rounded-md flex items-center justify-center">
                <Target className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-[28px] font-bold font-mono leading-[1.2] mb-2 text-foreground">{dashboard.opportunityCount}</div>
            </CardContent>
          </Card>
        </div>

          <Card className="col-span-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-xl">
                <Activity className="h-5 w-5" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.recentActivity && dashboard.recentActivity.length > 0 ? (
                <div className="space-y-6">
                  {dashboard.recentActivity.map((log) => (
                    <div key={log.id} className="flex items-start gap-4 text-sm">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-primary" />
                      <div className="flex-1 space-y-1">
                        <p className="font-medium text-foreground">{log.action}</p>
                        <p className="text-muted-foreground">
                          {log.userEmail ? `${log.userEmail} · ` : ""}
                          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground text-sm border border-primary/10 rounded-lg">
                  No recent activity recorded.
                </div>
              )}
            </CardContent>
          </Card>

        {atRiskAccounts.length > 0 && (
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
                  {atRiskAccounts.map(pred => (
                    <div key={pred.id} className="p-6 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center hover:bg-card/50 transition-colors">
                      <div className="space-y-2 max-w-xl">
                        <div className="flex items-center gap-3">
                          <Link href={`/accounts/${pred.accountId}`}>
                            <h3 className="text-lg font-bold font-display hover:text-primary transition-colors cursor-pointer">{getAccountName(pred.accountId)}</h3>
                          </Link>
                          <span className={`text-xs px-2 py-0.5 rounded font-mono uppercase font-bold ${
                            pred.riskLevel === 'critical' ? 'bg-destructive text-destructive-foreground' : 'bg-warning/20 text-warning'
                          }`}>
                            {pred.riskLevel} Risk
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-semibold text-foreground">Action needed:</span> {pred.recommendedAction}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {pred.riskFactors.map((f, i) => (
                            <span key={i} className="text-xs border border-border bg-background px-2 py-1 rounded">
                              {f.factor}: {f.detail}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-4 text-sm font-mono text-muted-foreground">
                        <div className="text-right">
                          <p className="uppercase text-[10px] tracking-wider mb-1">Score</p>
                          <p className="text-lg font-bold text-foreground">{formatPredictionPercentage(pred.riskScore)}</p>
                        </div>
                        <Link href={`/accounts/${pred.accountId}`}>
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
      </div>
    </div>
  );
}
