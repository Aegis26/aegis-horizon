import { useUpload } from "@workspace/object-storage-web";
import { useCreateActivity, useGetAccountTimeline, getGetAccountTimelineQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FileText, UploadCloud, Download } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

export function FilesTab({ accountId, orgId }: { accountId: string, orgId: string }) {
  const queryClient = useQueryClient();
  const createActivity = useCreateActivity();
  
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { uploadFile, isUploading } = useUpload({
    basePath: `${basePath}/api/storage`,
    onSuccess: (response: any) => {
      // Create a file activity to track it
      createActivity.mutate({
        orgId,
        accountId,
        data: {
          type: "file",
          subject: response.metadata.name,
          attachments: [{
            objectPath: response.objectPath,
            name: response.metadata.name,
            size: response.metadata.size,
            contentType: response.metadata.contentType,
            uploadedAt: new Date().toISOString()
          }]
        }
      }, {
        onSuccess: () => {
          toast({ title: "File uploaded successfully" });
          queryClient.invalidateQueries({ queryKey: getGetAccountTimelineQueryKey(orgId, accountId) });
        }
      });
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
    // reset input
    e.target.value = '';
  };

  // We extract files from the timeline activities of type "file" or any activity with attachments
  const { data: timeline, isLoading } = useGetAccountTimeline(orgId, accountId, { query: { enabled: !!orgId, queryKey: getGetAccountTimelineQueryKey(orgId, accountId) }});
  
  const allFiles = timeline?.flatMap(act => act.attachments || []).filter(Boolean) || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-display font-semibold text-primary">Files & Documents</h3>
        <div>
          <input type="file" id="file-upload" className="hidden" onChange={handleFileSelect} disabled={isUploading} />
          <Button asChild size="sm" className="font-display gap-2 cursor-pointer" disabled={isUploading}>
            <label htmlFor="file-upload">
              <UploadCloud className="h-4 w-4" /> {isUploading ? "Uploading..." : "Upload File"}
            </label>
          </Button>
        </div>
      </div>

      <Card className="border-primary/10 bg-card/80 shadow-md">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-background/50">
              <TableRow className="border-primary/10">
                <TableHead>Filename</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center p-8"><div className="spinner mx-auto" /></TableCell></TableRow>
              ) : allFiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center p-12 text-muted-foreground">
                    <FileText className="h-10 w-10 mx-auto mb-4 opacity-20" />
                    No files attached to this account yet.
                  </TableCell>
                </TableRow>
              ) : (
                allFiles.map(file => (
                  <TableRow key={file.objectPath} className="border-primary/5 hover:bg-primary/5 group">
                    <TableCell className="font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" />
                        {file.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{file.contentType || "Unknown"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {file.size ? `${(file.size / 1024).toFixed(1)} KB` : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {formatDate(file.uploadedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" asChild>
                        <a href={`${basePath}/api/storage${file.objectPath}`} target="_blank" rel="noreferrer" download>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
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