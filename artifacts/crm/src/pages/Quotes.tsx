import { useState } from "react";
import {
  useListQuotes, getListQuotesQueryKey,
  useUpdateQuote, useDeleteQuote, useSendQuote, useAcceptQuote,
  getQuotePdf,
} from "@workspace/api-client-react";
import type { Quote, QuoteLineItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgStore } from "@/store/org-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { FileText, Download, Send, CheckCircle2, Pencil, Trash2, Plus } from "lucide-react";
import { formatDate } from "@/lib/format";

const STATUS_COLORS: Record<string, string> = {
  draft: "border-muted-foreground/40 text-muted-foreground",
  sent: "border-primary/40 text-primary",
  accepted: "border-emerald-500/40 text-emerald-400",
  rejected: "border-red-500/40 text-red-400",
  expired: "border-amber-500/40 text-amber-400",
};

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function Quotes() {
  const { selectedOrgId } = useOrgStore();
  const orgId = selectedOrgId || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState<Quote | null>(null);
  const [sending, setSending] = useState<Quote | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: quotes, isLoading } = useListQuotes(orgId, undefined, {
    query: { enabled: !!orgId, retry: false, queryKey: getListQuotesQueryKey(orgId) },
  });

  const updateQuote = useUpdateQuote();
  const deleteQuote = useDeleteQuote();
  const sendQuote = useSendQuote();
  const acceptQuote = useAcceptQuote();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListQuotesQueryKey(orgId) });
  const onError = (title: string) => (e: unknown) =>
    toast({ title, description: (e as Error).message, variant: "destructive" });

  const downloadPdf = async (quote: Quote) => {
    setDownloading(quote.id);
    try {
      const blob = (await getQuotePdf(orgId, quote.id)) as unknown as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quote.quoteNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      onError("Could not download PDF")(e);
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading) return <div className="p-8"><div className="skeleton h-64 rounded-xl"></div></div>;

  return (
    <div>
      <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1">Quotes</h1>
          <p className="text-sm text-muted-foreground">
            Create quotes from any opportunity, then send branded PDFs to buyers.
          </p>
        </div>
      </header>

      <div className="p-8">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Opportunity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Valid until</TableHead>
                  <TableHead className="w-52"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!quotes || quotes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0">
                      <div className="flex flex-col items-center justify-center min-h-[320px] px-6 py-16 bg-background/30 text-center">
                        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                          <FileText className="h-10 w-10 text-primary opacity-50" />
                        </div>
                        <h3 className="font-display text-2xl font-bold mb-2">No quotes yet</h3>
                        <p className="text-muted-foreground max-w-sm">
                          Open an opportunity in your pipeline and click "Create quote" to generate one in two clicks.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  quotes.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="font-mono font-medium text-foreground">{q.quoteNumber}</TableCell>
                      <TableCell className="text-muted-foreground">{q.accountName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{q.opportunityName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`capitalize ${STATUS_COLORS[q.status] ?? ""}`}>{q.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">{money(q.total)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground/80">{formatDate(q.validUntil)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" disabled={downloading === q.id} onClick={() => downloadPdf(q)} title="Download PDF">
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          {q.status !== "accepted" && (
                            <Button size="sm" variant="ghost" onClick={() => setEditing(q)} title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {(q.status === "draft" || q.status === "sent") && (
                            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSending(q)}>
                              <Send className="h-3.5 w-3.5" /> Send
                            </Button>
                          )}
                          {q.status === "sent" && (
                            <Button
                              size="sm" variant="outline" className="gap-1.5 border-emerald-500/40 text-emerald-400"
                              disabled={acceptQuote.isPending}
                              onClick={() =>
                                acceptQuote.mutate({ orgId, quoteId: q.id }, {
                                  onSuccess: () => { invalidate(); toast({ title: "Quote accepted" }); },
                                  onError: onError("Could not accept quote"),
                                })
                              }
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> Accept
                            </Button>
                          )}
                          {q.status === "draft" && (
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => deleteQuote.mutate({ orgId, quoteId: q.id }, { onSuccess: invalidate, onError: onError("Could not delete quote") })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
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

      {editing && (
        <EditQuoteDialog
          quote={editing}
          pending={updateQuote.isPending}
          onClose={() => setEditing(null)}
          onSave={(data) =>
            updateQuote.mutate({ orgId, quoteId: editing.id, data }, {
              onSuccess: () => { setEditing(null); invalidate(); },
              onError: onError("Could not save quote"),
            })
          }
        />
      )}

      {sending && (
        <SendQuoteDialog
          quote={sending}
          pending={sendQuote.isPending}
          onClose={() => setSending(null)}
          onSend={(data) =>
            sendQuote.mutate({ orgId, quoteId: sending.id, data }, {
              onSuccess: () => {
                setSending(null);
                invalidate();
                toast({ title: "Quote sent", description: `Emailed to ${data.recipientEmail ?? sending.recipientEmail}.` });
              },
              onError: onError("Could not send quote"),
            })
          }
        />
      )}
    </div>
  );
}

type EditableLineItem = { name: string; description: string; quantity: string; unitPrice: string; discountPercent: string };

function EditQuoteDialog({ quote, onClose, onSave, pending }: {
  quote: Quote;
  onClose: () => void;
  onSave: (data: { lineItems: QuoteLineItem[]; discountPercent: number; validUntil?: string | null; recipientEmail?: string | null; notes?: string | null }) => void;
  pending: boolean;
}) {
  const [items, setItems] = useState<EditableLineItem[]>(
    quote.lineItems.map((li) => ({
      name: li.name,
      description: li.description ?? "",
      quantity: String(li.quantity),
      unitPrice: String(li.unitPrice),
      discountPercent: li.discountPercent != null ? String(li.discountPercent) : "",
    })),
  );
  const [discount, setDiscount] = useState(String(quote.discountPercent ?? 0));
  const [validUntil, setValidUntil] = useState(quote.validUntil ?? "");
  const [recipientEmail, setRecipientEmail] = useState(quote.recipientEmail ?? "");
  const [notes, setNotes] = useState(quote.notes ?? "");

  const setItem = (i: number, k: keyof EditableLineItem, v: string) =>
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  const subtotal = items.reduce((s, it) => {
    const line = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
    return s + line * (1 - (Number(it.discountPercent) || 0) / 100);
  }, 0);
  const total = subtotal * (1 - (Number(discount) || 0) / 100);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Edit quote {quote.quoteNumber}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Line items</Label>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-4" placeholder="Item" value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} />
                  <Input className="col-span-2 font-mono" type="number" min="0" placeholder="Qty" value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} />
                  <Input className="col-span-3 font-mono" type="number" min="0" placeholder="Unit price" value={it.unitPrice} onChange={(e) => setItem(i, "unitPrice", e.target.value)} />
                  <Input className="col-span-2 font-mono" type="number" min="0" max="100" placeholder="Disc %" value={it.discountPercent} onChange={(e) => setItem(i, "discountPercent", e.target.value)} />
                  <Button size="sm" variant="ghost" className="col-span-1" disabled={items.length === 1} onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => setItems((arr) => [...arr, { name: "", description: "", quantity: "1", unitPrice: "0", discountPercent: "" }])}>
              <Plus className="h-3.5 w-3.5" /> Add line item
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Overall discount %</Label><Input type="number" min="0" max="100" value={discount} onChange={(e) => setDiscount(e.target.value)} className="font-mono" /></div>
            <div className="space-y-2"><Label>Valid until</Label><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="font-mono" /></div>
            <div className="space-y-2"><Label>Recipient email</Label><Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
          <div className="flex justify-end gap-6 text-sm border-t pt-3">
            <span className="text-muted-foreground">Subtotal <span className="font-mono text-foreground ml-1">{money(subtotal)}</span></span>
            <span className="text-muted-foreground">Total <span className="font-mono font-bold text-foreground ml-1">{money(total)}</span></span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={pending || items.some((it) => !it.name)}
            onClick={() =>
              onSave({
                lineItems: items.map((it) => ({
                  name: it.name,
                  description: it.description || null,
                  quantity: Number(it.quantity) || 0,
                  unitPrice: Number(it.unitPrice) || 0,
                  discountPercent: it.discountPercent ? Number(it.discountPercent) : null,
                })),
                discountPercent: Number(discount) || 0,
                validUntil: validUntil || null,
                recipientEmail: recipientEmail || null,
                notes: notes || null,
              })
            }
          >
            {pending ? "Saving..." : "Save quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendQuoteDialog({ quote, onClose, onSend, pending }: {
  quote: Quote;
  onClose: () => void;
  onSend: (data: { recipientEmail?: string; message?: string }) => void;
  pending: boolean;
}) {
  const [email, setEmail] = useState(quote.recipientEmail ?? "");
  const [message, setMessage] = useState("");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display">Send quote {quote.quoteNumber}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Recipient email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="buyer@company.com" />
          </div>
          <div className="space-y-2">
            <Label>Message (optional)</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Thanks for your time today - quote attached." />
          </div>
          <p className="text-xs text-muted-foreground">
            The quote PDF will be attached and the total will be included in the email body.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            className="gap-2"
            disabled={!email || pending}
            onClick={() => onSend({ recipientEmail: email, message: message || undefined })}
          >
            <Send className="h-4 w-4" /> {pending ? "Sending..." : "Send quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
