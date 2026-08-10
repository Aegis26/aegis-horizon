import { useListAccounts, getListAccountsQueryKey } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Lock, Plus } from "lucide-react";
import { formatDate } from "@/lib/format";

export default function Accounts() {
  const { selectedOrgId } = useOrgStore();
  
  const { data: accounts, error, isLoading } = useListAccounts(selectedOrgId || "", {
    query: {
      enabled: !!selectedOrgId,
      retry: false,
      queryKey: getListAccountsQueryKey(selectedOrgId || "")
    }
  });

  if (error && error.status === 403) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
        <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-6">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight mb-2 font-display">CRM Module Locked</h2>
        <p className="text-muted-foreground mb-8">
          The Accounts and CRM feature set is not enabled for your organization. 
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
          <h1 className="text-3xl font-bold tracking-tight font-display">Accounts</h1>
          <p className="text-muted-foreground mt-2">Manage your customer organizations.</p>
        </div>
        <Button className="gap-2 font-display"><Plus className="h-4 w-4"/> Create account</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <p>No accounts found. Create your first.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                accounts?.map((acc) => (
                  <TableRow key={acc.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium">{acc.name}</TableCell>
                    <TableCell>{acc.industry || "—"}</TableCell>
                    <TableCell>
                      {[acc.city, acc.state].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      {acc.healthScore ? (
                        <Badge variant={
                          acc.healthScore === "good" ? "default" :
                          acc.healthScore === "at_risk" ? "destructive" : "secondary"
                        }>
                          {acc.healthScore}
                        </Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(acc.createdAt)}
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
