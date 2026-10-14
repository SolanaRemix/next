import { forwardRef } from "react";
import type { GlassCardProps } from "./types";

const aura = {
  orange: "0 0 20px rgba(255, 87, 34, 0.35)",
  green: "0 0 15px rgba(0, 255, 128, 0.3)",
  red: "0 0 15px rgba(255, 0, 0, 0.3)",
  none: "none",
} as const;

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard({
  children,
  glowColor = "none",
  flashOnUpdate = false,
  className = "",
  ...props
}, ref) {
  return (
    <div
      ref={ref}
      className={`glass-card ${flashOnUpdate ? "glass-card--flash" : ""} ${className}`.trim()}
      style={{ boxShadow: aura[glowColor] }}
      {...props}
    >
      {children}
    </div>
  );
});
