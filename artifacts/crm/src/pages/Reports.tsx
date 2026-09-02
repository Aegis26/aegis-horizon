import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListCustomReports, getListCustomReportsQueryKey,
  useCreateCustomReport, useRunCustomReport, useCreateCustomReportExport,
  useListReportSchedules, getListReportSchedulesQueryKey, useCreateReportSchedule,
  useListCustomReportRuns, getListCustomReportRunsQueryKey
} from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Plus, Play, Download, Clock, Filter, LayoutGrid, Calendar, ChevronRight, FileSpreadsheet, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function Reports() {
  const { selectedOrgId } = useOrgStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [builderOpen, setBuilderOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState<string | null>(null);

  // Form states for builder
  const [reportName, setReportName] = useState("");
  const [entityType, setEntityType] = useState<"accounts" | "leads" | "opportunities">("opportunities");
  const [selectedFields, setSelectedFields] = useState<string[]>(["id", "name", "value", "stage"]);
  const [selectedConditions, setSelectedConditions] = useState<any[]>([]);
  // API Hooks
  const { data: reports, isLoading: reportsLoading } = useListCustomReports(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getListCustomReportsQueryKey(selectedOrgId || "") }
  });

  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  // Note: the backend only supports listing runs/schedules for a specific reportId.
  // In the real UI, we will only fetch runs/schedules when a report is selected or 
  // fetch the first one if none selected. For the run history view, we might need a list of all, 
  // but if the API doesn't support listAllRuns, we show runs for the currently selected report.
  const activeReportId = selectedReportId || (reports && reports.length > 0 ? reports[0].id : "");

  const { data: runs } = useListCustomReportRuns(selectedOrgId || "", activeReportId || "", {
    query: { enabled: !!selectedOrgId && !!activeReportId, queryKey: getListCustomReportRunsQueryKey(selectedOrgId || "", activeReportId || "") }
  });

  const { data: schedules } = useListReportSchedules(selectedOrgId || "", activeReportId || "", {
    query: { enabled: !!selectedOrgId && !!activeReportId, queryKey: getListReportSchedulesQueryKey(selectedOrgId || "", activeReportId || "") }
  });
  const createReport = useCreateCustomReport();
  const runReport = useRunCustomReport();
  const createExport = useCreateCustomReportExport();
  const createSchedule = useCreateReportSchedule();

  const handleCreateReport = (e: React.FormEvent) => {
    e.preventDefault();
    createReport.mutate({ 
      orgId: selectedOrgId!, 
      data: {
        name: reportName,
        entityType: entityType,
        definition: {
          fields: selectedFields,
          conditions: selectedConditions.length > 0 ? selectedConditions : undefined
        }
      }
    }, {
      onSuccess: () => {
        toast({ title: "Report created", description: "Your custom report has been saved." });
        queryClient.invalidateQueries({ queryKey: getListCustomReportsQueryKey(selectedOrgId!) });
        setBuilderOpen(false);
      },
      onError: () => {
       toast({ title: "Failed to create report", variant: "destructive" });
      }
    });
  };

  const handleRun = (reportId: string) => {
    runReport.mutate({ orgId: selectedOrgId!, reportId }, {
      onSuccess: () => {
        toast({ title: "Report queued", description: "The report run has been initiated." });
        queryClient.invalidateQueries({ queryKey: getListCustomReportRunsQueryKey(selectedOrgId!, reportId) });
      },
      onError: () => toast({ title: "Report run failed", variant: "destructive" })
    });
  };

  const handleExport = (reportId: string, format: "csv" | "pdf" | "xlsx") => {
    createExport.mutate({ orgId: selectedOrgId!, reportId, data: { format } }, {
      onSuccess: (data) => {
        toast({ title: "Export complete", description: `Your ${format.toUpperCase()} export is ready.` });
        if (data.downloadUrl) { window.open(data.downloadUrl, "_blank"); }
        queryClient.invalidateQueries({ queryKey: getListCustomReportRunsQueryKey(selectedOrgId!, reportId) });
        setExportOpen(null);
      },
      onError: () => {
        toast({ title: "Export failed", variant: "destructive" });
      }
    });
  };

  const handleSchedule = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!scheduleOpen) return;
    
    const formData = new FormData(e.currentTarget);
    const frequency = formData.get("frequency") as "daily" | "weekly" | "monthly";
    const email = formData.get("email") as string;
    
    createSchedule.mutate({ 
      orgId: selectedOrgId!, 
      reportId: scheduleOpen,
      data: {
        frequency: frequency || "weekly",
        format: "pdf",
        recipientEmails: [email]
      }
    }, {
      onSuccess: () => {
        toast({ title: "Schedule created", description: "Report will run automatically." });
        queryClient.invalidateQueries({ queryKey: getListReportSchedulesQueryKey(selectedOrgId!, scheduleOpen) });
        setScheduleOpen(null);
      },
      onError: () => {
        toast({ title: "Failed to create schedule", variant: "destructive" });
      }
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between bg-background/50 backdrop-blur-sm shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1 flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-primary" /> Reports
          </h1>
          <p className="text-sm text-muted-foreground">Custom report builder and export management.</p>
        </div>
        
        <div className="flex gap-2">
          <Button variant="secondary" className="font-display shadow-[0_0_12px_rgba(0,180,216,0.2)]" onClick={() => {
            createReport.mutate({ 
              orgId: selectedOrgId!, 
              data: {
                name: "Stalled High-Value Ops",
                description: "Opportunities > $100k not touched in 7+ days",
                entityType: "opportunities",
                definition: {
                  fields: ["id", "name", "value", "stage", "daysSinceLastTouch"],
                  conditions: [
                    { field: "value", operator: "gt", value: 100000 },
                    { field: "daysSinceLastTouch", operator: "gte", value: 7 }
                  ]
                }
              }
            }, {
              onSuccess: () => { 
                toast({ title: "Preset created" }); 
                queryClient.invalidateQueries({ queryKey: getListCustomReportsQueryKey(selectedOrgId!) });
                setBuilderOpen(false); 
              },
              onError: () => toast({ title: "Failed to create preset", variant: "destructive" })
            });
          }}>
            <Plus className="w-4 h-4 mr-2" /> Stalled High-Value Preset
          </Button>
          <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
          <DialogTrigger asChild>
            <Button className="font-display shadow-[0_0_12px_rgba(0,180,216,0.4)]"><Plus className="w-4 h-4 mr-2" /> New Report</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl border-primary/20">
            <DialogHeader>
              <DialogTitle className="font-display text-xl text-primary">Report Builder</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateReport} className="space-y-6 mt-4">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Report Name</Label>
                  <Input value={reportName} onChange={(e) => setReportName(e.target.value)} required placeholder="e.g. Q3 Pipeline Review" className="bg-background" />
                </div>
                <div className="space-y-2">
                  <Label>Entity Type</Label>
                  <Select value={entityType} onValueChange={(val: any) => setEntityType(val)}>
                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="opportunities">Opportunities</SelectItem>
                      <SelectItem value="accounts">Accounts</SelectItem>
                      <SelectItem value="leads">Leads</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="p-4 border border-border/50 rounded-lg bg-card/50 space-y-4">
                <h4 className="font-display font-semibold flex items-center gap-2 text-sm text-muted-foreground">
                  <Filter className="w-4 h-4" /> Filters
                </h4>
                <div className="flex flex-col gap-2">
                  {selectedConditions.map((cond, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm text-foreground bg-background p-2 rounded">
                      <span>{cond.field === "value" ? "Opportunity Value" : cond.field === "daysSinceLastTouch" ? "Days Since Last Touch" : cond.field}</span>
                      <span className="text-muted-foreground">{cond.operator}</span>
                      <span>{cond.value}</span>
                      <Button type="button" variant="ghost" size="icon" className="ml-auto h-6 w-6 text-destructive" onClick={() => setSelectedConditions(prev => prev.filter((_, i) => i !== idx))}>✕</Button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 mt-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelectedConditions(prev => [...prev, { field: "amount", operator: "gt", value: 5000 }])}>
                      <Plus className="w-3 h-3 mr-1" /> Add Example Condition
                    </Button>
                  </div>
                </div>
              </div>

              <div className="p-4 border border-border/50 rounded-lg bg-card/50 space-y-4">
                <h4 className="font-display font-semibold flex items-center gap-2 text-sm text-muted-foreground">
                  <LayoutGrid className="w-4 h-4" /> Columns
                </h4>
                <div className="flex flex-wrap gap-2">
                  {selectedFields.map(col => (
                    <Badge key={col === "value" ? "Opportunity Value" : col === "daysSinceLastTouch" ? "Days Since Last Touch" : col} variant="secondary" className="px-3 py-1 border border-border/50 flex items-center gap-1">
                      {col}
                      <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setSelectedFields(prev => prev.filter(f => f !== col))}>✕</button>
                    </Badge>
                  ))}
                  <Button type="button" variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => !selectedFields.includes("createdAt") && setSelectedFields(prev => [...prev, "createdAt"])}>
                    <Plus className="w-3 h-3 mr-1"/> Add Date
                  </Button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border/50">
                <Button type="button" variant="ghost" onClick={() => setBuilderOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createReport.isPending} className="font-display">Save Report</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <Tabs defaultValue="saved" className="w-full">
          <TabsList className="mb-6 bg-card border border-border/50 h-11">
            <TabsTrigger value="saved" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded">Saved Reports</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded">Run History</TabsTrigger>
            <TabsTrigger value="schedules" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded">Schedules</TabsTrigger>
          </TabsList>

          <TabsContent value="saved" className="space-y-6 m-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(reports || []).map(report => (
                <Card key={report.id} className="flex flex-col hover:border-primary/30 transition-colors shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,180,216,0.06)] bg-gradient-to-b from-card to-background">
                  <CardHeader className="pb-4">
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant="secondary" className="font-mono uppercase text-[10px]">
                        Custom
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-mono border-primary/20 text-primary capitalize">{report.entityType}</Badge>
                    </div>
                    <CardTitle className="font-display text-lg">{report.name}</CardTitle>
                    <CardDescription className="line-clamp-2 h-10">{report.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto pt-4 border-t border-border/30 flex items-center justify-between gap-2">
                    <Button variant="ghost" size="sm" className="text-primary hover:text-primary hover:bg-primary/10 flex-1" onClick={() => handleRun(report.id)}>
                      <Play className="w-4 h-4 mr-2" /> Run
                    </Button>
                    
                    <Dialog open={exportOpen === report.id} onOpenChange={(o) => setExportOpen(o ? report.id : null)}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground flex-1">
                          <Download className="w-4 h-4 mr-2" /> Export
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-sm">
                        <DialogHeader>
                          <DialogTitle>Export Report</DialogTitle>
                        </DialogHeader>
                        <div className="grid grid-cols-3 gap-4 py-4">
                          <Button variant="outline" className="flex flex-col h-24 gap-2 hover:border-primary/50 hover:bg-primary/5" onClick={() => handleExport(report.id, 'csv')}>
                            <FileText className="w-8 h-8 text-primary" />
                            CSV
                          </Button>
                          <Button variant="outline" className="flex flex-col h-24 gap-2 hover:border-primary/50 hover:bg-primary/5" onClick={() => handleExport(report.id, 'xlsx')}>
                            <FileSpreadsheet className="w-8 h-8 text-green-500" />
                            XLSX
                          </Button>
                          <Button variant="outline" className="flex flex-col h-24 gap-2 hover:border-primary/50 hover:bg-primary/5" onClick={() => handleExport(report.id, 'pdf')}>
                            <FileText className="w-8 h-8 text-red-500" />
                            PDF
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Dialog open={scheduleOpen === report.id} onOpenChange={(o) => setScheduleOpen(o ? report.id : null)}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground shrink-0">
                          <Clock className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Schedule Report</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleSchedule} className="space-y-4 mt-4">
                          <div className="space-y-2">
                            <Label>Frequency</Label>
                            <Select name="frequency" defaultValue="weekly">
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="daily">Daily</SelectItem>
                                <SelectItem value="weekly">Weekly</SelectItem>
                                <SelectItem value="monthly">Monthly</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Delivery Email</Label>
                            <Input name="email" type="email" placeholder="sales-team@company.com" required />
                          </div>
                          <Button type="submit" className="w-full font-display mt-2" disabled={createSchedule.isPending}>Create Schedule</Button>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

                    <TabsContent value="history" className="m-0 space-y-4">
            <div className="flex items-center gap-4">
              <Label className="whitespace-nowrap">Select Report</Label>
              <Select value={selectedReportId || (reports && reports.length > 0 ? reports[0].id : "")} onValueChange={setSelectedReportId}>
                <SelectTrigger className="w-[300px]"><SelectValue placeholder="Select a report..." /></SelectTrigger>
                <SelectContent>
                  {(reports || []).map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead>Run ID</TableHead>
                    <TableHead>Executed At</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!(runs || []).length ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No runs found for this report.</TableCell>
                    </TableRow>
                  ) : (runs || []).map(run => (
                    <TableRow key={run.id} className="border-border/50 hover:bg-card/50 transition-colors">
                      <TableCell className="font-mono text-xs text-muted-foreground">{run.id}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{format(new Date(run.startedAt), 'MMM d, yyyy HH:mm')}</TableCell>
                      <TableCell className="font-mono">{run.rowCount}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-success/10 text-success border-success/20 font-mono text-[10px] uppercase">
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="hover:bg-primary/10 hover:text-primary"
                          disabled={createExport.isPending}
                          onClick={() => handleExport(run.reportId, "pdf")}
                        >
                          Export PDF <Download className="w-3 h-3 ml-2" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

                    <TabsContent value="schedules" className="m-0 space-y-4">
            <div className="flex items-center gap-4">
              <Label className="whitespace-nowrap">Select Report</Label>
              <Select value={selectedReportId || (reports && reports.length > 0 ? reports[0].id : "")} onValueChange={setSelectedReportId}>
                <SelectTrigger className="w-[300px]"><SelectValue placeholder="Select a report..." /></SelectTrigger>
                <SelectContent>
                  {(reports || []).map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {!(schedules || []).length ? (
              <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-border/50 rounded-xl bg-card/30">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Calendar className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-display font-bold mb-2">No Active Schedules</h3>
                <p className="text-muted-foreground max-w-md">
                  Automate your reporting by creating a schedule from any saved report. Reports can be delivered via email in CSV, PDF, or XLSX format.
                </p>
              </div>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead>Format</TableHead>
                      <TableHead>Cron / Schedule</TableHead>
                      <TableHead>Recipients</TableHead>
                      <TableHead>Next Run</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(schedules || []).map(sched => (
                      <TableRow key={sched.id} className="border-border/50 hover:bg-card/50 transition-colors">
                        <TableCell className="font-mono uppercase text-xs">{sched.format}</TableCell>
                        <TableCell className="font-mono text-xs">{sched.cronExpression}</TableCell>
                        <TableCell className="text-sm">{sched.recipientEmails.join(', ')}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{sched.nextRunAt ? format(new Date(sched.nextRunAt), 'MMM d, yyyy HH:mm') : 'Pending'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}