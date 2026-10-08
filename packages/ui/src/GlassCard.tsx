import { motion, useReducedMotion } from "framer-motion";
import type { GlassCardProps } from "./types";

const aura = {
  orange: "0 0 20px rgba(255, 87, 34, 0.35)",
  green: "0 0 15px rgba(0, 255, 128, 0.3)",
  red: "0 0 15px rgba(255, 0, 0, 0.3)",
  none: "none",
} as const;

export function GlassCard({
  children,
  glowColor = "none",
  flashOnUpdate = false,
  className = "",
  ...props
}: GlassCardProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className={`glass-card ${className}`.trim()}
      style={{ boxShadow: aura[glowColor] }}
      animate={flashOnUpdate && !reducedMotion ? { filter: ["brightness(1)", "brightness(1.4)", "brightness(1)"] } : undefined}
      transition={{ duration: 0.55, times: [0, 0.25, 1] }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
