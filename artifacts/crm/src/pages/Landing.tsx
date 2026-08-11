import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Zap, Shield, ArrowRight } from "lucide-react";

export default function Landing() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="min-h-screen bg-background flex flex-col font-sans text-foreground">
      <header className="h-16 border-b border-border/50 flex items-center px-6 md:px-12 justify-between sticky top-0 bg-background/80 backdrop-blur z-50">
        <div className="flex items-center gap-2 text-primary font-bold text-xl tracking-tight font-display">
          <img src={`${basePath}/logo-icon.png`} alt="" className="h-9 w-9 object-contain" />
          <span className="uppercase">
            Aegis <span className="text-foreground">Horizon</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/sign-in">
            <Button variant="ghost" className="font-semibold text-foreground hidden sm:flex">Sign In</Button>
          </Link>
          <Link href="/sign-up">
            <Button className="font-semibold">Get Started</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative py-24 md:py-32 px-6 md:px-12 max-w-6xl mx-auto text-center overflow-hidden">
          {/* subtle background glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl h-full max-h-96 bg-primary/10 blur-[100px] rounded-full pointer-events-none" />
          
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-8">
              <Zap className="h-4 w-4" />
              <span>See Beyond the Horizon</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-foreground mb-8 leading-tight font-display">
              The command center <br className="hidden md:block"/> for serious sales teams.
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Aegis Horizon brings clarity to customer relationships. Every interaction, every opportunity, every insight—visible at a glance. Focus on data-driven decisions.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/sign-up">
                <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 gap-2">
                  Start Forecasting <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <Link href="/sign-in">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 bg-transparent border-primary/20 text-foreground hover:bg-primary/5 hover:border-primary/50">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-24 bg-card/50 px-6 md:px-12 border-t border-border/50">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-3 gap-12">
              <div className="space-y-4 p-6 rounded-xl border border-border/50 bg-background card-hover transition-all">
                <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
                  <Shield className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold font-display">Multi-tenant Architecture</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Manage multiple organizations under a single identity. Perfect for holding companies and agencies.
                </p>
              </div>
              <div className="space-y-4 p-6 rounded-xl border border-border/50 bg-background card-hover transition-all">
                <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold font-display">Precise & Clear</h3>
                <p className="text-muted-foreground leading-relaxed">
                  No clutter, no confusion, designed for decision-makers. Turn features on and off at will.
                </p>
              </div>
              <div className="space-y-4 p-6 rounded-xl border border-border/50 bg-background card-hover transition-all">
                <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
                  <Zap className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold font-display">Enterprise Grade</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Authoritative and secure. Granular roles, audit logs, and integrations ready for scale.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-12 border-t border-border/50 text-center text-muted-foreground text-sm bg-background">
        <p>© {new Date().getFullYear()} Aegis Horizon. All rights reserved.</p>
      </footer>
    </div>
  );
}
