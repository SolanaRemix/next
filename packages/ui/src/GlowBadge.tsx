import type { GlowBadgeProps } from "./types";

export function GlowBadge({ children, tone = "neutral", className = "", ...props }: GlowBadgeProps) {
  return (
    <span className={`glow-badge glow-badge--${tone} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}
