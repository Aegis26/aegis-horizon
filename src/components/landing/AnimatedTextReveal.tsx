import React, { useEffect, useRef, useState } from 'react';

interface Props {
  text: string;
  staggerDelay?: number;
  className?: string;
}

export function AnimatedTextReveal({ text, staggerDelay = 0.05, className = "" }: Props) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

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

  const words = text.split(' ');

  return (
    <span ref={ref} className={`inline-block ${className}`}>
      {words.map((word, idx) => (
        <span
          key={idx}
          className="inline-block opacity-0"
          style={{
            animation: isVisible ? `slideUpReveal 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards` : 'none',
            animationDelay: `${idx * staggerDelay}s`,
          }}
        >
          {word}&nbsp;
        </span>
      ))}
    </span>
  );
}
