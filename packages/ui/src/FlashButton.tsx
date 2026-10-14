import type { FlashButtonProps } from "./types";

export function FlashButton({
  children,
  variant = "primary",
  className = "",
  disabled,
  ...props
}: FlashButtonProps) {
  return (
    <button
      className={`flash-button flash-button--${variant} ${className}`.trim()}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
