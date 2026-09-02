import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useOrgStore } from "@/store/org-store";
import {
  useListAccounts, getListAccountsQueryKey,
  useListEmailThreads, getListEmailThreadsQueryKey,
  useListCalendarEvents, getListCalendarEventsQueryKey,
  useListCallRecordings, getListCallRecordingsQueryKey,
  useSendCrmEmail
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Calendar, Phone, Search, Building2, Send, Clock, UserCircle, MessageSquare } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function Communications() {
  const { selectedOrgId } = useOrgStore();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: accounts, isLoading: accountsLoading } = useListAccounts(selectedOrgId || "", undefined, {
    query: { enabled: !!selectedOrgId, queryKey: getListAccountsQueryKey(selectedOrgId || "", undefined) }
  });

  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    if (!searchQuery.trim()) return accounts;
    return accounts.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [accounts, searchQuery]);

  // If we have accounts and none is selected, don't auto-select. Force them to pick one from the inbox layout.

  return (
    <div className="flex h-full flex-col">
      <header className="px-6 py-4 border-b border-primary/10 flex items-center justify-between bg-background/50 backdrop-blur-sm sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center border border-primary/20 shadow-glow">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight font-display mb-0.5">Communications</h1>
            <p className="text-sm text-muted-foreground leading-none">Unified inbox for all customer conversations</p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Accounts */}
        <div className="w-80 border-r border-primary/10 bg-card/30 flex flex-col shrink-0 overflow-hidden">
          <div className="p-4 border-b border-primary/10">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search accounts..."
                className="pl-9 h-9 bg-background/50 border-primary/20 text-sm"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {accountsLoading ? (
              <div className="p-4 flex justify-center"><div className="spinner h-5 w-5 border-2" /></div>
            ) : filteredAccounts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No accounts found</div>
            ) : (
              filteredAccounts.map(account => (
                <button
                  key={account.id}
                  onClick={() => setSelectedAccountId(account.id)}
                  className={`w-full flex items-start gap-3 p-3 rounded-md text-left transition-colors ${
                    selectedAccountId === account.id
                      ? "bg-primary/20 border border-primary/30 shadow-sm"
                      : "hover:bg-primary/5 border border-transparent"
                  }`}
                >
                  <Avatar className="h-8 w-8 rounded bg-primary/10 border border-primary/20 shrink-0 mt-0.5">
                    <AvatarFallback className="text-primary text-xs font-medium font-display rounded">{account.name.substring(0,2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate text-foreground">{account.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{account.website || "No website"}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col bg-background/50 overflow-hidden relative">
          {selectedAccountId ? (
            <Workspace accountId={selectedAccountId} orgId={selectedOrgId!} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="h-16 w-16 rounded-full bg-primary/5 flex items-center justify-center mb-4 border border-primary/10 shadow-glow">
                <MessageSquare className="h-8 w-8 text-primary/40" />
              </div>
              <h2 className="text-xl font-display font-semibold mb-2">Select an account</h2>
              <p className="text-muted-foreground max-w-sm">Choose an account from the sidebar to view its unified communications, emails, calendar events, and calls.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Workspace({ accountId, orgId }: { accountId: string, orgId: string }) {
  const { data: emails, error: emailsError } = useListEmailThreads(orgId, accountId, {
    query: { enabled: !!orgId && !!accountId, queryKey: getListEmailThreadsQueryKey(orgId, accountId) }
  });

  const { data: calendarEvents, error: calendarError } = useListCalendarEvents(orgId, accountId, {
    query: { enabled: !!orgId && !!accountId, queryKey: getListCalendarEventsQueryKey(orgId, accountId) }
  });

  const { data: calls, error: callsError } = useListCallRecordings(orgId, accountId, {
    query: { enabled: !!orgId && !!accountId, queryKey: getListCallRecordingsQueryKey(orgId, accountId) }
  });

  return (
    <Tabs defaultValue="emails" className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-primary/10 bg-card/80 shrink-0">
        <TabsList className="bg-background/50 border border-primary/20">
          <TabsTrigger value="emails" className="gap-2 data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-display"><Mail className="h-4 w-4" /> Emails</TabsTrigger>
          <TabsTrigger value="calendar" className="gap-2 data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-display"><Calendar className="h-4 w-4" /> Calendar</TabsTrigger>
          <TabsTrigger value="calls" className="gap-2 data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-display"><Phone className="h-4 w-4" /> Calls</TabsTrigger>
          <TabsTrigger value="compose" className="gap-2 data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-display"><Send className="h-4 w-4" /> Send Email</TabsTrigger>
        </TabsList>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <TabsContent value="emails" className="mt-0 space-y-4 h-full outline-none">
          {emailsError ? (
            <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
              <h4 className="font-semibold mb-1">Failed to load emails</h4>
              <p className="text-sm opacity-90">{(emailsError as any)?.message || "Configuration error."}</p>
            </div>
          ) : (!emails || emails.length === 0) ? (
             <div className="text-center p-12 text-muted-foreground border border-dashed border-primary/20 rounded-xl bg-card/30">No email threads found for this account.</div>
          ) : (
            emails.map(thread => (
              <Card key={thread.id} className="border-primary/10 bg-card/80 hover:border-primary/30 transition-all shadow-sm">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-medium text-foreground">{thread.subject || "(No Subject)"}</div>
                    <div className="text-xs text-muted-foreground bg-primary/5 px-2 py-0.5 rounded capitalize border border-primary/10">{thread.provider}</div>
                  </div>
                  <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
                    <UserCircle className="h-3 w-3" /> {thread.participants.join(", ")}
                  </div>
                  {thread.snippet && (
                    <p className="text-sm text-muted-foreground/80 line-clamp-2">{thread.snippet}</p>
                  )}
                  {(thread.summary || thread.sentiment) && (
                    <div className="mt-4 pt-3 border-t border-primary/5 flex items-center gap-4 flex-wrap">
                      {thread.sentiment && (
                        <div className="text-xs font-medium px-2 py-1 rounded bg-background border border-primary/10">Sentiment: <span className="text-primary">{thread.sentiment}</span></div>
                      )}
                      {thread.keywords && thread.keywords.length > 0 && (
                        <div className="text-xs text-muted-foreground flex gap-1 items-center">
                          {thread.keywords.map((k: string) => <span key={k} className="bg-primary/5 px-1.5 py-0.5 rounded">{k}</span>)}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-0 space-y-4 outline-none">
          {calendarError ? (
            <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
              <h4 className="font-semibold mb-1">Failed to load calendar events</h4>
              <p className="text-sm opacity-90">{(calendarError as any)?.message || "Configuration error."}</p>
            </div>
          ) : (!calendarEvents || calendarEvents.length === 0) ? (
             <div className="text-center p-12 text-muted-foreground border border-dashed border-primary/20 rounded-xl bg-card/30">No calendar events found.</div>
          ) : (
            calendarEvents.map(ev => (
              <Card key={ev.id} className="border-primary/10 bg-card/80 hover:border-primary/30 transition-all shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded bg-primary/10 border border-primary/20 flex flex-col items-center justify-center shrink-0">
                      <div className="text-xs font-bold text-primary/70 uppercase">{new Date(ev.startsAt).toLocaleString('default', { month: 'short' })}</div>
                      <div className="text-xl font-display font-bold text-primary">{new Date(ev.startsAt).getDate()}</div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-foreground">{ev.title}</h4>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 mb-2 font-mono">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(ev.startsAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        {ev.location && <span>• {ev.location}</span>}
                      </div>
                      <div className="text-sm text-muted-foreground/80 line-clamp-2">{ev.description || "No description provided."}</div>
                      {ev.meetingUrl && (
                        <a href={ev.meetingUrl} target="_blank" rel="noreferrer" className="inline-block mt-3 text-xs font-medium text-primary hover:underline bg-primary/10 px-2 py-1 rounded">
                          Join Meeting
                        </a>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="calls" className="mt-0 space-y-4 outline-none">
           {callsError ? (
            <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
              <h4 className="font-semibold mb-1">Provider Configuration Error</h4>
              <p className="text-sm opacity-90">{(callsError as any)?.message || "Calls provider is unconfigured or failed."}</p>
            </div>
          ) : (!calls || calls.length === 0) ? (
             <div className="text-center p-12 text-muted-foreground border border-dashed border-primary/20 rounded-xl bg-card/30">No call recordings found.</div>
          ) : (
            calls.map(call => (
              <Card key={call.id} className="border-primary/10 bg-card/80 hover:border-primary/30 transition-all shadow-sm">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-semibold font-mono">{call.toNumber}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5 capitalize bg-primary/10 border border-primary/20 px-2 py-0.5 rounded inline-block">Status: {call.status}</p>
                    </div>
                    {call.sentiment && (
                       <div className="text-xs font-medium px-2 py-1 rounded bg-background border border-primary/10">Sentiment: <span className="text-primary">{call.sentiment}</span></div>
                    )}
                  </div>

                  {call.summary && (
                    <div className="mb-3 text-sm bg-background p-3 rounded border border-primary/10">
                      <strong className="text-xs uppercase text-primary tracking-wider mb-1 block">AI Summary</strong>
                      {call.summary}
                    </div>
                  )}

                  {call.transcript && (
                    <details className="text-sm group mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-primary hover:underline outline-none">View Transcript</summary>
                      <div className="mt-2 p-3 bg-muted/50 rounded text-muted-foreground whitespace-pre-wrap max-h-60 overflow-y-auto border border-border">
                        {call.transcript}
                      </div>
                    </details>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="compose" className="mt-0 outline-none h-full max-w-3xl">
          <ComposeEmail orgId={orgId} accountId={accountId} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

function ComposeEmail({ orgId, accountId }: { orgId: string, accountId: string }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const { toast } = useToast();

  const sendEmail = useSendCrmEmail();

  const handleSend = () => {
    if (!to || !subject || !body) return;

    sendEmail.mutate({
      orgId,
      data: {
        accountId,
        to,
        subject,
        html: body
      }
    }, {
      onSuccess: () => {
        toast({ title: "Email Sent Successfully" });
        setTo("");
        setSubject("");
        setBody("");
      },
      onError: (err: any) => {
        toast({ title: "Failed to send email", description: err.message || "Unknown error", variant: "destructive" });
      }
    });
  };

  return (
    <Card className="border-primary/20 shadow-md bg-card/80">
      <CardHeader className="pb-4 border-b border-primary/10">
        <CardTitle className="text-lg font-display">New Message</CardTitle>
        <CardDescription>Send an email via CRM directly to the customer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid grid-cols-[80px_1fr] items-center gap-2 text-sm">
          <label className="text-muted-foreground text-right font-medium">To:</label>
          <Input value={to} onChange={e => setTo(e.target.value)} placeholder="customer@example.com" className="h-9 bg-background/50 border-primary/20" />
        </div>
        <div className="grid grid-cols-[80px_1fr] items-center gap-2 text-sm">
          <label className="text-muted-foreground text-right font-medium">Subject:</label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Following up on our call..." className="h-9 bg-background/50 border-primary/20" />
        </div>
        <div className="grid grid-cols-[80px_1fr] items-start gap-2 text-sm">
          <label className="text-muted-foreground text-right font-medium pt-2">Message:</label>
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Type your message here..."
            className="min-h-[250px] bg-background/50 border-primary/20 resize-y"
          />
        </div>
        <div className="flex justify-end pt-2">
          <Button
            className="font-display shadow-glow"
            onClick={handleSend}
            disabled={!to || !subject || !body || sendEmail.isPending}
          >
            {sendEmail.isPending ? "Sending..." : <><Send className="w-4 h-4 mr-2" /> Send Message</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}