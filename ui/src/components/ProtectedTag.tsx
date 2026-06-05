// ui/src/components/ProtectedTag.tsx
import { IconLock } from "./icons";

interface Props {
  title?: string;
}

/** Beaver-brown lock tag marking system/Castor-own protected workloads. */
export function ProtectedTag({ title }: Props) {
  return (
    <span
      className="pill"
      style={{
        color: "var(--state-protected)",
        background: "rgba(139,94,60,0.16)",
        borderColor: "transparent",
      }}
      title={title || "Protected — removal is blocked to prevent accidents"}
    >
      <IconLock size={12} />
      Protected
    </span>
  );
}
