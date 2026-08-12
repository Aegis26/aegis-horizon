import React, { useState } from 'react';
import { Bot, Zap, Users, ArrowRight } from 'lucide-react';
import { AnimatedFadeIn } from './AnimatedFadeIn';

const FEATURES = [
  {
    id: 'customer-360',
    title: 'Customer 360',
    description: 'Every interaction, opportunity, and insight mapped to a unified timeline.',
    icon: Users,
    stats: { label: 'Time to Insight', value: 'Instantly', progress: 100 },
    details: [
      'Cross-channel activity timeline',
      'Organizational hierarchy mapping',
      'Relationship strength scoring'
    ]
  },
  {
    id: 'ai-intelligence',
    title: 'AI-Powered Intelligence',
    description: 'Predictive forecasting and deal risk analysis powered by behavioral data.',
    icon: Bot,
    stats: { label: 'Forecast Accuracy', value: '94%', progress: 94 },
    details: [
      'Real-time deal risk alerts',
      'Suggested next best actions',
      'Sentiment analysis'
    ]
  },
  {
    id: 'automation',
    title: 'Seamless Automation',
    description: 'Trigger workflows, data enrichment, and routing without writing code.',
    icon: Zap,
    stats: { label: 'Hours Saved/Week', value: '12+', progress: 75 },
    details: [
      'Visual workflow builder',
      'Automatic contact enrichment',
      'Smart lead routing'
    ]
  }
];

export function FeatureShowcase() {
  const [activeFeature, setActiveFeature] = useState(FEATURES[0].id);

  const activeData = FEATURES.find(f => f.id === activeFeature)!;

  return (
    <section className="py-24 md:py-32 px-6 md:px-12 relative z-10">
      <div className="max-w-6xl mx-auto">
        <AnimatedFadeIn>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-display font-bold text-foreground mb-4">
              Intelligence at every layer
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Aegis Horizon doesn't just store data. It interprets, routes, and acts on it.
            </p>
          </div>
        </AnimatedFadeIn>

        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Feature List */}
          <div className="lg:col-span-5 space-y-4">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              const isActive = activeFeature === feature.id;
              
              return (
                <button
                  key={feature.id}
                  onClick={() => setActiveFeature(feature.id)}
                  className={`w-full text-left p-6 rounded-lg transition-all duration-300 relative overflow-hidden group ${
                    isActive 
                      ? 'bg-primary/10 border-primary/30 shadow-[0_0_20px_rgba(0,180,216,0.15)] scale-[1.02] z-10' 
                      : 'bg-card border-border/50 hover:border-primary/30 hover:bg-primary/5'
                  } border`}
                >
                  {isActive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
                  )}
                  
                  <div className="flex items-start gap-4 relative z-10">
                    <div className={`p-3 rounded-lg transition-colors ${
                      isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground group-hover:text-primary'
                    }`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className={`font-display font-bold text-lg mb-1 transition-colors ${
                        isActive ? 'text-primary' : 'text-foreground'
                      }`}>
                        {feature.title}
                      </h3>
                      <p className={`text-sm leading-relaxed transition-colors ${
                        isActive ? 'text-foreground/90' : 'text-muted-foreground'
                      }`}>
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Deep Dive Panel */}
          <div className="lg:col-span-7 lg:sticky lg:top-24">
            <div className="p-8 md:p-10 rounded-lg bg-card border border-primary/20 relative overflow-hidden min-h-[400px] flex flex-col shadow-xl">
              <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-[80px]" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary/10 rounded-full blur-[80px]" />
              
              <div key={activeFeature} className="animate-fadeInBlur relative z-10 flex-1 flex flex-col">
                <div className="flex items-center gap-4 mb-8">
                  <div className="p-4 rounded-lg bg-primary/20 text-primary border border-primary/30 shadow-[0_0_15px_rgba(0,180,216,0.2)]">
                    <activeData.icon className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="font-display font-bold text-2xl">{activeData.title}</h4>
                    <p className="text-primary text-sm font-medium uppercase tracking-wider">Deep Dive</p>
                  </div>
                </div>

                <ul className="space-y-4 mb-10 flex-1">
                  {activeData.details.map((detail, idx) => (
                    <li 
                      key={idx} 
                      className="flex items-center gap-3 text-muted-foreground opacity-0"
                      style={{ 
                        animation: 'slideUpReveal 0.5s ease forwards',
                        animationDelay: `${idx * 0.1}s` 
                      }}
                    >
                      <ArrowRight className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-base">{detail}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-6 border-t border-border/50">
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-sm font-medium text-muted-foreground">{activeData.stats.label}</span>
                    <span className="font-mono text-xl font-bold text-primary">{activeData.stats.value}</span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden relative">
                    <div 
                      className="h-full absolute left-0 top-0 overflow-hidden"
                      style={{ 
                        width: '100%',
                        animation: 'growWidth 1s ease-out forwards',
                        animationDelay: '0.3s',
                        transformOrigin: 'left'
                      }}
                    >
                      <div 
                        className="h-full bg-primary rounded-full relative"
                        style={{ width: `${activeData.stats.progress}%` }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
