import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  Building2, 
  LayoutDashboard, 
  Users, 
  Target, 
  Workflow, 
  CreditCard,
  Settings,
  ChevronDown,
  Menu
} from "lucide-react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Users, feature: "crm" },
  { href: "/opportunities", label: "Opportunities", icon: Target, feature: "sales" },
  { href: "/automation", label: "Automation", icon: Workflow, feature: "automation" },
  { href: "/billing", label: "Billing & Features", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() }});
  const { selectedOrgId, setSelectedOrgId } = useOrgStore();

  const orgs = me?.orgs || [];
  
  // Set default org if none selected
  if (orgs.length > 0 && !selectedOrgId) {
    setSelectedOrgId(orgs[0].org.id);
  }

  const currentOrg = orgs.find(o => o.org.id === selectedOrgId)?.org || orgs[0]?.org;

  if (!me || !currentOrg) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="h-8 w-8 text-primary/50"><Building2 size={32} /></div>
          <p className="text-muted-foreground text-sm font-medium">Loading workspace...</p>
        </div>
      </div>
    );
  }

  const enabledFeatures = currentOrg.enabledFeatures || [];

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-sidebar">
        <div className="p-4 h-16 flex items-center border-b border-border/50">
          <div className="flex items-center gap-2 font-bold text-lg text-primary font-display">
            <img src={`${basePath}/logo-icon.png`} alt="Aegis Horizon" className="h-8 w-8 object-contain" />
            <span>Aegis Horizon</span>
          </div>
        </div>
        
        {/* Org Switcher placeholder - simple version */}
        {orgs.length > 1 && (
          <div className="p-4 border-b">
            <select 
              className="w-full bg-transparent border rounded p-1 text-sm"
              value={selectedOrgId || ""}
              onChange={(e) => setSelectedOrgId(e.target.value)}
            >
              {orgs.map(o => (
                <option key={o.org.id} value={o.org.id}>{o.org.name}</option>
              ))}
            </select>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            if (item.feature && !enabledFeatures.includes(item.feature)) {
              return null; // Do not show nav item if feature is not enabled
            }
            const active = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div className={`flex items-center gap-3 px-4 py-3 rounded-md text-sm font-sans font-medium transition-all duration-150 cursor-pointer ${
                  active ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-primary/10 hover:text-foreground"
                }`}>
                  <item.icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-primary/10 bg-background/30">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9 border border-primary/20 shadow-sm">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-display font-bold">
                {me.user.fullName?.substring(0, 2).toUpperCase() || me.user.email.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate font-sans text-foreground">{me.user.fullName || "User"}</p>
              <p className="text-xs text-muted-foreground truncate">{me.user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden h-14 border-b border-primary/10 flex items-center px-4 bg-background/50 backdrop-blur-sm sticky top-0 z-40">
          <div className="font-bold flex-1 font-display">Aegis Horizon</div>
          <Button variant="ghost" size="icon">
            <Menu className="h-5 w-5" />
          </Button>
        </header>
        
        <div className="flex-1 overflow-y-auto pb-12">
          {children}
        </div>
      </main>
      
      {/* Mobile Tab Bar could go here */}
    </div>
  );
}
