import type { MouseEventHandler, HTMLAttributes, ReactNode } from "react";

export interface GlassCardProps {
  children: ReactNode;
  glowColor?: "orange" | "green" | "red" | "none";
  flashOnUpdate?: boolean;
  className?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export interface FlashButtonProps {
  children: ReactNode;
  variant?: "primary" | "success" | "danger";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

export interface GlowBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: "orange" | "green" | "red" | "neutral";
}
