// Castor by IT Leonard
// ui/src/components/HelpButton.tsx
//
// Drop-in "? Help" button for any view header. It owns its open/closed state and
// renders the data-driven HelpPanel for the given topic, so a view only needs:
//
//   <PageHeader title="Workloads" actions={<HelpButton topic="workloads" />} />
//
// Variants:
//   - default: a ghost icon button (fits a PageHeader actions row).
//   - "link":  a subtle inline "Need help?" text button (fits empty states).

import { useState } from "react";
import { ActionButton } from "./ActionButton";
import { HelpPanel } from "./HelpPanel";
import { IconHelp } from "./icons";

interface Props {
  /** Registry key of the help card (e.g. "workloads", "swarm", "helm"). */
  topic: string;
  /** Accessible label / tooltip. Defaults to "Help". */
  label?: string;
  /** Visual style. */
  variant?: "icon" | "link";
}

export function HelpButton({ topic, label = "Help", variant = "icon" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "link" ? (
        <button type="button" className="help-link-btn" onClick={() => setOpen(true)}>
          <IconHelp size={15} />
          {label}
        </button>
      ) : (
        <ActionButton
          variant="ghost"
          iconOnly
          tooltip={label}
          aria-label={label}
          onClick={() => setOpen(true)}
        >
          <IconHelp size={16} />
        </ActionButton>
      )}
      <HelpPanel topic={topic} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
