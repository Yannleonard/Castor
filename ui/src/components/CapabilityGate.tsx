// ui/src/components/CapabilityGate.tsx
//
// The single component implementing ADR-002's grey-out-before-click rule.
//
// A write affordance is rendered ENABLED only when BOTH:
//   - the owning provider advertises the required capability, AND
//   - the current user holds the required permission.
// Otherwise the child is rendered DISABLED with a tooltip explaining why —
// never "click then 405".
//
// Usage:
//   <CapabilityGate gate={gateWorkloadAction("stop", kind, caps, perms)}>
//     {(allowed, reason) => <ActionButton ... disabled={!allowed} tooltip={reason} />}
//   </CapabilityGate>
//
// Or with explicit allowed/reason props.

import type { ReactNode } from "react";
import type { GateResult } from "../lib/rbac";

interface Props {
  gate?: GateResult;
  allowed?: boolean;
  reason?: string;
  children: (allowed: boolean, reason: string) => ReactNode;
}

export function CapabilityGate({ gate, allowed, reason, children }: Props) {
  const ok = gate ? gate.allowed : !!allowed;
  const why = gate ? gate.reason : reason ?? "";
  return <>{children(ok, why)}</>;
}
