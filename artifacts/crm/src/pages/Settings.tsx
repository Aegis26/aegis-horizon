import { useState } from "react";
import { 
  useGetOrg, 
  useUpdateOrg, 
  useListMembers, 
  useInviteMember, 
  useUpdateMemberRole, 
  useRemoveMember,
  getGetOrgQueryKey,
  getListMembersQueryKey
} from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getInitials, formatDate } from "@/lib/format";
import { Building2, Users, Save, Trash2, Mail } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

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

  const updateOrg = useUpdateOrg();
  const inviteMember = useInviteMember();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();

  const [orgName, setOrgName] = useState("");
  const [isInit, setIsInit] = useState(false);

  // Invite state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");

  if (org && !isInit) {
    setOrgName(org.name);
    setIsInit(true);
  }

  const handleSaveOrg = () => {
    if (!orgName.trim() || orgName === org?.name) return;
    updateOrg.mutate({
      orgId: selectedOrgId!,
      data: { name: orgName }
    }, {
      onSuccess: () => {
        toast({ title: "Organization updated" });
        queryClient.invalidateQueries({ queryKey: getGetOrgQueryKey(selectedOrgId!) });
      }
    });
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    
    inviteMember.mutate({
      orgId: selectedOrgId!,
      data: { email: inviteEmail, role: inviteRole as any }
    }, {
      onSuccess: () => {
        toast({ title: "Invitation sent", description: `Invited ${inviteEmail} as ${inviteRole}` });
        setInviteOpen(false);
        setInviteEmail("");
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(selectedOrgId!) });
      }
    });
  };

  const handleRoleChange = (memberId: string, role: string) => {
    updateRole.mutate({
      orgId: selectedOrgId!,
      memberId,
      data: { role: role as any }
    }, {
      onSuccess: () => {
        toast({ title: "Role updated" });
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(selectedOrgId!) });
      }
    });
  };

  const handleRemove = (memberId: string) => {
    if (!confirm("Are you sure you want to remove this member?")) return;
    removeMember.mutate({
      orgId: selectedOrgId!,
      memberId
    }, {
      onSuccess: () => {
        toast({ title: "Member removed" });
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(selectedOrgId!) });
      }
    });
  };

  if (orgLoading || membersLoading) {
    return <div className="animate-pulse h-96 bg-muted rounded-xl"></div>;
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Organization Settings</h1>
        <p className="text-muted-foreground mt-2">Manage your workspace preferences and team access.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            General Information
          </CardTitle>
          <CardDescription>Update your organization's name and details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 max-w-md">
            <Label htmlFor="orgName">Organization Name</Label>
            <div className="flex gap-2">
              <Input 
                id="orgName" 
                value={orgName} 
                onChange={e => setOrgName(e.target.value)} 
              />
              <Button 
                onClick={handleSaveOrg} 
                disabled={orgName === org?.name || updateOrg.isPending}
              >
                <Save className="h-4 w-4 mr-2" /> Save
              </Button>
            </div>
          </div>
          
          <div className="pt-4 border-t">
            <Label className="text-muted-foreground">Organization ID</Label>
            <div className="font-mono text-xs mt-1 bg-muted p-2 rounded max-w-md">{org?.id}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team Members
            </CardTitle>
            <CardDescription>Manage who has access to your organization.</CardDescription>
          </div>
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>Invite Member</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite a new team member</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleInvite} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Email address</Label>
                  <Input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@company.com" />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={inviteMember.isPending}>
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
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members?.map((member) => (
                <TableRow key={member.id}>
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
                      <Select 
                        value={member.role} 
                        onValueChange={(val) => handleRoleChange(member.id, val)}
                        disabled={updateRole.isPending}
                      >
                        <SelectTrigger className="w-[120px] h-8 text-xs font-medium">
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
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => handleRemove(member.id)}
                      disabled={member.role === "owner" || removeMember.isPending}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
