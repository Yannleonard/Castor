// ui/src/views/marketplace/DeployedInstances.test.tsx
// Unit + render coverage for the marketplace "deployed instances" affordance:
//   • groupBySlug — the pure page-level grouping used to count per template.
//   • DeployedBadge — hidden at zero, clickable and firing onOpen otherwise.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { groupBySlug, DeployedBadge, LABEL_TEMPLATE } from "./DeployedInstances";
import type { Workload } from "../../lib/types";

function wl(id: string, slug: string | undefined, extra: Partial<Workload> = {}): Workload {
  return {
    id,
    name: id,
    kind: "docker",
    providerId: "docker-local",
    state: "running",
    image: "nginx:latest",
    labels: slug ? { [LABEL_TEMPLATE]: slug } : {},
    createdAt: "2026-07-01T00:00:00Z",
    protected: false,
    ...extra,
  };
}

describe("groupBySlug", () => {
  it("returns an empty map for undefined/empty input", () => {
    expect(groupBySlug(undefined).size).toBe(0);
    expect(groupBySlug([]).size).toBe(0);
  });

  it("groups workloads by their io.castor.template slug", () => {
    const map = groupBySlug([
      wl("a", "nginx"),
      wl("b", "nginx"),
      wl("c", "postgres"),
    ]);
    expect(map.get("nginx")?.length).toBe(2);
    expect(map.get("postgres")?.length).toBe(1);
    expect([...map.keys()].sort()).toEqual(["nginx", "postgres"]);
  });

  it("ignores workloads without the template label (missing or empty)", () => {
    const map = groupBySlug([
      wl("a", "nginx"),
      wl("b", undefined),
      wl("c", "", { labels: { [LABEL_TEMPLATE]: "" } }),
    ]);
    expect(map.size).toBe(1);
    expect(map.get("nginx")?.length).toBe(1);
  });
});

describe("DeployedBadge", () => {
  it("renders nothing when the count is zero", () => {
    const { container } = render(<DeployedBadge count={0} onOpen={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the count and fires onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(<DeployedBadge count={3} onOpen={onOpen} />);
    const btn = screen.getByRole("button", { name: /3 deployed/i });
    btn.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
