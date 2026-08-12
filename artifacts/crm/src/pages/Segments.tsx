import { useState, useEffect, useRef } from "react";
import { 
  useListSegments, getListSegmentsQueryKey, 
  useCreateSegment, useUpdateSegment, useDeleteSegment,
  getListAccountsQueryKey
} from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Filter, Lock, Plus, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import { SegmentForm, SegmentFormValues } from "@/components/segments/SegmentForm";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Segments() {
  const { selectedOrgId } = useOrgStore();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: segments, error, isLoading } = useListSegments(selectedOrgId || "", {
    query: {
      enabled: !!selectedOrgId,
      queryKey: getListSegmentsQueryKey(selectedOrgId || "")
    }
  });

  const createSegment = useCreateSegment();
  const updateSegment = useUpdateSegment();
  const deleteSegment = useDeleteSegment();

  const [selectedSegmentId, setSelectedSegmentId] = useState<string | "new" | null>(null);
  const selectedSegment = segments?.find(s => s.id === selectedSegmentId);

  const handleSave = (data: SegmentFormValues) => {
    if (!selectedOrgId) return;
    
    const payload = { ...data, conditions: data.conditions.map(c => ({ ...c, value: c.value ?? null })) };

    if (selectedSegmentId === "new") {
      createSegment.mutate({ orgId: selectedOrgId, data: payload }, {
        onSuccess: (newSeg) => {
          toast({ title: "Segment created" });
          queryClient.invalidateQueries({ queryKey: getListSegmentsQueryKey(selectedOrgId) });
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(selectedOrgId) });
          setSelectedSegmentId(newSeg.id);
        }
      });
    } else if (selectedSegmentId) {
      updateSegment.mutate({ orgId: selectedOrgId, segmentId: selectedSegmentId, data: payload }, {
        onSuccess: () => {
          toast({ title: "Segment updated" });
          queryClient.invalidateQueries({ queryKey: getListSegmentsQueryKey(selectedOrgId) });
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(selectedOrgId) });
        }
      });
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedOrgId) return;
    if (confirm("Delete this segment?")) {
      deleteSegment.mutate({ orgId: selectedOrgId, segmentId: id }, {
        onSuccess: () => {
          toast({ title: "Segment deleted" });
          queryClient.invalidateQueries({ queryKey: getListSegmentsQueryKey(selectedOrgId) });
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(selectedOrgId) });
          if (selectedSegmentId === id) setSelectedSegmentId(null);
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
          The Segments feature is not enabled for your organization. 
          Upgrade your plan or customize your features to access this module.
        </p>
        <Button size="lg" className="font-display" onClick={() => setLocation("/billing")}>Manage Features</Button>
      </div>
    );
  }

  return (
    <div className="animate-scaleInEntrance flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between shrink-0 bg-background/50 backdrop-blur-sm z-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1 text-primary">Segments</h1>
          <p className="text-sm text-muted-foreground">Build dynamic lists of accounts based on conditions.</p>
        </div>
        <Button onClick={() => setSelectedSegmentId("new")} className="gap-2 font-display">
          <Plus className="h-4 w-4" /> New Segment
        </Button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left pane: List */}
        <div className="w-1/3 min-w-[300px] border-r border-primary/10 overflow-y-auto bg-card/30">
          <div className="p-4 space-y-2">
            {isLoading ? (
              <div className="p-8 flex justify-center"><div className="spinner" /></div>
            ) : segments?.length === 0 ? (
              <div className="text-center p-8 border border-dashed border-primary/20 rounded-lg">
                <Filter className="h-8 w-8 mx-auto text-muted-foreground opacity-50 mb-2" />
                <p className="text-sm text-muted-foreground">No segments found.</p>
              </div>
            ) : (
              segments?.map(s => (
                <div 
                  key={s.id} 
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedSegmentId === s.id 
                      ? "border-primary bg-primary/10 shadow-glow" 
                      : "border-primary/10 bg-card hover:border-primary/30"
                  }`}
                  onClick={() => setSelectedSegmentId(s.id)}
                >
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-display font-bold text-foreground">{s.name}</h3>
                    <Badge variant="secondary" className="font-mono text-xs">{s.matchCount ?? 0} matches</Badge>
                  </div>
                  {s.description && <p className="text-xs text-muted-foreground truncate">{s.description}</p>}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right pane: Edit/Preview */}
        <div className="flex-1 overflow-y-auto bg-background/50 relative">
          {selectedSegmentId ? (
            <div className="p-8 max-w-4xl mx-auto space-y-8 animate-fadeInBlur">
              <Card className="border-primary/20 shadow-lg bg-card/90 backdrop-blur">
                <CardHeader>
                  <CardTitle className="font-display flex items-center justify-between">
                    {selectedSegmentId === "new" ? "Create Segment" : "Edit Segment"}
                    {selectedSegmentId !== "new" && (
                      <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={(e) => handleDelete(selectedSegmentId, e)}>
                        Delete
                      </Button>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Define rules to automatically group accounts.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* We mount the form keyed by ID so it resets when switching segments */}
                  <SegmentForm 
                    key={selectedSegmentId} 
                    initialData={selectedSegment} 
                    onSubmit={handleSave} 
                    isSubmitting={createSegment.isPending || updateSegment.isPending} 
                  />
                </CardContent>
              </Card>

              {/* Preview block could go here if we trigger usePreviewSegmentConditions with form watch data.
                  For this MVP, we just rely on the static matchCount from the list, or we could add a live preview button. */}
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
              <div className="h-20 w-20 bg-primary/5 rounded-full flex items-center justify-center mb-6 border border-primary/10">
                <Filter className="h-10 w-10 text-primary opacity-50" />
              </div>
              <h2 className="text-xl font-bold font-display mb-2">Select a Segment</h2>
              <p className="text-muted-foreground max-w-sm">
                Choose a segment from the list to view and edit its conditions, or create a new one to filter your CRM.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}