import { useState } from "react";
import {
  useGetAccountTimeline, getGetAccountTimelineQueryKey,
  useCreateActivity,
  useListContacts, getListContactsQueryKey,
  useListInternalNotes, getListInternalNotesQueryKey,
  useCreateInternalNote
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, Phone, Mail, FileText, Send, Lock, Globe, AtSign } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useListMembers, getListMembersQueryKey } from "@workspace/api-client-react";

export function TimelineTab({ accountId, orgId }: { accountId: string, orgId: string }) {
  const queryClient = useQueryClient();
  const { data: timeline, isLoading } = useGetAccountTimeline(orgId, accountId, { query: { enabled: !!orgId, queryKey: getGetAccountTimelineQueryKey(orgId, accountId) }});
  const { data: contacts } = useListContacts(orgId, accountId, { query: { enabled: !!orgId, queryKey: getListContactsQueryKey(orgId, accountId) }});

  const createActivity = useCreateActivity();

  const [type, setType] = useState<"note"|"call"|"email">("note");
  const [direction, setDirection] = useState<"inbound"|"outbound">("outbound");
  const [contactId, setContactId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const handleSubmit = () => {
    if (!body.trim()) return;

    createActivity.mutate({
      orgId, accountId, data: {
        type,
        direction: type !== "note" ? direction : undefined,
        contactId: contactId || undefined,
        subject: subject || undefined,
        body
      }
    }, {
      onSuccess: () => {
        setBody("");
        setSubject("");
        toast({ title: "Activity logged" });
        queryClient.invalidateQueries({ queryKey: getGetAccountTimelineQueryKey(orgId, accountId) });
      }
    });
  };

  const getActivityIcon = (t: string) => {
    switch(t) {
      case 'note': return <MessageSquare className="h-4 w-4 text-blue-400" />;
      case 'call': return <Phone className="h-4 w-4 text-green-400" />;
      case 'email': return <Mail className="h-4 w-4 text-purple-400" />;
      case 'file': return <FileText className="h-4 w-4 text-orange-400" />;
      default: return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <h3 className="text-lg font-display font-semibold text-primary">Activity Timeline</h3>

        <div className="space-y-4">
          {isLoading ? (
            <div className="spinner mx-auto" />
          ) : timeline?.length === 0 ? (
            <div className="text-center p-12 bg-card/50 rounded-xl border border-primary/10">
              <p className="text-muted-foreground">No activity yet. Log the first interaction above.</p>
            </div>
          ) : (
            timeline?.map(activity => (
              <div key={activity.id} className="relative pl-8 pb-4">
                <div className="absolute left-0 top-1 h-8 w-8 rounded-full bg-card border border-primary/20 flex items-center justify-center shadow-sm z-10">
                  {getActivityIcon(activity.type)}
                </div>
                {/* Timeline line */}
                <div className="absolute left-4 top-9 bottom-0 w-px bg-primary/10 -ml-px z-0"></div>

                <Card className="border-primary/10 bg-card/80 hover:border-primary/30 transition-colors shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex gap-2 items-center">
                        <span className="font-semibold text-sm capitalize text-foreground">{activity.type}</span>
                        {activity.direction && (
                          <span className="text-xs bg-muted px-2 py-0.5 rounded-full capitalize">{activity.direction}</span>
                        )}
                        {activity.contactId && contacts?.find(c => c.id === activity.contactId) && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            with <span className="font-medium text-foreground">{contacts.find(c => c.id === activity.contactId)?.firstName} {contacts.find(c => c.id === activity.contactId)?.lastName}</span>
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {formatDate(activity.createdAt)} by {activity.createdByName}
                      </div>
                    </div>
                    {activity.subject && <div className="font-medium text-sm mb-1">{activity.subject}</div>}
                    {activity.body && <div className="text-sm text-muted-foreground whitespace-pre-wrap">{activity.body}</div>}

                    {activity.attachments && activity.attachments.length > 0 && (
                      <div className="mt-3 flex gap-2 flex-wrap">
                        {activity.attachments.map(att => (
                          <a key={att.objectPath} href={`/api/storage${att.objectPath}`} target="_blank" rel="noreferrer" className="text-xs flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 transition-colors">
                            <FileText className="h-3 w-3" /> {att.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="lg:col-span-1 flex flex-col gap-6 sticky top-24 h-fit max-h-[calc(100vh-6rem)] overflow-y-auto pr-2 pb-12">
        <Card className="border-primary/20 shadow-glow bg-card shrink-0">
          <CardHeader className="pb-3 border-b border-primary/10 bg-primary/5">
            <CardTitle className="text-sm font-display flex items-center gap-2">
              Log Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="flex gap-2">
              <Button variant={type === "note" ? "default" : "outline"} size="sm" className="flex-1 text-xs" onClick={() => setType("note")}>Note</Button>
              <Button variant={type === "call" ? "default" : "outline"} size="sm" className="flex-1 text-xs" onClick={() => setType("call")}>Call</Button>
              <Button variant={type === "email" ? "default" : "outline"} size="sm" className="flex-1 text-xs" onClick={() => setType("email")}>Email</Button>
            </div>

            {type !== "note" && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={direction} onValueChange={(v: "inbound"|"outbound") => setDirection(v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="inbound">Inbound</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={contactId} onValueChange={setContactId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Contact (opt)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {contacts?.map(c => <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {type === "email" && (
              <input
                type="text"
                placeholder="Subject"
                className="w-full text-sm bg-transparent border-b border-primary/20 pb-1 focus:outline-none focus:border-primary placeholder:text-muted-foreground"
                value={subject}
                onChange={e => setSubject(e.target.value)}
              />
            )}

            <Textarea
              placeholder={`Log a ${type}...`}
              className="min-h-[120px] bg-background/50 border-primary/20 text-sm resize-none"
              value={body}
              onChange={e => setBody(e.target.value)}
            />

            <Button className="w-full font-display gap-2" disabled={createActivity.isPending || !body.trim()} onClick={handleSubmit}>
              <Send className="h-4 w-4" /> Save {type}
            </Button>
          </CardContent>
        </Card>

        {/* Internal Notes Feed */}
        <InternalNotesFeed orgId={orgId} accountId={accountId} />
      </div>
    </div>
  );
}

function InternalNotesFeed({ orgId, accountId }: { orgId: string, accountId: string }) {
  const queryClient = useQueryClient();
  const { data: notes, isLoading } = useListInternalNotes(orgId, accountId, {
    query: { enabled: !!orgId, queryKey: getListInternalNotesQueryKey(orgId, accountId) }
  });

  const { data: members } = useListMembers(orgId, {
    query: { enabled: !!orgId, queryKey: getListMembersQueryKey(orgId) }
  });

  const getMemberName = (userId: string) => {
    if (!members) return "Team Member";
    const member = members.find(m => m.user.id === userId);
    return member?.user.fullName || member?.user.email || "Team Member";
  };

  const getMemberInitials = (userId: string) => {
    const name = getMemberName(userId);
    return name.substring(0, 2).toUpperCase();
  };

  const createNote = useCreateInternalNote();
  const [newNote, setNewNote] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  const handlePostNote = () => {
    if (!newNote.trim()) return;

    // Simple parsing to find mentioned user IDs (assuming exact match on first name for demo)
    const mentionedUserIds: string[] = [];
    if (members) {
      members.forEach(m => {
        const firstName = m.user.fullName?.split(' ')[0] || '';
        if (firstName && newNote.includes(`@${firstName}`)) {
          mentionedUserIds.push(m.user.id);
        }
      });
    }

    createNote.mutate({
      orgId, accountId, data: {
        body: newNote,
        isPrivate,
        mentionedUserIds
      }
    }, {
      onSuccess: () => {
        setNewNote("");
        queryClient.invalidateQueries({ queryKey: getListInternalNotesQueryKey(orgId, accountId) });
      }
    });
  };

  return (
    <Card className="border-primary/20 shadow-sm bg-card shrink-0 flex flex-col max-h-[500px]">
      <CardHeader className="pb-3 border-b border-primary/10 bg-primary/5">
        <CardTitle className="text-sm font-display flex items-center justify-between">
          <span className="flex items-center gap-2"><AtSign className="h-4 w-4 text-primary" /> Internal Notes</span>
          <span className="text-xs text-muted-foreground font-normal">Team collaboration</span>
        </CardTitle>
      </CardHeader>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background/30">
        {isLoading ? (
          <div className="flex justify-center py-4"><div className="spinner h-4 w-4" /></div>
        ) : notes?.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-4">No internal notes yet. Use @ to mention team members.</div>
        ) : (
          notes?.map(note => (
            <div key={note.id} className="bg-background border border-primary/10 rounded-md p-3 text-sm shadow-sm relative group">
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2">
                  <Avatar className="h-5 w-5 bg-primary/10 border border-primary/20">
                    <AvatarFallback className="text-[10px] text-primary">{getMemberInitials(note.authorUserId)}</AvatarFallback>
                  </Avatar>
                  <span className="font-semibold text-xs text-foreground">{getMemberName(note.authorUserId)}</span>
                  {note.isPrivate ? <Lock className="h-3 w-3 text-amber-500" /> : <Globe className="h-3 w-3 text-muted-foreground" />}
                </div>
                <span className="text-[10px] text-muted-foreground font-mono">{formatDate(note.createdAt)}</span>
              </div>
              <p className="text-muted-foreground whitespace-pre-wrap pl-7">{note.body}</p>
            </div>
          ))
        )}
      </div>

      <CardFooter className="p-3 border-t border-primary/10 bg-card/80 flex flex-col gap-2">
        <Textarea
          placeholder="Write a note... Use @ to mention"
          className="min-h-[60px] text-sm resize-none border-primary/20 bg-background/50 focus-visible:ring-1 focus-visible:ring-primary"
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
        />
        <div className="flex items-center justify-between w-full">
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 text-xs px-2 ${isPrivate ? 'text-amber-500 bg-amber-500/10' : 'text-muted-foreground'}`}
            onClick={() => setIsPrivate(!isPrivate)}
          >
            {isPrivate ? <><Lock className="h-3 w-3 mr-1" /> Private</> : <><Globe className="h-3 w-3 mr-1" /> Public</>}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs font-display"
            disabled={!newNote.trim() || createNote.isPending}
            onClick={handlePostNote}
          >
            Post Note
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
