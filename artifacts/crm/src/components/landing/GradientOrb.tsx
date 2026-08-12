import React from 'react';

interface Props {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  color: 'primary' | 'secondary';
  size: 'md' | 'lg' | 'xl';
  animation: 'float' | 'pulse-glow';
  duration?: number;
}

export function GradientOrb({ position, color, size, animation, duration = 8 }: Props) {
  const positionClass = {
    'top-left': 'top-0 left-0 -translate-x-1/2 -translate-y-1/2',
    'top-right': 'top-0 right-0 translate-x-1/2 -translate-y-1/2',
    'bottom-left': 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2',
    'bottom-right': 'bottom-0 right-0 translate-x-1/2 translate-y-1/2',
    'center': 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
  }[position];

  const sizeClass = {
    md: 'w-64 h-64 blur-[80px]',
    lg: 'w-96 h-96 blur-[100px]',
    xl: 'w-[500px] h-[500px] blur-[120px]',
  }[size];

  const colorClass = {
    primary: 'bg-primary/20',
    secondary: 'bg-secondary/20',
  }[color];

  const animationClass = {
    'float': 'animate-float',
    'pulse-glow': 'animate-pulse-glow',
  }[animation];

  return (
    <div
      className={`absolute rounded-full pointer-events-none ${positionClass} ${sizeClass} ${colorClass} ${animationClass}`}
      style={{ animationDuration: `${duration}s` }}
    />
  );
}
