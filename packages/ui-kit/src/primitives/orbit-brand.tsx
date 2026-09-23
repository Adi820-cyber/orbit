import { useId, type HTMLAttributes } from "react";

export interface OrbitBrandProps extends HTMLAttributes<HTMLSpanElement> {
  compact?: boolean;
  tagline?: string;
}

export function OrbitBrand({
  className,
  compact = false,
  tagline,
  ...props
}: OrbitBrandProps) {
  const gradientId = useId().replaceAll(":", "");
  const classes = ["orbit-brand", compact ? "orbit-brand--compact" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...props}>
      <svg
        aria-hidden="true"
        className="orbit-brand__mark"
        viewBox="0 0 48 48"
      >
        <defs>
          <linearGradient id={gradientId} x1="7" x2="41" y1="7" y2="41">
            <stop offset="0" stopColor="var(--orbit-brand-cyan)" />
            <stop offset="0.58" stopColor="var(--orbit-brand-blue)" />
            <stop offset="1" stopColor="var(--orbit-brand-navy)" />
          </linearGradient>
        </defs>
        <circle
          cx="24"
          cy="24"
          fill="none"
          r="15.5"
          stroke={`url(#${gradientId})`}
          strokeLinecap="round"
          strokeWidth="7"
        />
        <circle cx="38.4" cy="12.4" fill="var(--orbit-brand-aqua)" r="3.6" />
        <circle cx="9.8" cy="31.8" fill="var(--orbit-brand-blue)" r="2.8" />
      </svg>
      <span className="orbit-brand__copy">
        <span className="orbit-brand__name">Orbit</span>
        {tagline ? <span className="orbit-brand__tagline">{tagline}</span> : null}
      </span>
    </span>
  );
}
