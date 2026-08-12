import { useState } from "react";
import { useListAccounts, getListAccountsQueryKey, useListSegments, getListSegmentsQueryKey, useCreateAccount, useDeleteAccount } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Lock, Plus, Users, Search, Filter, Trash2, ArrowRight } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BulkImportDialog } from "@/components/accounts/BulkImportDialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

const accountSchema = z.object({
  name: z.string().min(1, "Name is required"),
  industry: z.string().optional(),
  website: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

type AccountFormValues = z.infer<typeof accountSchema>;

export default function Accounts() {
  const { selectedOrgId } = useOrgStore();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [segmentId, setSegmentId] = useState<string>("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: accounts, error, isLoading } = useListAccounts(selectedOrgId || "", {
    q: search || undefined,
    segmentId: segmentId || undefined,
  }, {
    query: {
      enabled: !!selectedOrgId,
      retry: false,
      queryKey: getListAccountsQueryKey(selectedOrgId || "", { q: search || undefined, segmentId: segmentId || undefined })
    }
  });

  const { data: segments } = useListSegments(selectedOrgId || "", {
    query: {
      enabled: !!selectedOrgId,
      queryKey: getListSegmentsQueryKey(selectedOrgId || "")
    }
  });

  const createAccount = useCreateAccount();
  const deleteAccount = useDeleteAccount();

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: "",
      industry: "",
      website: "",
      city: "",
      state: "",
    }
  });

  const onSubmit = (data: AccountFormValues) => {
    if (!selectedOrgId) return;
    createAccount.mutate({ orgId: selectedOrgId, data }, {
      onSuccess: () => {
        toast({ title: "Account created successfully" });
        setIsCreateOpen(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(selectedOrgId) });
      },
      onError: (err) => {
        toast({ title: "Failed to create account", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedOrgId) return;
    if (confirm("Are you sure you want to delete this account?")) {
      deleteAccount.mutate({ orgId: selectedOrgId, accountId: id }, {
        onSuccess: () => {
          toast({ title: "Account deleted" });
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(selectedOrgId) });
        }
      });
    }
  };

  if (error && error.status === 403) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
        <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-6 shadow-glow">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight mb-2 font-display">CRM Module Locked</h2>
        <p className="text-muted-foreground mb-8">
          The Accounts and CRM feature set is not enabled for your organization. 
          Upgrade your plan or customize your features to access this module.
        </p>
        <Button size="lg" className="font-display" onClick={() => setLocation("/billing")}>Manage Features</Button>
      </div>
    );
  }

  return (
    <div className="animate-scaleInEntrance">
      <header className="px-8 py-6 border-b border-primary/10 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1 text-primary">Accounts</h1>
          <p className="text-sm text-muted-foreground">Manage your customer organizations.</p>
        </div>
        <div className="flex items-center gap-3">
          <BulkImportDialog />
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 font-display"><Plus className="h-4 w-4"/> Create Account</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-card border-primary/20 shadow-glow">
              <DialogHeader>
                <DialogTitle className="font-display">Create Account</DialogTitle>
                <DialogDescription>Add a new organization to your CRM.</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Name</FormLabel>
                      <FormControl><Input placeholder="Acme Corp" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="industry" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Industry</FormLabel>
                      <FormControl><Input placeholder="Technology" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="website" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website</FormLabel>
                      <FormControl><Input placeholder="https://..." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="city" render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl><Input placeholder="San Francisco" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="state" render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl><Input placeholder="CA" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <DialogFooter className="pt-4">
                    <Button type="submit" disabled={createAccount.isPending} className="font-display">
                      {createAccount.isPending ? "Creating..." : "Create Account"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <div className="p-8">
        <div className="flex flex-col sm:flex-row items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search accounts..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card border-primary/20 focus-visible:ring-primary/50"
            />
          </div>
          <div className="w-full sm:w-64">
            <Select value={segmentId} onValueChange={setSegmentId}>
              <SelectTrigger className="bg-card border-primary/20">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="All Segments" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Segments</SelectItem>
                {segments?.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="border-primary/10 shadow-md bg-card/80 backdrop-blur">
          <CardContent className="p-0 overflow-hidden">
            <Table>
              <TableHeader className="bg-background/50">
                <TableRow className="border-primary/10 hover:bg-transparent">
                  <TableHead className="font-display">Name</TableHead>
                  <TableHead className="font-display">Industry</TableHead>
                  <TableHead className="font-display">Location</TableHead>
                  <TableHead className="font-display">Health</TableHead>
                  <TableHead className="font-display">Added</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-8 text-center">
                      <div className="spinner mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : accounts?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <div className="flex flex-col items-center justify-center min-h-[384px] px-6 py-20 bg-background/30 text-center">
                        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6 shadow-glow animate-float">
                          <Users className="h-10 w-10 text-primary opacity-80" />
                        </div>
                        <h3 className="font-display text-2xl font-bold mb-2">No accounts found</h3>
                        <p className="text-muted-foreground max-w-sm">
                          {search || segmentId ? "No accounts match your filters." : "Start by adding your first customer organization."}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  accounts?.map((acc) => (
                    <TableRow 
                      key={acc.id} 
                      className="cursor-pointer border-primary/5 hover:bg-primary/5 transition-colors group"
                      onClick={() => setLocation(`/accounts/${acc.id}`)}
                    >
                      <TableCell className="font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-primary font-display font-bold text-xs border border-primary/20">
                            {acc.name.substring(0, 2).toUpperCase()}
                          </div>
                          {acc.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{acc.industry || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {[acc.city, acc.state].filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell>
                        {acc.healthScore ? (
                          <Badge variant={
                            acc.healthScore === "good" ? "default" :
                            acc.healthScore === "at_risk" ? "destructive" : "secondary"
                          } className="font-mono text-xs">
                            {acc.healthScore.toUpperCase()}
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatDate(acc.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={(e) => handleDelete(acc.id, e)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:bg-primary/10">
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </div>
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
