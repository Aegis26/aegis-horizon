import { useState } from "react";
import {
  useListTerritories, getListTerritoriesQueryKey,
  useCreateTerritory, useUpdateTerritory, useDeleteTerritory,
  useGetTerritoryCoverage, getGetTerritoryCoverageQueryKey,
  useGetMe, getGetMeQueryKey,
} from "@workspace/api-client-react";
import type { Territory } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, Map, Pencil, Trash2 } from "lucide-react";
import { formatDollars } from "@/lib/format";

export default function Territories() {
  const { selectedOrgId } = useOrgStore();
  const orgId = selectedOrgId || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Territory | null>(null);

  const { data: territories, isLoading } = useListTerritories(orgId, {
    query: { enabled: !!orgId, retry: false, queryKey: getListTerritoriesQueryKey(orgId) },
  });
  const { data: coverage } = useGetTerritoryCoverage(orgId, {
    query: { enabled: !!orgId, retry: false, queryKey: getGetTerritoryCoverageQueryKey(orgId) },
  });
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });

  const createTerritory = useCreateTerritory();
  const updateTerritory = useUpdateTerritory();
  const deleteTerritory = useDeleteTerritory();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListTerritoriesQueryKey(orgId) });
    queryClient.invalidateQueries({ queryKey: getGetTerritoryCoverageQueryKey(orgId) });
  };
  const onError = (title: string) => (e: unknown) =>
    toast({ title, description: (e as Error).message, variant: "destructive" });

  if (isLoading) return <div className="p-8"><div className="skeleton h-64 rounded-xl"></div></div>;

  const coverageFor = (id: string) => coverage?.find((c) => c.territoryId === id);

  return (
    <div>
      <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1">Territories</h1>
          <p className="text-sm text-muted-foreground">Geographic and product assignment rules with quota coverage.</p>
        </div>
        <Button className="gap-2" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4" /> New territory
        </Button>
      </header>

      <div className="p-8">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Territory</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Countries</TableHead>
                  <TableHead>States</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead className="text-right">Accounts</TableHead>
                  <TableHead className="text-right">Open pipeline</TableHead>
                  <TableHead className="text-right">Closed won</TableHead>
                  <TableHead className="text-right">Quota</TableHead>
                  <TableHead className="text-right">Attainment</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!territories || territories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="p-0">
                      <div className="flex flex-col items-center justify-center min-h-[320px] px-6 py-16 bg-background/30 text-center">
                        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                          <Map className="h-10 w-10 text-primary opacity-50" />
                        </div>
                        <h3 className="font-display text-2xl font-bold mb-2">No territories yet</h3>
                        <p className="text-muted-foreground max-w-sm">
                          Define territories by geography or product to route leads automatically.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  territories.map((t) => {
                    const cov = coverageFor(t.id);
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                        <TableCell className="text-muted-foreground">{t.ownerName ?? "Unassigned"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {t.countries.length ? t.countries.map((c) => <Badge key={c} variant="outline" className="font-mono text-xs uppercase">{c}</Badge>) : <span className="text-muted-foreground">—</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {t.states.length ? t.states.map((s) => <Badge key={s} variant="outline" className="font-mono text-xs uppercase">{s}</Badge>) : <span className="text-muted-foreground">—</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {t.products.length ? t.products.map((p) => <Badge key={p} variant="outline" className="text-xs">{p}</Badge>) : <span className="text-muted-foreground">—</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{cov?.accountCount ?? 0}</TableCell>
                        <TableCell className="text-right font-mono">{formatDollars(cov?.openPipelineValue ?? 0)}</TableCell>
                        <TableCell className="text-right font-mono">{formatDollars(cov?.closedWonValue ?? 0)}</TableCell>
                        <TableCell className="text-right font-mono">{t.quota ? formatDollars(Number(t.quota)) : "—"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {cov?.achievementPercent != null ? `${cov.achievementPercent}%` : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setFormOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => deleteTerritory.mutate({ orgId, territoryId: t.id }, { onSuccess: invalidate, onError: onError("Could not delete territory") })}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {formOpen && (
        <TerritoryFormDialog
          territory={editing}
          userId={me?.user.id}
          pending={createTerritory.isPending || updateTerritory.isPending}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSave={(data) => {
            const opts = { onSuccess: () => { setFormOpen(false); setEditing(null); invalidate(); }, onError: onError("Could not save territory") };
            if (editing) updateTerritory.mutate({ orgId, territoryId: editing.id, data }, opts);
            else createTerritory.mutate({ orgId, data }, opts);
          }}
        />
      )}
    </div>
  );
}

function parseList(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function TerritoryFormDialog({ territory, userId, onClose, onSave, pending }: {
  territory: Territory | null;
  userId: string | undefined;
  onClose: () => void;
  onSave: (data: { name: string; ownerUserId?: string | null; countries?: string[]; states?: string[]; products?: string[]; quota?: string | null }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState(territory?.name ?? "");
  const [countries, setCountries] = useState(territory?.countries.join(", ") ?? "");
  const [states, setStates] = useState(territory?.states.join(", ") ?? "");
  const [products, setProducts] = useState(territory?.products.join(", ") ?? "");
  const [quota, setQuota] = useState(territory?.quota ?? "");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display">{territory ? "Edit territory" : "New territory"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="West Coast Enterprise" /></div>
          <div className="space-y-2">
            <Label>Countries (comma-separated codes)</Label>
            <Input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="US, CA" className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label>States (comma-separated codes)</Label>
            <Input value={states} onChange={(e) => setStates(e.target.value)} placeholder="CA, OR, WA" className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label>Products (comma-separated)</Label>
            <Input value={products} onChange={(e) => setProducts(e.target.value)} placeholder="Platform, Analytics" />
          </div>
          <div className="space-y-2">
            <Label>Annual quota (USD)</Label>
            <Input type="number" min="0" value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="1000000" className="font-mono" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name || pending}
            onClick={() =>
              onSave({
                name,
                ownerUserId: territory?.ownerUserId ?? userId ?? null,
                countries: parseList(countries),
                states: parseList(states),
                products: parseList(products),
                quota: quota ? quota : null,
              })
            }
          >
            {pending ? "Saving..." : "Save territory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
