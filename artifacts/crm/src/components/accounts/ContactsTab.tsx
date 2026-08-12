import { useState } from "react";
import { useListContacts, getListContactsQueryKey, useCreateContact, useUpdateContact, useDeleteContact, Contact } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, User, Trash2, Edit2, Network, List, CornerDownRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const contactSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  reportsToContactId: z.string().optional().nullable(),
});

const NO_MANAGER = "__none__";

function OrgChartNode({
  contact,
  childrenMap,
  depth,
}: {
  contact: Contact;
  childrenMap: Map<string | null, Contact[]>;
  depth: number;
}) {
  const reports = childrenMap.get(contact.id) ?? [];
  return (
    <div className={depth > 0 ? "ml-6 border-l border-primary/15 pl-4" : ""}>
      <div className="flex items-center gap-3 py-2">
        {depth > 0 && <CornerDownRight className="h-4 w-4 text-primary/40 shrink-0" />}
        <Avatar className="h-9 w-9 border border-primary/20">
          <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
            {contact.firstName[0]}
            {contact.lastName[0]}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="font-medium text-foreground text-sm">
            {contact.firstName} {contact.lastName}
          </div>
          <div className="text-xs text-muted-foreground">
            {contact.title || "—"}
            {reports.length > 0 && (
              <span className="ml-2 font-mono text-primary/70">
                {reports.length} report{reports.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      </div>
      {reports.map((r) => (
        <OrgChartNode key={r.id} contact={r} childrenMap={childrenMap} depth={depth + 1} />
      ))}
    </div>
  );
}

function OrgChart({ contacts }: { contacts: Contact[] }) {
  const ids = new Set(contacts.map((c) => c.id));
  const childrenMap = new Map<string | null, Contact[]>();
  for (const c of contacts) {
    // Treat contacts whose manager is missing/inactive as roots.
    const parent = c.reportsToContactId && ids.has(c.reportsToContactId) ? c.reportsToContactId : null;
    const list = childrenMap.get(parent) ?? [];
    list.push(c);
    childrenMap.set(parent, list);
  }
  const roots = childrenMap.get(null) ?? [];
  if (contacts.length === 0) {
    return (
      <div className="text-center p-12 text-muted-foreground">
        <Network className="h-10 w-10 mx-auto mb-4 opacity-20" />
        No contacts yet. Add people to see the reporting structure.
      </div>
    );
  }
  return (
    <div className="p-4">
      {roots.map((c) => (
        <OrgChartNode key={c.id} contact={c} childrenMap={childrenMap} depth={0} />
      ))}
    </div>
  );
}

export function ContactsTab({ accountId, orgId }: { accountId: string, orgId: string }) {
  const queryClient = useQueryClient();
  const { data: contacts, isLoading } = useListContacts(orgId, accountId, { query: { enabled: !!orgId, queryKey: getListContactsQueryKey(orgId, accountId) }});
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "chart">("list");

  const form = useForm<z.infer<typeof contactSchema>>({
    resolver: zodResolver(contactSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", title: "", department: "", reportsToContactId: NO_MANAGER }
  });

  const handleOpenCreate = () => {
    setEditingId(null);
    form.reset({ firstName: "", lastName: "", email: "", phone: "", title: "", department: "", reportsToContactId: NO_MANAGER });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (contact: Contact) => {
    setEditingId(contact.id);
    form.reset({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email || "",
      phone: contact.phone || "",
      title: contact.title || "",
      department: contact.department || "",
      reportsToContactId: contact.reportsToContactId || NO_MANAGER
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (data: z.infer<typeof contactSchema>) => {
    const payload = {
      ...data,
      email: data.email || null,
      reportsToContactId:
        !data.reportsToContactId || data.reportsToContactId === NO_MANAGER
          ? null
          : data.reportsToContactId,
    };
    if (editingId) {
      updateContact.mutate({ orgId, contactId: editingId, data: payload }, {
        onSuccess: () => {
          toast({ title: "Contact updated" });
          setIsDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListContactsQueryKey(orgId, accountId) });
        }
      });
    } else {
      createContact.mutate({ orgId, accountId, data: payload }, {
        onSuccess: () => {
          toast({ title: "Contact created" });
          setIsDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListContactsQueryKey(orgId, accountId) });
        }
      });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this contact?")) {
      deleteContact.mutate({ orgId, contactId: id }, {
        onSuccess: () => {
          toast({ title: "Contact deleted" });
          queryClient.invalidateQueries({ queryKey: getListContactsQueryKey(orgId, accountId) });
        }
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-display font-semibold text-primary">Contacts</h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-primary/15 overflow-hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView("list")}
              className={`rounded-none gap-2 ${view === "list" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
            >
              <List className="h-4 w-4" /> List
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView("chart")}
              className={`rounded-none gap-2 ${view === "chart" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
            >
              <Network className="h-4 w-4" /> Org chart
            </Button>
          </div>
          <Button size="sm" onClick={handleOpenCreate} className="font-display gap-2">
            <Plus className="h-4 w-4" /> Add Contact
          </Button>
        </div>
      </div>

      <Card className="border-primary/10 bg-card/80 shadow-md">
        <CardContent className="p-0">
          {view === "chart" ? (
            <OrgChart contacts={contacts ?? []} />
          ) : (
          <Table>
            <TableHeader className="bg-background/50">
              <TableRow className="border-primary/10">
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Contact Info</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center p-8"><div className="spinner mx-auto" /></TableCell></TableRow>
              ) : contacts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center p-12 text-muted-foreground">
                    <User className="h-10 w-10 mx-auto mb-4 opacity-20" />
                    No contacts yet. Add people associated with this account.
                  </TableCell>
                </TableRow>
              ) : (
                contacts?.map(contact => (
                  <TableRow key={contact.id} className="border-primary/5 hover:bg-primary/5 group">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border border-primary/20">
                          <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                            {contact.firstName[0]}{contact.lastName[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium text-foreground">{contact.firstName} {contact.lastName}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{contact.title || "—"}</div>
                      <div className="text-xs text-muted-foreground">{contact.department}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-foreground">{contact.email || "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{contact.phone}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(contact)} className="h-8 w-8 text-muted-foreground hover:text-primary">
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(contact.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px] border-primary/20 shadow-glow">
          <DialogHeader>
            <DialogTitle className="font-display">{editingId ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="firstName" render={({ field }) => (
                  <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem><FormLabel>Job Title</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="department" render={({ field }) => (
                  <FormItem><FormLabel>Department</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="reportsToContactId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reports to</FormLabel>
                  <Select value={field.value || NO_MANAGER} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="No manager" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_MANAGER}>No manager</SelectItem>
                      {(contacts ?? [])
                        .filter((c) => c.id !== editingId)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.firstName} {c.lastName}
                            {c.title ? ` — ${c.title}` : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="submit" disabled={createContact.isPending || updateContact.isPending} className="font-display">
                  {editingId ? "Save Changes" : "Create Contact"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}