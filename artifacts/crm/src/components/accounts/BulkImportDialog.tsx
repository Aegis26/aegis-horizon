import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useBulkImportAccounts, getListAccountsQueryKey } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Upload } from "lucide-react";

export function BulkImportDialog() {
  const { selectedOrgId } = useOrgStore();
  const queryClient = useQueryClient();
  const bulkImport = useBulkImportAccounts();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState("");

  const handleImport = () => {
    if (!selectedOrgId || !data.trim()) return;
    
    let accountsToImport: Array<{name: string, industry?: string, website?: string}> = [];
    try {
      // Try parsing as JSON first
      const parsed = JSON.parse(data);
      accountsToImport = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      // Not JSON, assume simple CSV (Name, Industry, Website)
      const lines = data.split('\n').filter(l => l.trim());
      accountsToImport = lines.map(line => {
        const [name, industry, website] = line.split(',').map(s => s.trim());
        return { name, industry, website };
      });
    }

    if (accountsToImport.length === 0) {
      toast({ title: "No data to import", variant: "destructive" });
      return;
    }

    bulkImport.mutate({ 
      orgId: selectedOrgId, 
      data: { accounts: accountsToImport }
    }, {
      onSuccess: (result) => {
        toast({ 
          title: "Import complete", 
          description: `Created ${result.accountsCreated} accounts and ${result.contactsCreated} contacts.` 
        });
        if (result.errors?.length) {
          console.error("Import errors:", result.errors);
          toast({ title: "Some records failed", description: "Check console for details.", variant: "destructive" });
        }
        setOpen(false);
        setData("");
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(selectedOrgId) });
      },
      onError: (err) => {
        toast({ title: "Import failed", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 font-display border-primary/20 hover:bg-primary/10">
          <Upload className="h-4 w-4" /> Bulk Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] border-primary/20 shadow-glow bg-card">
        <DialogHeader>
          <DialogTitle className="font-display">Bulk Import Accounts</DialogTitle>
          <DialogDescription>
            Paste a JSON array of accounts, or a simple CSV (Name, Industry, Website).
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea
            placeholder={`[\n  {\n    "name": "Acme Corp",\n    "industry": "Tech"\n  }\n]`}
            className="min-h-[200px] font-mono text-xs bg-background/50 border-primary/20"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={bulkImport.isPending || !data.trim()} className="font-display">
            {bulkImport.isPending ? "Importing..." : "Run Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}