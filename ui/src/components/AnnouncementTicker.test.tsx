import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { AnnouncementTicker } from "./AnnouncementTicker";

vi.mock("../lib/langStore", () => ({ useLang: () => "en" }));

function renderTicker() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AnnouncementTicker /></QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("AnnouncementTicker", () => {
  it("renders an active announcement and a safe external link", async () => {
    vi.spyOn(api, "currentAnnouncement").mockResolvedValue({
      id: "update-1", kind: "update", title: "Castor 2", message: "Release notes are ready",
      link: "https://example.com/releases", updatedAt: "2026-01-01T00:00:00Z",
    });
    renderTicker();
    const link = await screen.findByRole("link", { name: /Castor 2.*Release notes are ready/ });
    expect(link).toHaveAttribute("href", "https://example.com/releases");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("RELEASE")).toBeInTheDocument();
  });

  it("renders nothing when no announcement is currently published", async () => {
    vi.spyOn(api, "currentAnnouncement").mockResolvedValue(null);
    const { container } = renderTicker();
    await screen.findByText(/never-to-be-rendered/).catch(() => undefined);
    expect(container.querySelector(".announcement-ticker")).toBeNull();
  });
});
