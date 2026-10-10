import { useId } from "react";

interface LogoProps {
  size?: number;
  className?: string;
  title?: string;
}

/** Original Aliftzy mark: a faceted apex "A" with a core point. Readable down to 16px. */
export function Logo({ size = 28, className, title }: LogoProps) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={id} x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgb(139 124 246)" />
          <stop offset="0.55" stopColor="rgb(96 165 250)" />
          <stop offset="1" stopColor="rgb(103 232 249)" />
        </linearGradient>
      </defs>
      <path d="M32 11 L50 52 H42.6 L32 26.5 L21.4 52 H14 Z" fill={`url(#${id})`} />
      <circle cx="32" cy="42.5" r="3.6" fill="rgb(var(--bg))" />
    </svg>
  );
}
