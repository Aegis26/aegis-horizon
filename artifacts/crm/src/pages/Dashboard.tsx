import { lazy, Suspense } from "react";
import { useGetOrgDashboard, getGetOrgDashboardQueryKey } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, Target, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const DashboardInsights = lazy(() => import("@/components/dashboard/DashboardInsights"));

export default function Dashboard() {
  const { selectedOrgId } = useOrgStore();

  const { data: dashboard, isLoading: dashboardLoading } = useGetOrgDashboard(selectedOrgId || "", {
    query: {
      enabled: !!selectedOrgId,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      queryKey: getGetOrgDashboardQueryKey(selectedOrgId || "")
    }
  });

  if (dashboardLoading || !dashboard) {
    return <div className="p-8 space-y-6">
      <div className="skeleton h-8 w-48 rounded"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1,2,3,4].map(i => <div key={i} className="skeleton h-32 rounded-xl"></div>)}
      </div>
      <div className="skeleton h-[400px] rounded-xl"></div>
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

        <Suspense fallback={<div className="h-[460px] skeleton rounded-xl" />}>
          <DashboardInsights orgId={selectedOrgId!} />
        </Suspense>

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
      </div>
    </div>
  );
}