import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  glowColor?: "orange" | "green" | "red" | "none";
  flashOnUpdate?: boolean;
}

export interface FlashButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "success" | "danger";
}

export interface GlowBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: "orange" | "green" | "red" | "neutral";
}
