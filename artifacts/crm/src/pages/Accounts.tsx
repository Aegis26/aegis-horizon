import { useListAccounts, getListAccountsQueryKey } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Lock, Plus, Users } from "lucide-react";
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
    return <div className="p-8"><div className="skeleton h-64 rounded-xl"></div></div>;
  }

  return (
    <div>
      <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1">Accounts</h1>
          <p className="text-sm text-muted-foreground">Manage your customer organizations.</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4"/> Create account</Button>
      </header>

      <div className="p-8">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-right">Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <div className="flex flex-col items-center justify-center min-h-[384px] px-6 py-20 bg-background/30 text-center">
                        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                          <Users className="h-10 w-10 text-primary opacity-50" />
                        </div>
                        <h3 className="font-display text-2xl font-bold mb-2">No accounts yet</h3>
                        <p className="text-muted-foreground max-w-sm">
                          Account creation arrives in the next release. Your accounts will appear here.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  accounts?.map((acc) => (
                    <TableRow key={acc.id} className="cursor-pointer">
                      <TableCell className="font-medium text-foreground">{acc.name}</TableCell>
                      <TableCell className="text-muted-foreground/80">{acc.industry || "—"}</TableCell>
                      <TableCell className="text-muted-foreground/80">
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
                      <TableCell className="text-right font-mono text-muted-foreground/80">
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
    </div>
  );
}
