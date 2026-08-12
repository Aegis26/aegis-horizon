import React from 'react';
import { useGetBillingCatalog, getGetBillingCatalogQueryKey } from "@workspace/api-client-react";
import { Link } from 'wouter';
import { Check, Loader2 } from 'lucide-react';
import { formatCurrency } from "@/lib/format";
import { Button } from '@/components/ui/button';
import { AnimatedFadeIn } from './AnimatedFadeIn';

export function PricingSection() {
  const { data: catalog, isLoading } = useGetBillingCatalog({ 
    query: { queryKey: getGetBillingCatalogQueryKey() }
  });

  return (
    <section className="py-24 px-6 md:px-12 relative z-10 border-t border-primary/10 bg-background/50">
      <div className="max-w-6xl mx-auto">
        <AnimatedFadeIn>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-display font-bold text-foreground mb-4">
              Clear pricing. No surprises.
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Start small, scale infinitely. Choose the foundation that fits your team.
            </p>
          </div>
        </AnimatedFadeIn>

        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {catalog?.plans.map((plan, idx) => {
              const isPopular = plan.key === 'professional';
              
              return (
                <AnimatedFadeIn key={plan.key} delay={idx * 0.1}>
                  <div 
                    className={`relative rounded-lg border flex flex-col h-full transition-all duration-300 ${
                      isPopular 
                        ? 'bg-card border-primary/50 shadow-[0_0_30px_rgba(0,180,216,0.15)] scale-100 md:scale-105 z-10' 
                        : 'bg-card/50 border-border/50 hover:border-primary/30'
                    }`}
                  >
                    {isPopular && (
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
                        <div className="bg-primary text-bg-dark text-xs font-bold uppercase tracking-wider py-1 px-3 rounded-full shadow-[0_0_10px_rgba(0,180,216,0.5)]">
                          Most Popular
                        </div>
                      </div>
                    )}
                    
                    <div className="p-8 flex-1 flex flex-col">
                      <h3 className="font-display text-2xl font-bold capitalize mb-2">{plan.name}</h3>
                      <p className="text-muted-foreground text-sm mb-6 min-h-[40px]">{plan.description}</p>
                      
                      <div className="mb-6 flex items-baseline gap-1">
                        <span className="text-4xl font-mono font-bold">
                          {formatCurrency(plan.monthlyPriceCents).replace(/\.00$/, "")}
                        </span>
                        <span className="text-muted-foreground font-mono">/user/mo</span>
                      </div>
                      
                      <Link href="/sign-up" className="w-full mt-auto mb-8 block">
                        <Button 
                          variant={isPopular ? 'default' : 'outline'} 
                          className={`w-full h-12 ${isPopular ? 'shadow-[0_0_15px_rgba(0,180,216,0.3)]' : ''}`}
                        >
                          Start Free Trial
                        </Button>
                      </Link>
                      
                      <div className="space-y-3">
                        <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Includes</p>
                        {plan.includedFeatures.slice(0, 5).map(fKey => {
                          const feature = catalog.features.find(f => f.key === fKey);
                          return (
                            <div key={fKey} className="flex items-start gap-3">
                              <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                              <span className="text-sm text-foreground/90">{feature?.name}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </AnimatedFadeIn>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
