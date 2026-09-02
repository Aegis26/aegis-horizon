import { useRoute } from "wouter";
import { useOrgStore } from "@/store/org-store";
import { useGetAccount, getGetAccountQueryKey } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, UserCircle, Clock, FileText, Target, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ProfileTab } from "@/components/accounts/ProfileTab";
import { ContactsTab } from "@/components/accounts/ContactsTab";
import { TimelineTab } from "@/components/accounts/TimelineTab";
import { FilesTab } from "@/components/accounts/FilesTab";
import { MessageSquare } from "lucide-react";
import { Workspace as CommunicationsWorkspace } from "./Communications";

export default function AccountDetail() {
  const [match, params] = useRoute("/accounts/:accountId");
  const accountId = params?.accountId;
  const { selectedOrgId } = useOrgStore();

  const { data: account, isLoading, error } = useGetAccount(selectedOrgId || "", accountId || "", {
    query: {
      enabled: !!selectedOrgId && !!accountId,
      queryKey: getGetAccountQueryKey(selectedOrgId || "", accountId || "")
    }
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><div className="spinner" /></div>;
  }

  if (error || !account) {
    return (
      <div className="p-8 text-center text-destructive">
        <h2 className="text-xl font-bold font-display">Account not found</h2>
        <Link href="/accounts"><Button className="mt-4" variant="outline">Go back</Button></Link>
      </div>
    );
  }

  return (
    <div className="animate-scaleInEntrance pb-12">
      <header className="px-8 py-6 border-b border-primary/10 bg-background/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/accounts">
            <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2 text-muted-foreground hover:text-primary">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center border border-primary/20 shadow-glow">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight font-display text-foreground leading-none">{account.name}</h1>
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                {account.website && <a href={account.website} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{account.website}</a>}
                {account.website && account.industry && <span>•</span>}
                {account.industry && <span>{account.industry}</span>}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="p-8 pt-6 max-w-7xl mx-auto">
        <Tabs defaultValue="timeline" className="w-full">
          <TabsList className="bg-card border border-primary/10 mb-6 h-12 w-full justify-start overflow-x-auto shadow-sm">
            <TabsTrigger value="profile" className="gap-2 font-display data-[state=active]:bg-primary/10 data-[state=active]:text-primary"><Building2 className="h-4 w-4"/> Profile</TabsTrigger>
            <TabsTrigger value="contacts" className="gap-2 font-display data-[state=active]:bg-primary/10 data-[state=active]:text-primary"><UserCircle className="h-4 w-4"/> Contacts</TabsTrigger>
            <TabsTrigger value="timeline" className="gap-2 font-display data-[state=active]:bg-primary/10 data-[state=active]:text-primary"><Clock className="h-4 w-4"/> Timeline</TabsTrigger>
            <TabsTrigger value="files" className="gap-2 font-display data-[state=active]:bg-primary/10 data-[state=active]:text-primary"><FileText className="h-4 w-4"/> Files</TabsTrigger>
            <TabsTrigger value="opportunities" className="gap-2 font-display data-[state=active]:bg-primary/10 data-[state=active]:text-primary"><Target className="h-4 w-4"/> Opportunities</TabsTrigger>
            <TabsTrigger value="communications" className="gap-2 font-display data-[state=active]:bg-primary/10 data-[state=active]:text-primary"><MessageSquare className="h-4 w-4"/> Communications</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-0 outline-none">
            <div className="bg-card border border-primary/10 rounded-lg p-6 shadow-md">
              <ProfileTab account={account} orgId={selectedOrgId!} />
            </div>
          </TabsContent>

          <TabsContent value="contacts" className="mt-0 outline-none">
            <ContactsTab accountId={account.id} orgId={selectedOrgId!} />
          </TabsContent>

          <TabsContent value="timeline" className="mt-0 outline-none">
            <TimelineTab accountId={account.id} orgId={selectedOrgId!} />
          </TabsContent>

          <TabsContent value="files" className="mt-0 outline-none">
            <FilesTab accountId={account.id} orgId={selectedOrgId!} />
          </TabsContent>

          <TabsContent value="opportunities" className="mt-0 outline-none">
            {account.opportunities.length === 0 ? (
              <div className="text-center p-12 bg-card/50 rounded-lg border border-primary/10">
                <Target className="h-10 w-10 mx-auto mb-4 text-muted-foreground opacity-20" />
                <h3 className="text-lg font-display text-primary mb-2">No opportunities yet</h3>
                <p className="text-muted-foreground">Opportunities on this account will appear here.</p>
              </div>
            ) : (
              <div className="bg-card border border-primary/10 rounded-lg shadow-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-background/50 border-b border-primary/10">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Stage</th>
                      <th className="px-4 py-3 font-medium text-right">Value</th>
                      <th className="px-4 py-3 font-medium text-right">Probability</th>
                      <th className="px-4 py-3 font-medium text-right">Expected close</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.opportunities.map((opp) => (
                      <tr key={opp.id} className="border-b border-primary/5 last:border-0 hover:bg-primary/5">
                        <td className="px-4 py-3 font-medium text-foreground">{opp.name}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-display text-primary">
                            {opp.stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{opp.value ?? "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{opp.probability != null ? `${opp.probability}%` : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{opp.expectedCloseDate ? new Date(opp.expectedCloseDate).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="communications" className="mt-0 outline-none">
            <div className="bg-card border border-primary/10 rounded-lg shadow-md overflow-hidden h-[600px] flex flex-col">
              <CommunicationsWorkspace accountId={account.id} orgId={selectedOrgId!} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}