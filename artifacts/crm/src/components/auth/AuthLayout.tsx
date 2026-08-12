import React from 'react';
import { AnimatedBackgroundGrid } from '@/components/landing/AnimatedBackgroundGrid';
import { GradientOrb } from '@/components/landing/GradientOrb';
import { Shield, Server, Zap } from 'lucide-react';

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center relative overflow-hidden py-12 px-4 selection:bg-primary/30">
      {/* Animated Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <AnimatedBackgroundGrid />
        <GradientOrb
          position="top-right"
          color="primary"
          size="lg"
          animation="pulse-glow"
          duration={6}
        />
        <GradientOrb
          position="bottom-left"
          color="secondary"
          size="lg"
          animation="float"
          duration={8}
        />
      </div>

      <div className="relative z-10 w-full max-w-md animate-scaleInEntrance flex flex-col items-center">
        {/* Clerk Card goes here */}
        {children}

        {/* Trust Badges */}
        <div className="mt-12 flex items-center justify-center gap-6 w-full opacity-80">
          <div className="text-center flex flex-col items-center">
            <Shield className="w-5 h-5 text-primary mb-2 opacity-80" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              SOC 2 Certified
            </p>
          </div>
          <div className="w-px h-8 bg-primary/20" />
          <div className="text-center flex flex-col items-center">
            <Server className="w-5 h-5 text-primary mb-2 opacity-80" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Enterprise Grade
            </p>
          </div>
          <div className="w-px h-8 bg-primary/20" />
          <div className="text-center flex flex-col items-center">
            <Zap className="w-5 h-5 text-primary mb-2 opacity-80" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              99.9% Uptime
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
