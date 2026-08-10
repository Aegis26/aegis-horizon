import { useListOpportunities, getListOpportunitiesQueryKey } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Lock, Plus, Target } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";

export default function Opportunities() {
  const { selectedOrgId } = useOrgStore();
  
  const { data: opps, error, isLoading } = useListOpportunities(selectedOrgId || "", {
    query: {
      enabled: !!selectedOrgId,
      retry: false,
      queryKey: getListOpportunitiesQueryKey(selectedOrgId || "")
    }
  });

  if (error && error.status === 403) {
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

  if (isLoading) {
    return <div className="animate-pulse h-64 bg-muted rounded-xl"></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display">Opportunities</h1>
          <p className="text-muted-foreground mt-2">Track and manage your deal pipeline.</p>
        </div>
        <Button className="gap-2 font-display"><Plus className="h-4 w-4"/> Create opportunity</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deal Name</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Probability</TableHead>
                <TableHead className="text-right">Expected Close</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opps?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <Target className="h-8 w-8 mb-4 opacity-20" />
                      <p>No opportunities yet. Create your first.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                opps?.map((opp) => (
                  <TableRow key={opp.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium">{opp.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {opp.stage.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {opp.value ? formatCurrency(Number(opp.value)) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {opp.probability ? `${opp.probability}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
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
  );
}
