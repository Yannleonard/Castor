// ui/src/components/ActionButton.tsx
// A button that, when disabled, still shows a tooltip explaining why
// (wrapping in a span because disabled buttons swallow title on some browsers).

import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  tooltip?: string;
  variant?: "default" | "primary" | "success" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  iconOnly?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

export function ActionButton({
  tooltip,
  variant = "default",
  size = "md",
  iconOnly,
  loading,
  disabled,
  children,
  className,
  ...rest
}: Props) {
  const btn = (
    <button
      className={clsx(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "success" && "btn-success",
        variant === "danger" && "btn-danger",
        variant === "ghost" && "btn-ghost",
        size === "sm" && "btn-sm",
        size === "lg" && "btn-lg",
        iconOnly && "btn-icon",
        className,
      )}
      disabled={disabled || loading}
      title={!disabled ? tooltip : undefined}
      aria-disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner /> : children}
    </button>
  );

  // When disabled, wrap so the tooltip still appears on hover.
  if (disabled && tooltip) {
    return (
      <span title={tooltip} style={{ display: "inline-flex" }}>
        {btn}
      </span>
    );
  }
  return btn;
}
