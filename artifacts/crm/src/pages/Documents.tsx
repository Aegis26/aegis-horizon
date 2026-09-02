import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListDocuments, getListDocumentsQueryKey, getDownloadDocumentUrl,
  useCreateDocument, useCreateSignatureRequest,
  useRequestUploadUrl,
  useCreateDocumentVersion
} from "@workspace/api-client-react";
import type { DocumentUploadInputContentType } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FileText, FolderKanban, Upload, FileSignature, Download, MoreVertical, PenTool, Link as LinkIcon, FileCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";


export default function Documents() {
  const { selectedOrgId } = useOrgStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reqSigOpen, setReqSigOpen] = useState<string | null>(null);
  const [versionDocId, setVersionDocId] = useState<string | null>(null);

  const { data: documents, isLoading } = useListDocuments(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getListDocumentsQueryKey(selectedOrgId || "") }
  });

  const createDoc = useCreateDocument();
  const createSigReq = useCreateSignatureRequest();
  const createDocVersion = useCreateDocumentVersion();
  const requestUpload = useRequestUploadUrl();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 25MB.", variant: "destructive" });
      return;
    }

    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!allowedTypes.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Only PDF, DOC, DOCX, and Text files are allowed.", variant: "destructive" });
      return;
    }

    requestUpload.mutate({ data: { name: file.name, size: file.size, contentType: file.type } }, {
      onSuccess: async (data) => {
        try {
          const uploadResponse = await fetch(data.uploadURL, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": file.type },
          });
          if (!uploadResponse.ok) throw new Error(`Upload failed with status ${uploadResponse.status}`);
          
          if (versionDocId) {
            createDocVersion.mutate({
              orgId: selectedOrgId!,
              documentId: versionDocId,
              data: {
                objectPath: data.objectPath,
                fileName: file.name,
                contentType: file.type as DocumentUploadInputContentType,
                sizeBytes: file.size
              }
            }, {
              onSuccess: () => {
                toast({ title: "New version uploaded successfully" });
                queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(selectedOrgId!) });
                setVersionDocId(null);
                setUploadOpen(false);
              },
              onError: () => toast({ title: "Failed to upload new version", variant: "destructive" })
            });
          } else {
            createDoc.mutate({ 
              orgId: selectedOrgId!, 
              data: { 
                name: file.name, 
                upload: { 
                  objectPath: data.objectPath, 
                  fileName: file.name, 
                  contentType: file.type as DocumentUploadInputContentType, 
                  sizeBytes: file.size 
                } 
              } 
            }, {
              onSuccess: () => {
                toast({ title: "Document uploaded successfully" });
                queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(selectedOrgId!) });
                setUploadOpen(false);
              },
              onError: () => toast({ title: "Failed to upload document", variant: "destructive" })
            });
          }
        } catch (err) {
          toast({ title: "Upload failed", variant: "destructive" });
        }
      },
      onError: () => toast({ title: "Could not prepare upload", variant: "destructive" }),
    });
  };

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    fileInputRef.current?.click();
  };
  const handleUploadVersion = (docId: string) => {
    setVersionDocId(docId);
    setUploadOpen(true);
  };

  const handleReqSig = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!reqSigOpen) return;
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const name = formData.get("name") as string;
    const message = formData.get("message") as string;

    createSigReq.mutate({ 
      orgId: selectedOrgId!, 
      documentId: reqSigOpen,
      data: {
        signers: [{ name, email }],
        message: message || undefined
      }
    }, {
      onSuccess: (data) => {
        const link = data?.signingLinks?.[0]?.signingUrl;
        toast({ 
          title: "Signature requested", 
          description: link ? `Signer link generated: ${link}` : "Email has been sent to signers." 
        });
        if (link) {
          navigator.clipboard.writeText(link);
          toast({ title: "Link copied to clipboard", description: link });
        }
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(selectedOrgId!) });
        setReqSigOpen(null);
      },
      onError: () => {
        toast({ title: "Failed to request signature", variant: "destructive" });
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'signed': return <Badge variant="outline" className="bg-success/10 text-success border-success/20 font-mono text-[10px] uppercase"><FileCheck className="w-3 h-3 mr-1"/> Signed</Badge>;
      case 'pending_signature': return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 font-mono text-[10px] uppercase"><PenTool className="w-3 h-3 mr-1"/> Pending</Badge>;
      default: return <Badge variant="secondary" className="font-mono text-[10px] uppercase text-muted-foreground">{status}</Badge>;
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between bg-background/50 backdrop-blur-sm shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1 flex items-center gap-3">
            <FolderKanban className="h-8 w-8 text-primary" /> Documents
          </h1>
          <p className="text-sm text-muted-foreground">Secure document storage, versioning, and e-signatures.</p>
        </div>
        <Dialog open={uploadOpen} onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) setVersionDocId(null);
        }}>
          <DialogTrigger asChild>
            <Button
              className="font-display shadow-[0_0_12px_rgba(0,180,216,0.4)]"
              onClick={() => setVersionDocId(null)}
            >
              <Upload className="w-4 h-4 mr-2" /> Upload Document
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{versionDocId ? "Upload New Version" : "Upload Document"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpload} className="space-y-4 mt-4">
              <div 
                className="border-2 border-dashed border-primary/20 rounded-xl p-12 flex flex-col items-center justify-center bg-card/30 hover:bg-card/50 hover:border-primary/40 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={handleFileSelect}
                />
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Upload className="w-6 h-6 text-primary" />
                </div>
                <p className="font-medium text-foreground mb-1">Click to browse for a file</p>
                <p className="text-xs text-muted-foreground text-center">Supports PDF, DOC, DOCX, TXT up to 25MB</p>
              </div>
              <div className="space-y-2">
                <Label>Link to Record (Optional)</Label>
                <Input placeholder="Search accounts or opportunities..." className="bg-background" />
              </div>
              <Button type="submit" className="w-full font-display">
                {versionDocId ? "Upload New Version" : "Upload Document"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <Tabs defaultValue="library" className="w-full">
          <TabsList className="mb-6 bg-card border border-border/50 h-11">
            <TabsTrigger value="library" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded">Document Library</TabsTrigger>
            <TabsTrigger value="signatures" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded">Signature Requests</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="m-0">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Linked Record</TableHead>
                    <TableHead>Version Status</TableHead>
                    <TableHead>Modified</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(documents || []).map(doc => (
                    <TableRow key={doc.id} className="border-border/50 hover:bg-card/50 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <FileText className="w-8 h-8 text-muted-foreground opacity-50 shrink-0" />
                          <div>
                            <p className="font-medium text-sm text-foreground">{doc.name}</p>
                            <p className="text-xs font-mono text-muted-foreground mt-0.5">v{doc.currentVersion}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(doc.status)}</TableCell>
                      <TableCell>
                        {doc.accountId || doc.opportunityId ? (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary cursor-pointer transition-colors">
                            <LinkIcon className="w-3 h-3" /> {doc.opportunityId || doc.accountId}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground opacity-50">Unlinked</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{doc.currentVersion > 0 ? "Latest" : "No version"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(doc.createdAt), 'MMM d, yyyy')}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="hover:bg-primary/10 hover:text-primary"><MoreVertical className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem className="cursor-pointer" onClick={() => setReqSigOpen(doc.id)}>
                              <FileSignature className="w-4 h-4 mr-2" /> Request Signature
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer" onClick={() => window.open(getDownloadDocumentUrl(selectedOrgId!, doc.id), "_blank")}>
                              <Download className="w-4 h-4 mr-2" /> Download File
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer" onClick={() => handleUploadVersion(doc.id)}>
                              <Upload className="w-4 h-4 mr-2" /> Upload New Version
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive">
                              Delete Document
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <Dialog open={reqSigOpen === doc.id} onOpenChange={(o) => setReqSigOpen(o ? doc.id : null)}>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Request eSignature</DialogTitle>
                            </DialogHeader>
                            <form onSubmit={handleReqSig} className="space-y-4 mt-4">
                              <div className="p-3 bg-muted rounded-md mb-4 flex items-center gap-3">
                                <FileText className="w-6 h-6 text-primary" />
                                <span className="font-medium text-sm">{doc.name}</span>
                              </div>
                              <div className="space-y-2">
                                <Label>Recipient Email</Label>
                                <Input name="email" type="email" placeholder="client@company.com" required className="bg-background" />
                              </div>
                              <div className="space-y-2">
                                <Label>Recipient Name</Label>
                                <Input name="name" placeholder="Jane Doe" required className="bg-background" />
                              </div>
                              <div className="space-y-2 pt-2">
                                <Label>Message (Optional)</Label>
                                <Input name="message" placeholder="Please sign the attached document to finalize..." className="bg-background" />
                              </div>
                              <Button type="submit" className="w-full font-display mt-2" disabled={createSigReq.isPending}>Send Request</Button>
                            </form>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="signatures" className="m-0">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead>Document</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Sent At</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Signature status is tracked on individual documents. Open a document to view its signature requests.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}