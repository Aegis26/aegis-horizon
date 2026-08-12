import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Zap } from "lucide-react";
import { AnimatedBackgroundGrid } from "@/components/landing/AnimatedBackgroundGrid";
import { GradientOrb } from "@/components/landing/GradientOrb";
import { AnimatedTextReveal } from "@/components/landing/AnimatedTextReveal";
import { AnimatedFadeIn } from "@/components/landing/AnimatedFadeIn";
import { FeatureShowcase } from "@/components/landing/FeatureShowcase";
import { PricingSection } from "@/components/landing/PricingSection";

export default function Landing() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground selection:bg-primary/30">
      
      {/* Global Background Elements */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <AnimatedBackgroundGrid />
        <div className="absolute inset-0 bg-background/50 backdrop-blur-[2px] opacity-50" />
      </div>

      {/* Navbar */}
      <header className="h-20 border-b border-primary/10 flex items-center px-6 md:px-12 justify-between sticky top-0 bg-background/80 backdrop-blur-xl z-50">
        <div className="flex items-center gap-3 text-primary font-bold text-xl tracking-tight font-display">
          <img src={`${basePath}/logo-icon.png`} alt="" className="h-8 w-8 object-contain" />
          <span className="uppercase tracking-widest text-foreground">
            Aegis<span className="text-primary font-light">Horizon</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="hidden sm:block">
            <Button variant="ghost" className="font-semibold text-muted-foreground hover:text-foreground">
              Sign In
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button className="font-semibold shadow-glow">Get Started</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 relative z-10">
        {/* Hero Section */}
        <section className="relative min-h-[90vh] flex items-center justify-center pt-10 pb-24 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <GradientOrb
              position="top-left"
              color="primary"
              size="lg"
              animation="float"
              duration={8}
            />
            <GradientOrb
              position="bottom-right"
              color="secondary"
              size="xl"
              animation="pulse-glow"
              duration={6}
            />
          </div>
          
          <div className="relative z-10 max-w-4xl text-center px-6">
            <div className="mb-8 inline-block">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium tracking-wide uppercase">
                <Zap className="h-4 w-4" />
                <span>See Beyond the Horizon</span>
              </div>
              <div className="h-1 bg-gradient-to-r from-transparent via-primary to-transparent mt-3 animate-pulse-glow opacity-50" />
            </div>
            
            <h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-extrabold text-foreground mb-6 leading-tight tracking-tight">
              <AnimatedTextReveal text="The command center for serious sales teams." />
            </h1>
            
            <AnimatedFadeIn delay={0.6}>
              <p className="text-xl md:text-2xl text-muted-foreground mb-12 max-w-2xl mx-auto leading-relaxed">
                Aegis Horizon brings clarity to customer relationships. Every interaction,
                every opportunity, every insight—visible at a glance. Focus on data-driven decisions.
              </p>
            </AnimatedFadeIn>
            
            <AnimatedFadeIn delay={0.8}>
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                <Link href="/sign-up" className="w-full sm:w-auto block">
                  <Button size="lg" className="w-full sm:w-auto h-14 px-8 text-lg group shadow-glow relative overflow-hidden bg-primary text-background hover:text-background min-w-[200px]">
                    <span className="relative z-10 flex items-center gap-2 font-bold justify-center">
                      Start Forecasting
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </span>
                    <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent)] animate-gradient-shimmer bg-[length:200%_100%]" />
                  </Button>
                </Link>
                <Link href="/sign-in" className="w-full sm:w-auto block">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto h-14 px-8 text-lg font-bold border-primary/30 hover:bg-primary/5 hover:border-primary/50 text-foreground min-w-[200px]">
                    Sign In
                  </Button>
                </Link>
              </div>
            </AnimatedFadeIn>
          </div>
        </section>

        <FeatureShowcase />
        <PricingSection />
      </main>

      <footer className="py-12 border-t border-primary/10 text-center relative z-10 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center justify-center gap-2 text-primary font-bold text-lg tracking-tight font-display mb-4">
          <img src={`${basePath}/logo-icon.png`} alt="" className="h-6 w-6 object-contain opacity-50" />
          <span className="uppercase tracking-widest text-muted-foreground">
            Aegis<span className="text-primary/50 font-light">Horizon</span>
          </span>
        </div>
        <p className="text-muted-foreground text-sm opacity-60">Precision. Authority. Forward.</p>
        <p className="text-muted-foreground text-sm mt-4 opacity-40">© {new Date().getFullYear()} Aegis Horizon. All rights reserved.</p>
      </footer>
    </div>
  );
}
