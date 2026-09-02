import { useEffect, useState } from "react";
import {
  useGetOrg, useUpdateOrg, getGetOrgQueryKey,
  useListMembers, useInviteMember, useUpdateMemberRole, useRemoveMember, getListMembersQueryKey,
  useListApiTokens, useCreateApiToken, getListApiTokensQueryKey,
  useGetOrgSecurityPolicy, useUpdateOrgSecurityPolicy, getGetOrgSecurityPolicyQueryKey,
  useListWebhooks, useCreateWebhook, useDeleteWebhook, getListWebhooksQueryKey, useRevokeApiToken, useTestWebhookDelivery,
  useListAuditEvents, getListAuditEventsQueryKey,
  useListIndustryTemplates, useApplyIndustryTemplate, getListIndustryTemplatesQueryKey,
  useListWebhookDeliveries
} from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getInitials, formatDate } from "@/lib/format";
import { Building2, Users, Save, Trash2, Mail, ShieldCheck, Key, Webhook, ActivitySquare, LayoutTemplate, Plus, Copy, CheckCircle2, Settings as SettingsIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { ProviderSettings } from "@/components/settings/ProviderSettings";
import { format, formatDistanceToNow } from "date-fns";


const templateMeta: Record<string, { name: string; description: string; category: string }> = {
  "k12": { name: "K-12 Education", description: "Manage school district procurement, curriculum adoption, and grant funding cycles.", category: "Education" },
  "construction": { name: "Construction & Bidding", description: "Track commercial projects, GC relationships, and complex bidding stages.", category: "Construction" },
  "healthcare": { name: "Healthcare & Life Sciences", description: "Navigate hospital networks, compliance reviews, and medical device pilots.", category: "Healthcare" }
};

export default function Settings() {
  const { selectedOrgId } = useOrgStore();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: org, isLoading: orgLoading } = useGetOrg(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getGetOrgQueryKey(selectedOrgId || "") }
  });

  const { data: members, isLoading: membersLoading } = useListMembers(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getListMembersQueryKey(selectedOrgId || "") }
  });

  const { data: tokens } = useListApiTokens(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getListApiTokensQueryKey(selectedOrgId || "") }
  });

  const { data: security } = useGetOrgSecurityPolicy(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getGetOrgSecurityPolicyQueryKey(selectedOrgId || "") }
  });

  const { data: webhooks } = useListWebhooks(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getListWebhooksQueryKey(selectedOrgId || "") }
  });

  const { data: auditEvents } = useListAuditEvents(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getListAuditEventsQueryKey(selectedOrgId || "") }
  });

  const { data: templates } = useListIndustryTemplates(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getListIndustryTemplatesQueryKey(selectedOrgId || "") }
  });

  const updateOrg = useUpdateOrg();
  const inviteMember = useInviteMember();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();

  const createToken = useCreateApiToken();
  const updateSecurity = useUpdateOrgSecurityPolicy();
  const createWebhook = useCreateWebhook();
  const revokeToken = useRevokeApiToken();
  const testWebhook = useTestWebhookDelivery();
  const deleteWebhook = useDeleteWebhook();
  const applyTemplate = useApplyIndustryTemplate();

  const [orgName, setOrgName] = useState("");
  const [isInit, setIsInit] = useState(false);

  // Modals
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "manager" | "user">("user");

  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenOpen, setNewTokenOpen] = useState(false);
  const [createdTokenStr, setCreatedTokenStr] = useState<string | null>(null);

  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string | null>(null);
  const [newWebhookOpen, setNewWebhookOpen] = useState(false);
  const [ipAllowlist, setIpAllowlist] = useState("");

  useEffect(() => {
    setIpAllowlist((security?.allowedCidrs ?? []).join(", "));
  }, [security?.allowedCidrs]);

  if (org && !isInit) {
    setOrgName(org.name);
    setIsInit(true);
  }

  const handleSaveOrg = () => {
    if (!orgName.trim() || orgName === org?.name) return;
    updateOrg.mutate({ orgId: selectedOrgId!, data: { name: orgName } }, {
      onSuccess: () => {
        toast({ title: "Organization updated" });
        queryClient.invalidateQueries({ queryKey: getGetOrgQueryKey(selectedOrgId!) });
      }
    });
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    inviteMember.mutate({ orgId: selectedOrgId!, data: { email: inviteEmail, role: inviteRole } }, {
      onSuccess: () => {
        toast({ title: "Invitation sent", description: `Invited ${inviteEmail} as ${inviteRole}` });
        setInviteOpen(false); setInviteEmail("");
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(selectedOrgId!) });
      }
    });
  };

  const handleRoleChange = (memberId: string, role: string) => {
    updateRole.mutate({ orgId: selectedOrgId!, memberId, data: { role: role as "owner" | "admin" | "manager" | "user" } }, {
      onSuccess: () => {
        toast({ title: "Role updated" });
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(selectedOrgId!) });
      }
    });
  };

  const handleRemove = (memberId: string) => {
    if (!confirm("Are you sure you want to remove this member?")) return;
    removeMember.mutate({ orgId: selectedOrgId!, memberId }, {
      onSuccess: () => {
        toast({ title: "Member removed" });
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(selectedOrgId!) });
      }
    });
  };

  const handleCreateToken = (e: React.FormEvent) => {
    e.preventDefault();
    createToken.mutate({
      orgId: selectedOrgId!,
      data: { name: newTokenName, permissions: ["leads:write"] }
    }, {
      onSuccess: (data) => {
        setCreatedTokenStr(data.token);
        queryClient.invalidateQueries({ queryKey: getListApiTokensQueryKey(selectedOrgId!) });
      },
      onError: () => toast({ title: "Failed to create token", variant: "destructive" })
    });
  };

  const handleCreateWebhook = (e: React.FormEvent) => {
    e.preventDefault();
    createWebhook.mutate({
      orgId: selectedOrgId!,
      data: { name: "Webhook Endpoint", url: newWebhookUrl, events: ["lead.created"] }
    }, {
      onSuccess: (data) => {
        toast({ title: "Webhook created" });
        setCreatedWebhookSecret(data.secret);
        queryClient.invalidateQueries({ queryKey: getListWebhooksQueryKey(selectedOrgId!) });
      },
      onError: () => toast({ title: "Failed to create webhook", variant: "destructive" })
    });
  };

  const handleSecurityToggle = (key: 'mfaRequired' | 'ssoRequired', value: boolean) => {
    updateSecurity.mutate({
      orgId: selectedOrgId!,
      data: { [key]: value }
    }, {
      onSuccess: () => {
        toast({ title: "Security policy updated" });
        queryClient.invalidateQueries({ queryKey: getGetOrgSecurityPolicyQueryKey(selectedOrgId!) });
      },
      onError: () => toast({ title: "Failed to update security policy", variant: "destructive" })
    });
  };

  const handleApplyTemplate = (templateKey: 'k12' | 'construction' | 'healthcare') => {
    applyTemplate.mutate({ orgId: selectedOrgId!, templateKey }, {
      onSuccess: () => toast({ title: "Template applied", description: "Your workspace has been configured." }),
      onError: () => toast({ title: "Failed to apply template", variant: "destructive" })
    });
  };

  if (orgLoading || membersLoading) {
    return <div className="p-8"><div className="skeleton h-96 rounded-xl"></div></div>;
  }



  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between bg-background/50 backdrop-blur-sm shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display mb-1 flex items-center gap-3">
            <SettingsIcon className="h-8 w-8 text-primary" /> Settings
          </h1>
          <p className="text-sm text-muted-foreground">Manage your workspace, security, and integrations.</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <Tabs defaultValue="general" className="max-w-5xl mx-auto flex flex-col md:flex-row gap-8">
          <TabsList className="flex md:flex-col h-auto bg-transparent items-start justify-start w-full md:w-56 gap-2 border-b md:border-b-0 border-border/50 pb-4 md:pb-0 overflow-x-auto">
            <TabsTrigger value="general" className="w-full justify-start text-left data-[state=active]:bg-card data-[state=active]:border-primary/50 border border-transparent shadow-none"><Building2 className="w-4 h-4 mr-2"/> General</TabsTrigger>
            <TabsTrigger value="team" className="w-full justify-start text-left data-[state=active]:bg-card data-[state=active]:border-primary/50 border border-transparent shadow-none"><Users className="w-4 h-4 mr-2"/> Team Members</TabsTrigger>
            <TabsTrigger value="security" className="w-full justify-start text-left data-[state=active]:bg-card data-[state=active]:border-primary/50 border border-transparent shadow-none"><ShieldCheck className="w-4 h-4 mr-2"/> Security & SSO</TabsTrigger>
            <TabsTrigger value="api" className="w-full justify-start text-left data-[state=active]:bg-card data-[state=active]:border-primary/50 border border-transparent shadow-none"><Webhook className="w-4 h-4 mr-2"/> API & Webhooks</TabsTrigger>
            <TabsTrigger value="audit" className="w-full justify-start text-left data-[state=active]:bg-card data-[state=active]:border-primary/50 border border-transparent shadow-none"><ActivitySquare className="w-4 h-4 mr-2"/> Audit Logs</TabsTrigger>
            <TabsTrigger value="templates" className="w-full justify-start text-left data-[state=active]:bg-card data-[state=active]:border-primary/50 border border-transparent shadow-none"><LayoutTemplate className="w-4 h-4 mr-2"/> Industry Templates</TabsTrigger>
            <TabsTrigger value="providers" className="w-full justify-start text-left data-[state=active]:bg-card data-[state=active]:border-primary/50 border border-transparent shadow-none"><Key className="w-4 h-4 mr-2"/> Ext. Providers</TabsTrigger>
          </TabsList>

          <div className="flex-1 min-w-0">
            {/* General Tab */}
            <TabsContent value="general" className="space-y-8 m-0 mt-0">
              <Card>
                <CardHeader>
                  <CardTitle className="font-display">Organization Profile</CardTitle>
                  <CardDescription>Update your workspace's name and identity.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 max-w-md">
                    <Label htmlFor="orgName">Organization Name</Label>
                    <div className="flex gap-2">
                      <Input id="orgName" value={orgName} onChange={e => setOrgName(e.target.value)} className="bg-background" />
                      <Button className="font-display" onClick={handleSaveOrg} disabled={orgName === org?.name || updateOrg.isPending}>
                        <Save className="h-4 w-4 mr-2" /> Save
                      </Button>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-border/50">
                    <Label className="text-muted-foreground">Workspace ID</Label>
                    <div className="font-mono text-xs mt-1 bg-muted/50 p-2 rounded max-w-md border border-border/50 select-all">{org?.id}</div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Team Tab */}
            <TabsContent value="team" className="space-y-8 m-0 mt-0">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="font-display">Team Access</CardTitle>
                    <CardDescription>Manage who has access to your workspace.</CardDescription>
                  </div>
                  <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                    <DialogTrigger asChild>
                      <Button className="font-display shadow-[0_0_12px_rgba(0,180,216,0.3)]"><Plus className="w-4 h-4 mr-2"/> Invite Member</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Invite a new team member</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleInvite} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label>Email address</Label>
                          <Input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@company.com" className="bg-background" />
                        </div>
                        <div className="space-y-2">
                          <Label>Role</Label>
                          <Select value={inviteRole} onValueChange={(val: any) => setInviteRole(val)}>
                            <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="manager">Manager</SelectItem>
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex justify-end pt-4">
                          <Button type="submit" disabled={inviteMember.isPending} className="font-display">
                            <Mail className="w-4 h-4 mr-2"/> Send Invite
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead>Member</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Joined</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members?.map((member) => (
                        <TableRow key={member.id} className="border-border/50">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="bg-primary/10 text-primary font-medium text-xs">
                                  {getInitials(member.user.fullName, member.user.email)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col">
                                <span className="font-medium text-sm">{member.user.fullName || "User"}</span>
                                <span className="text-xs text-muted-foreground">{member.user.email}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {member.role === "owner" ? (
                              <Badge variant="secondary" className="capitalize">{member.role}</Badge>
                            ) : (
                              <Select value={member.role} onValueChange={(val) => handleRoleChange(member.id, val)} disabled={updateRole.isPending}>
                                <SelectTrigger className="w-[120px] h-8 text-xs font-medium bg-transparent">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">Admin</SelectItem>
                                  <SelectItem value="manager">Manager</SelectItem>
                                  <SelectItem value="user">User</SelectItem>
                                  <SelectItem value="viewer">Viewer</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatDate(member.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" onClick={() => handleRemove(member.id)} disabled={member.role === "owner" || removeMember.isPending} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Security & SSO Tab */}
            <TabsContent value="security" className="space-y-8 m-0 mt-0">
              <Card>
                <CardHeader>
                  <CardTitle className="font-display">Security Policy</CardTitle>
                  <CardDescription>Enforce security requirements for all workspace members.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between border border-border/50 p-4 rounded-lg bg-card/50">
                    <div className="space-y-0.5">
                      <Label className="text-base">Require Multi-Factor Authentication</Label>
                      <p className="text-sm text-muted-foreground">All members must configure MFA via Clerk to access this workspace.</p>
                      <Badge variant="outline" className="mt-2 font-mono text-[10px] uppercase">
                        Clerk status: {security?.clerkMfaStatus ?? "loading"}
                      </Badge>
                    </div>
                    <Switch checked={security?.mfaRequired ?? false} onCheckedChange={(v) => handleSecurityToggle('mfaRequired', v)} />
                  </div>

                  <div className="flex items-center justify-between border border-border/50 p-4 rounded-lg bg-card/50">
                    <div className="space-y-0.5">
                      <Label className="text-base">Enterprise SSO Only</Label>
                      <p className="text-sm text-muted-foreground">Disable email/password login and enforce SAML/OIDC connections.</p>
                      <Badge variant="outline" className="mt-2 font-mono text-[10px] uppercase">
                        Clerk status: {security?.clerkSsoStatus ?? "loading"}
                      </Badge>
                    </div>
                    <Switch checked={security?.ssoRequired ?? false} onCheckedChange={(v) => handleSecurityToggle('ssoRequired', v)} />
                  </div>

                  <div className="space-y-2 border border-border/50 p-4 rounded-lg bg-card/50">
                    <Label className="text-base">IP Allowlist</Label>
                    <p className="text-sm text-muted-foreground mb-4">Restrict workspace access to specific IP ranges (CIDR format).</p>
                    <Input
                      id="ipAllowlist"
                      placeholder="e.g. 192.168.1.0/24, 10.0.0.0/8"
                      className="font-mono text-sm bg-background"
                      value={ipAllowlist}
                      onChange={(event) => setIpAllowlist(event.target.value)}
                    />
                    <Button variant="secondary" className="mt-2 text-xs" onClick={() => {
                      const allowedCidrs = ipAllowlist.split(",").map((cidr) => cidr.trim()).filter(Boolean);
                      updateSecurity.mutate({ orgId: selectedOrgId!, data: { ipAllowlistEnabled: allowedCidrs.length > 0, allowedCidrs } }, {
                        onSuccess: () => toast({ title: "IP allowlist updated" })
                      });
                    }}>Save Allowlist</Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* API & Webhooks */}
            <TabsContent value="api" className="space-y-8 m-0 mt-0">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="font-display">API Tokens</CardTitle>
                    <CardDescription>Generate tokens for programmatic access to the REST API.</CardDescription>
                  </div>
                  <Dialog open={newTokenOpen} onOpenChange={setNewTokenOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="border-primary/20 hover:border-primary/50 hover:bg-primary/5"><Plus className="w-4 h-4 mr-2"/> New Token</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Create API Token</DialogTitle>
                        <DialogDescription>This token grants full access to your workspace data.</DialogDescription>
                      </DialogHeader>
                      {!createdTokenStr ? (
                        <form onSubmit={handleCreateToken} className="space-y-4 mt-4">
                          <div className="space-y-2">
                            <Label>Token Name</Label>
                            <Input required value={newTokenName} onChange={e => setNewTokenName(e.target.value)} placeholder="e.g. Zapier Integration" className="bg-background" />
                          </div>
                          <Button type="submit" className="w-full font-display">Generate Token</Button>
                        </form>
                      ) : (
                        <div className="space-y-4 mt-4">
                          <div className="p-4 bg-warning/10 border border-warning/20 rounded-md">
                            <p className="text-sm text-warning font-medium mb-2">Copy this token now. You won't be able to see it again.</p>
                            <div className="flex items-center gap-2">
                              <code className="flex-1 p-2 bg-background border border-border/50 rounded text-sm text-foreground select-all">{createdTokenStr}</code>
                              <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(createdTokenStr); toast({title: "Copied!"}); }}><Copy className="w-4 h-4" /></Button>
                            </div>
                          </div>
                          <Button className="w-full" onClick={() => { setNewTokenOpen(false); setCreatedTokenStr(null); setNewTokenName(""); }}>Done</Button>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead>Name</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Last Used</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(!tokens || tokens.length === 0) ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-6 text-sm">No API tokens generated.</TableCell>
                        </TableRow>
                      ) : tokens.map((token) => (
                        <TableRow key={token.id} className="border-border/50 hover:bg-card/50">
                          <TableCell className="font-medium text-sm">{token.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{formatDate(token.createdAt)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{token.lastUsedAt ? formatDistanceToNow(new Date(token.lastUsedAt), {addSuffix: true}) : 'Never'}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => revokeToken.mutate({orgId: selectedOrgId!, tokenId: token.id}, { onSuccess: () => { toast({title: "Token revoked"}); queryClient.invalidateQueries({ queryKey: getListApiTokensQueryKey(selectedOrgId!) }); } })}>Revoke</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="font-display">Webhooks</CardTitle>
                    <CardDescription>Receive real-time signed HTTP payloads for workspace events.</CardDescription>
                  </div>
                  <Dialog open={newWebhookOpen} onOpenChange={setNewWebhookOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="border-primary/20 hover:border-primary/50 hover:bg-primary/5"><Plus className="w-4 h-4 mr-2"/> Add Webhook</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Webhook Endpoint</DialogTitle>
                      </DialogHeader>
                      {!createdWebhookSecret ? (
                      <form onSubmit={handleCreateWebhook} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label>Endpoint URL</Label>
                          <Input required type="url" value={newWebhookUrl} onChange={e => setNewWebhookUrl(e.target.value)} placeholder="https://api.yourdomain.com/webhooks" className="bg-background" />
                        </div>
                        <Button type="submit" className="w-full font-display">Create Webhook</Button>
                      </form>
                    ) : (
                      <div className="space-y-4 mt-4">
                        <div className="p-4 bg-warning/10 border border-warning/20 rounded-md">
                          <p className="text-sm text-warning font-medium mb-2">Copy this webhook signing secret now. You won't be able to see it again.</p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 p-2 bg-background border border-border/50 rounded text-sm text-foreground select-all">{createdWebhookSecret}</code>
                            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(createdWebhookSecret); toast({title: "Copied!"}); }}><Copy className="w-4 h-4" /></Button>
                          </div>
                        </div>
                        <Button className="w-full" onClick={() => { setNewWebhookOpen(false); setCreatedWebhookSecret(null); setNewWebhookUrl(""); }}>Done</Button>
                      </div>
                    )}
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead>URL</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(!webhooks || webhooks.length === 0) ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-6 text-sm">No webhooks configured.</TableCell>
                        </TableRow>
                      ) : webhooks.map((wh) => (
                        <TableRow key={wh.id} className="border-border/50 hover:bg-card/50">
                          <TableCell className="font-mono text-xs">{wh.url}</TableCell>
                          <TableCell><Badge variant="outline" className="bg-success/10 text-success border-success/20 font-mono text-[10px] uppercase">Active</Badge></TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => testWebhook.mutate({orgId: selectedOrgId!, webhookId: wh.id}, { onSuccess: () => toast({title: "Test delivery successful"}), onError: () => toast({title: "Test delivery failed", variant: "destructive"}) })}>Test</Button>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => deleteWebhook.mutate({orgId: selectedOrgId!, webhookId: wh.id}, { onSuccess: () => { toast({title: "Webhook deleted"}); queryClient.invalidateQueries({ queryKey: getListWebhooksQueryKey(selectedOrgId!) }); } })}>Delete</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Audit Logs */}
            <TabsContent value="audit" className="space-y-8 m-0 mt-0">
              <Card>
                <CardHeader>
                  <CardTitle className="font-display">Compliance Audit Log</CardTitle>
                  <CardDescription>Immutable record of critical security and data access events.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Actor</TableHead>
                        <TableHead>IP Address</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(auditEvents || []).map((log) => (
                        <TableRow key={log.id} className="border-border/50 hover:bg-card/50">
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(new Date(log.createdAt), 'MMM d, yyyy HH:mm:ss')}</TableCell>
                          <TableCell className="font-mono text-xs text-foreground">{log.action}</TableCell>
                          <TableCell className="text-sm">{log.actorUserId || "System"}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{log.ipAddress}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
                <CardFooter className="pt-4 flex justify-between border-t border-border/50">
                  <p className="text-xs text-muted-foreground">Retained for 365 days under current plan.</p>
                  <Button variant="outline" size="sm" className="font-display">Export CSV</Button>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* Industry Templates */}
            <TabsContent value="templates" className="space-y-8 m-0 mt-0">
              <Card>
                <CardHeader>
                  <CardTitle className="font-display">Industry Templates</CardTitle>
                  <CardDescription>Pre-configured fields, stages, and workflows for specific verticals.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(templates || []).map((tpl) => (
                      <div key={tpl.key} className="border border-border/50 rounded-xl p-6 bg-card hover:border-primary/30 transition-colors relative overflow-hidden group">
                        <Badge className="absolute top-4 right-4 bg-primary/20 text-primary hover:bg-primary/20 hover:text-primary">{templateMeta[tpl.key]?.category}</Badge>
                        <h3 className="font-display font-bold text-lg mb-2">{templateMeta[tpl.key]?.name}</h3>
                        <p className="text-sm text-muted-foreground mb-6 line-clamp-2">{templateMeta[tpl.key]?.description}</p>
                        <Button
                          variant="outline"
                          className="w-full font-display border-primary/20 group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all"
                          onClick={() => handleApplyTemplate(tpl.key)}
                        >
                          Apply Template
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Providers Tab */}
            <TabsContent value="providers" className="space-y-8 m-0 mt-0">
              <ProviderSettings />
            </TabsContent>

          </div>
        </Tabs>
      </div>
    </div>
  );
}