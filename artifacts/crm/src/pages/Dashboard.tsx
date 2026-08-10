import { useGetOrgDashboard, getGetOrgDashboardQueryKey } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, Target, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const { selectedOrgId } = useOrgStore();
  
  const { data: dashboard, isLoading } = useGetOrgDashboard(selectedOrgId || "", {
    query: {
      enabled: !!selectedOrgId,
      queryKey: getGetOrgDashboardQueryKey(selectedOrgId || "")
    }
  });

  if (isLoading || !dashboard) {
    return <div className="animate-pulse space-y-6">
      <div className="h-8 w-48 bg-muted rounded"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1,2,3,4].map(i => <div key={i} className="h-32 bg-muted rounded-xl"></div>)}
      </div>
    </div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight font-display">Overview</h1>
        <p className="text-muted-foreground mt-2">Your command center.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-display">Active Plan</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize font-display">{dashboard.plan}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {dashboard.enabledFeatureCount} features enabled
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-display">Team Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{dashboard.memberCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-display">Total Accounts</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{dashboard.accountCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-display">Open Opportunities</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{dashboard.opportunityCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="col-span-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
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
            <div className="py-8 text-center text-muted-foreground text-sm border border-dashed rounded-lg">
              No recent activity recorded.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
