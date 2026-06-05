// ui/src/components/Spinner.tsx
import clsx from "clsx";

interface SpinnerProps {
  size?: "sm" | "lg";
  className?: string;
}

export function Spinner({ size = "sm", className }: SpinnerProps) {
  return <span className={clsx("spinner", size === "lg" && "lg", className)} role="status" aria-label="Loading" />;
}

/** Full-area loading state for a panel/view. */
export function LoadingFill({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="center-fill">
      <Spinner size="lg" />
      <span className="text-sm muted">{label}</span>
    </div>
  );
}
