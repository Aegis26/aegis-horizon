import { useState, useMemo } from "react";
import { 
  useGetBillingCatalog, 
  useCreateCheckoutSession,
  useUpdateFeatures,
  useGetOrg,
  getGetOrgQueryKey,
  getGetOrgDashboardQueryKey,
  getGetBillingCatalogQueryKey
} from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Package, Sparkles, Building2, Code2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

export default function Billing() {
  const { selectedOrgId } = useOrgStore();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: catalog, isLoading: catalogLoading } = useGetBillingCatalog({ query: { queryKey: getGetBillingCatalogQueryKey() }});
  const { data: org, isLoading: orgLoading } = useGetOrg(selectedOrgId || "", {
    query: { enabled: !!selectedOrgId, queryKey: getGetOrgQueryKey(selectedOrgId || "") }
  });

  const createCheckout = useCreateCheckoutSession();
  const updateFeatures = useUpdateFeatures();

  const [isAnnual, setIsAnnual] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());

  // Initialize selected features from org on load
  useMemo(() => {
    if (org?.enabledFeatures && selectedFeatures.size === 0) {
      setSelectedFeatures(new Set(org.enabledFeatures));
    }
  }, [org?.enabledFeatures]);

  if (catalogLoading || orgLoading) {
    return <div className="animate-pulse h-[600px] bg-muted rounded-xl"></div>;
  }

  if (!catalog || !org) return null;

  const handleCheckout = (planKey: string) => {
    createCheckout.mutate({
      orgId: selectedOrgId!,
      data: {
        plan: planKey as any,
        interval: isAnnual ? "year" : "month"
      }
    }, {
      onSuccess: (res) => {
        window.location.href = res.url;
      },
      onError: (err) => {
        if (err.status === 503) {
          toast({
            title: "Billing Not Connected",
            description: "Stripe integration is not configured yet. Use Dev Mode below.",
            variant: "destructive"
          });
        }
      }
    });
  };

  const handleDevApplyFeatures = () => {
    updateFeatures.mutate({
      orgId: selectedOrgId!,
      data: { features: Array.from(selectedFeatures) }
    }, {
      onSuccess: () => {
        toast({ title: "Features Updated", description: "Your custom feature selection has been applied." });
        queryClient.invalidateQueries({ queryKey: getGetOrgQueryKey(selectedOrgId!) });
        queryClient.invalidateQueries({ queryKey: getGetOrgDashboardQueryKey(selectedOrgId!) });
      }
    });
  };

  const toggleFeature = (key: string, checked: boolean) => {
    const next = new Set(selectedFeatures);
    if (checked) next.add(key);
    else next.delete(key);
    setSelectedFeatures(next);
  };

  // Group features by category for custom tab
  const categories = Array.from(new Set(catalog.features.map(f => f.category)));

  // Calculate custom total
  const customMonthlyTotal = catalog.features
    .filter(f => selectedFeatures.has(f.key))
    .reduce((sum, f) => sum + f.monthlyPriceCents, 0);

  const getPrice = (monthlyCents: number) => {
    if (isAnnual) {
      return (monthlyCents * (1 - catalog.annualDiscountPercent / 100));
    }
    return monthlyCents;
  };

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Feature Compositor</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          Meridian is modular. Choose an out-of-the-box plan or build your exact CRM by enabling only the features you need.
        </p>
      </div>

      <div className="flex items-center justify-center gap-4 py-4 bg-muted/50 rounded-xl max-w-sm mx-auto">
        <span className={!isAnnual ? "font-semibold" : "text-muted-foreground"}>Monthly</span>
        <Switch checked={isAnnual} onCheckedChange={setIsAnnual} />
        <span className={isAnnual ? "font-semibold" : "text-muted-foreground"}>
          Annually <Badge variant="secondary" className="ml-1 text-primary">Save {catalog.annualDiscountPercent}%</Badge>
        </span>
      </div>

      <Tabs defaultValue="essential" className="w-full">
        <div className="flex justify-center mb-8">
          <TabsList className="h-14 px-2 w-full max-w-3xl grid grid-cols-4">
            <TabsTrigger value="essential" className="h-10">Essential</TabsTrigger>
            <TabsTrigger value="professional" className="h-10">Professional</TabsTrigger>
            <TabsTrigger value="enterprise" className="h-10">Enterprise</TabsTrigger>
            <TabsTrigger value="custom" className="h-10 bg-primary/10 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Custom</TabsTrigger>
          </TabsList>
        </div>

        {catalog.plans.map(plan => (
          <TabsContent key={plan.key} value={plan.key} className="mt-0 outline-none">
            <Card className="max-w-2xl mx-auto border-2 data-[active=true]:border-primary" data-active={org.plan === plan.key}>
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-2xl capitalize">{plan.name}</CardTitle>
                <CardDescription className="text-base">{plan.description}</CardDescription>
                <div className="py-6 flex items-baseline justify-center gap-1">
                  <span className="text-5xl font-extrabold font-mono tracking-tighter">
                    {formatCurrency(getPrice(plan.monthlyPriceCents)).replace(/\.00$/, "")}
                  </span>
                  <span className="text-muted-foreground font-medium">/user/mo</span>
                </div>
              </CardHeader>
              <CardContent className="px-10">
                <div className="space-y-4">
                  {plan.includedFeatures.map(fKey => {
                    const feature = catalog.features.find(f => f.key === fKey);
                    return (
                      <div key={fKey} className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                        <span className="font-medium text-foreground">{feature?.name}</span>
                        <span className="text-muted-foreground text-sm ml-auto">{feature?.category}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
              <CardFooter className="px-10 pb-10 pt-6">
                <Button 
                  size="lg" 
                  className="w-full h-14 text-lg" 
                  onClick={() => handleCheckout(plan.key)}
                  disabled={org.plan === plan.key}
                >
                  {org.plan === plan.key ? "Current Plan" : "Subscribe Now"}
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
        ))}

        <TabsContent value="custom" className="mt-0 outline-none">
          <div className="grid xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-8">
              {categories.map(category => (
                <div key={category} className="space-y-4">
                  <h3 className="text-lg font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2">{category}</h3>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {catalog.features.filter(f => f.category === category).map(feature => (
                      <div 
                        key={feature.key} 
                        className={`flex p-4 border rounded-xl transition-colors cursor-pointer ${
                          selectedFeatures.has(feature.key) ? "border-primary bg-primary/5" : "hover:border-foreground/20 bg-card"
                        }`}
                        onClick={() => toggleFeature(feature.key, !selectedFeatures.has(feature.key))}
                      >
                        <div className="flex-1 pr-4">
                          <div className="font-semibold">{feature.name}</div>
                          <div className="text-sm text-muted-foreground mt-1 line-clamp-2">{feature.description}</div>
                        </div>
                        <div className="flex flex-col items-end justify-between">
                          <div className="font-mono font-medium text-primary">
                            {feature.monthlyPriceCents === 0 ? "Free" : `+${formatCurrency(getPrice(feature.monthlyPriceCents)).replace(/\.00$/, "")}/mo`}
                          </div>
                          <Checkbox 
                            checked={selectedFeatures.has(feature.key)} 
                            onCheckedChange={(c) => toggleFeature(feature.key, !!c)}
                            onClick={e => e.stopPropagation()} // prevent double toggle
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            
            <div>
              <div className="sticky top-24">
                <Card className="border-primary shadow-xl">
                  <CardHeader className="pb-4 bg-primary/5 rounded-t-xl border-b">
                    <CardTitle className="text-xl">Your Custom Build</CardTitle>
                    <CardDescription>Tailored specifically for your needs.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="flex items-baseline justify-between mb-6 pb-6 border-b">
                      <span className="text-muted-foreground font-medium">Total</span>
                      <div className="text-right">
                        <div className="text-4xl font-extrabold font-mono tracking-tighter text-primary">
                          {formatCurrency(getPrice(customMonthlyTotal)).replace(/\.00$/, "")}
                        </div>
                        <div className="text-sm text-muted-foreground">/user/mo</div>
                      </div>
                    </div>
                    
                    <div className="space-y-2 mb-8 text-sm">
                      <div className="font-semibold mb-3">Included Modules:</div>
                      {Array.from(selectedFeatures).map(key => {
                        const f = catalog.features.find(f => f.key === key);
                        return (
                          <div key={key} className="flex justify-between items-center text-muted-foreground">
                            <span>{f?.name}</span>
                            <span className="font-mono text-xs">{f?.monthlyPriceCents === 0 ? "Free" : `+${formatCurrency(getPrice(f!.monthlyPriceCents)).replace(/\.00$/, "")}`}</span>
                          </div>
                        );
                      })}
                      {selectedFeatures.size === 0 && (
                        <div className="text-muted-foreground italic">No features selected.</div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Button size="lg" className="w-full font-bold h-12" onClick={() => handleCheckout("custom")}>
                        Subscribe Custom Build
                      </Button>
                      <Button variant="outline" className="w-full text-xs text-muted-foreground" onClick={handleDevApplyFeatures}>
                        <Code2 className="h-4 w-4 mr-2" />
                        Apply features instantly (Dev Mode)
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
