import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Building2, CheckCircle2, Zap, Shield, ArrowRight } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="h-16 border-b flex items-center px-6 md:px-12 justify-between sticky top-0 bg-background/80 backdrop-blur z-50">
        <div className="flex items-center gap-2 text-primary font-bold text-xl tracking-tight">
          <Building2 className="h-6 w-6" />
          <span>Meridian</span>
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
        <section className="py-24 md:py-32 px-6 md:px-12 max-w-6xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-8">
            <Zap className="h-4 w-4" />
            <span>The precise, modular CRM</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-foreground mb-8 leading-tight">
            The command center <br className="hidden md:block"/> for serious sales teams.
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Compose your own CRM from modular features. Pay only for what you need. 
            Meridian gives your organization a tailored cockpit for revenue operations.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/sign-up">
              <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 gap-2">
                Start Building Your CRM <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
            <Link href="/sign-in">
              <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8">
                Sign In
              </Button>
            </Link>
          </div>
        </section>

        {/* Features */}
        <section className="py-24 bg-muted/30 px-6 md:px-12">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-3 gap-12">
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Building2 className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold">Multi-tenant Architecture</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Manage multiple organizations under a single identity. Perfect for holding companies and agencies.
                </p>
              </div>
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold">Modular Features</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Turn features on and off at will. No more bloated interfaces. Build the exact CRM your team needs today.
                </p>
              </div>
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Shield className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold">Enterprise Grade</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Secure by default. Granular roles, audit logs, and SSO connections ready for scale.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-12 border-t text-center text-muted-foreground text-sm">
        <p>© {new Date().getFullYear()} Meridian CRM. All rights reserved.</p>
      </footer>
    </div>
  );
}
