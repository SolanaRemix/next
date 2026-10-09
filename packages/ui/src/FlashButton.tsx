import { motion, useReducedMotion } from "framer-motion";
import type { FlashButtonProps } from "./types";

export function FlashButton({
  children,
  variant = "primary",
  className = "",
  disabled,
  ...props
}: FlashButtonProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.button
      className={`flash-button flash-button--${variant} ${className}`.trim()}
      whileTap={!disabled && !reducedMotion ? { scale: 0.97, filter: "brightness(1.35)" } : undefined}
      whileHover={!disabled && !reducedMotion ? { filter: "brightness(1.15)" } : undefined}
      disabled={disabled}
      {...props}
    >
      {children}
    </motion.button>
  );
}
