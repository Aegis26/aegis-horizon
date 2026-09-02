import { useState } from "react";
import { useRoute } from "wouter";
import { 
  useGetPublicSignatureRequest, 
  getGetPublicSignatureRequestQueryKey,
  useCompletePublicSignatureRequest 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FileSignature, CheckCircle2, ShieldCheck, Download, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Signatures() {
  const [, params] = useRoute("/signatures/:token");
  const token = params?.token || "";
  const { toast } = useToast();

  const { data: request, isLoading, isError } = useGetPublicSignatureRequest(token, {
    query: { enabled: !!token, queryKey: getGetPublicSignatureRequestQueryKey(token) }
  });

  const completeSignature = useCompletePublicSignatureRequest();

  const [signatureText, setSignatureText] = useState("");
  const [consent, setConsent] = useState(false);
  const [completed, setCompleted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!signatureText.trim() || !consent) return;

    completeSignature.mutate({ 
      token, 
      data: { typedSignature: signatureText, consent: true }
    }, {
      onSuccess: () => setCompleted(true),
      onError: () => toast({ title: "Failed to complete signature", variant: "destructive" })
    });
  };

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background/50">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <FileSignature className="w-12 h-12 text-destructive" />
          <h2 className="text-xl font-display font-bold">Invalid or Expired Link</h2>
          <p className="text-muted-foreground text-sm">This signature request is no longer active. Please contact the sender for a new link.</p>
        </div>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background/50">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <FileSignature className="w-12 h-12 text-primary/50" />
          <p className="text-muted-foreground font-mono">Loading document...</p>
        </div>
      </div>
    );
  }

  // If request is undefined and not loading, we can mock it visually or show error
  // But we'll build a mock view anyway because it's a test token usually.
  const docName = request ? `Document ${request.request.id.slice(0,8)}` : "Requested Document";

  if (completed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full border-success/30 shadow-[0_0_40px_rgba(16,185,129,0.1)] bg-card/80 backdrop-blur">
          <CardHeader className="text-center pb-4">
            <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-success" />
            </div>
            <CardTitle className="text-2xl font-display text-success">Document Signed</CardTitle>
            <CardDescription className="text-base mt-2">
              Thank you! Your signature has been securely recorded.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-background border border-border/50 rounded-lg flex items-center gap-4">
              <FileSignature className="w-8 h-8 text-primary opacity-80" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{docName}</p>
                <p className="text-xs text-muted-foreground font-mono mt-1">Completed {new Date().toLocaleDateString()}</p>
              </div>
            </div>
          </CardContent>
          
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Document Preview (Left) */}
        <div className="flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card shadow-xl h-[80vh]">
          <div className="p-4 border-b border-border/50 bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSignature className="w-5 h-5 text-primary" />
              <span className="font-medium font-display truncate">{docName}</span>
            </div>
            <Button variant="ghost" size="sm" className="h-8"><ExternalLink className="w-4 h-4 mr-2"/> Pop out</Button>
          </div>
          <div className="flex-1 bg-muted/10 p-8 flex items-center justify-center relative overflow-hidden">
            {/* Fake document page */}
            <div className="w-full max-w-md aspect-[1/1.4] bg-white rounded shadow-sm border border-black/10 p-12 flex flex-col relative before:absolute before:inset-0 before:bg-[linear-gradient(rgba(0,180,216,0.03)_1px,transparent_1px)] before:bg-[size:100%_2rem]">
              <div className="w-3/4 h-6 bg-black/10 rounded mb-8"></div>
              <div className="w-full h-4 bg-black/5 rounded mb-4"></div>
              <div className="w-full h-4 bg-black/5 rounded mb-4"></div>
              <div className="w-5/6 h-4 bg-black/5 rounded mb-4"></div>
              
              <div className="mt-auto border-t border-black/10 pt-8 flex gap-8">
                <div className="flex-1">
                  <p className="text-black/40 text-[10px] uppercase font-bold tracking-wider mb-2">Signature</p>
                  <div className="h-12 border-b border-black/20 flex items-end pb-1">
                    {signatureText && (
                      <span className="text-black text-2xl font-serif italic tracking-tight">{signatureText}</span>
                    )}
                  </div>
                </div>
                <div className="w-32">
                  <p className="text-black/40 text-[10px] uppercase font-bold tracking-wider mb-2">Date</p>
                  <div className="h-12 border-b border-black/20 flex items-end pb-2">
                    <span className="text-black/80 font-mono text-sm">{new Date().toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Signing Controls (Right) */}
        <div className="flex flex-col justify-center max-w-md">
          <div className="mb-8">
            <h1 className="text-3xl font-display font-bold mb-3">Review & Sign</h1>
            <p className="text-muted-foreground leading-relaxed">
              Please review the document carefully. To complete the signing process, type your full name below. This acts as your legally binding electronic signature.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-4">
              <Label className="text-base">Your Signature</Label>
              <Input 
                value={signatureText} 
                onChange={(e) => setSignatureText(e.target.value)} 
                required 
                placeholder="Type your full legal name" 
                className="h-14 text-lg font-serif italic px-4 bg-card border-primary/20 focus-visible:ring-primary/50 transition-all"
                autoFocus
              />
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-success" /> Encrypted and verifiable
              </p>
            </div>

            <div className="p-5 bg-card border border-primary/10 rounded-xl space-y-4">
              <div className="flex items-start space-x-3">
                <Checkbox 
                  id="consent" 
                  checked={consent} 
                  onCheckedChange={(c) => setConsent(!!c)} 
                  className="mt-1 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                />
                <div className="grid gap-1.5 leading-none">
                  <label htmlFor="consent" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                    I agree to electronically sign
                  </label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    By checking this box and clicking "Complete Signature", I consent to use electronic records and signatures, and I agree to the terms outlined in the document.
                  </p>
                </div>
              </div>
            </div>

            <Button 
              type="submit" 
              disabled={!signatureText.trim() || !consent || completeSignature.isPending} 
              className="w-full h-14 text-lg font-display shadow-[0_0_20px_rgba(0,180,216,0.3)] transition-all hover:shadow-[0_0_30px_rgba(0,180,216,0.5)]"
            >
              Complete Signature
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}