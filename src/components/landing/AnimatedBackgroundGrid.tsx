import React from 'react';

export function AnimatedBackgroundGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Layer 1: Static Grid */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(0deg, transparent 24%, rgba(0, 180, 216, 0.15) 25%, rgba(0, 180, 216, 0.15) 26%, transparent 27%, transparent 74%, rgba(0, 180, 216, 0.15) 75%, rgba(0, 180, 216, 0.15) 76%, transparent 77%, transparent),
            linear-gradient(90deg, transparent 24%, rgba(0, 180, 216, 0.15) 25%, rgba(0, 180, 216, 0.15) 26%, transparent 27%, transparent 74%, rgba(0, 180, 216, 0.15) 75%, rgba(0, 180, 216, 0.15) 76%, transparent 77%, transparent)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Layer 2: Animated Grid Lines (subtle) */}
      <svg
        className="absolute inset-0 w-full h-full opacity-30"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path
              d="M 80 0 L 0 0 0 80"
              fill="none"
              stroke="url(#gridGradient)"
              strokeWidth="1"
            />
          </pattern>
          <linearGradient id="gridGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(0, 180, 216, 0.4)" />
            <stop offset="100%" stopColor="rgba(0, 180, 216, 0.05)" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Layer 3: Radial Gradient Overlay */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(0, 180, 216, 0.05) 0%, transparent 60%)',
        }}
      />

      {/* Layer 4: Animated gradient beam (horizontal) */}
      <div
        className="absolute -top-[50%] -bottom-[50%] left-1/4 w-[500px] h-[200%] blur-[100px] opacity-10"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(0, 180, 216, 0.6), transparent)',
          animation: 'slideHorizontal 15s ease-in-out infinite',
          willChange: 'transform',
        }}
      />

      {/* Layer 5: Animated gradient beam (vertical) */}
      <div
        className="absolute -left-[50%] -right-[50%] top-1/3 w-[200%] h-[500px] blur-[100px] opacity-10"
        style={{
          background:
            'linear-gradient(180deg, rgba(0, 102, 204, 0.6), transparent, rgba(0, 102, 204, 0.2))',
          animation: 'slideVertical 20s ease-in-out infinite',
          willChange: 'transform',
        }}
      />
    </div>
  );
}
