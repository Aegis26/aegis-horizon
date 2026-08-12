import React, { useEffect, useRef, useState } from 'react';

interface Props {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export function AnimatedFadeIn({ children, delay = 0, className = "" }: Props) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => {
      if (ref.current) observer.unobserve(ref.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`opacity-0 ${className}`}
      style={{
        animation: isVisible ? `fadeInBlur 0.8s ease forwards` : 'none',
        animationDelay: `${delay}s`,
      }}
    >
      {children}
    </div>
  );
}
