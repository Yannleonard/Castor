import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../lib/api";
import { Hosts } from "./Hosts";

const mocks = vi.hoisted(() => ({
  hosts: vi.fn(),
  providers: vi.fn(),
  host: vi.fn(),
  createAgentHost: vi.fn(),
  downloadAgent: vi.fn(),
  revokeAgentHost: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      hosts: mocks.hosts,
      providers: mocks.providers,
      host: mocks.host,
      createAgentHost: mocks.createAgentHost,
      downloadAgent: mocks.downloadAgent,
      revokeAgentHost: mocks.revokeAgentHost,
    },
  };
});

function renderHosts() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Hosts />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Hosts remote agent lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("crypto", { ...crypto, subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
    mocks.hosts.mockResolvedValue([{
      id: "edge-a", name: "Edge A", kind: "docker", connection: "remote-agent", status: "connected",
      providerIds: ["edge-a"], degraded: false,
      engine: { engineVersion: "27", apiVersion: "1.47", os: "linux", osType: "linux", osVersion: "", kernelVersion: "", architecture: "amd64", ncpu: 4, memTotalBytes: 1024, containers: 1, containersRunning: 1, containersPaused: 0, containersStopped: 0, images: 1, name: "edge-a", swarmActive: false },
    }]);
    mocks.providers.mockResolvedValue([{ id: "edge-a", kind: "docker", capabilities: ["list"] }]);
    mocks.host.mockResolvedValue({ id: "edge-a", name: "Edge A", kind: "docker", connection: "remote-agent", status: "connected", providerIds: ["edge-a"], degraded: false, summary: { containers: 1, running: 1, images: 1, networks: 0, volumes: 0, swarmTasks: 0, k8sPods: 0 } });
    mocks.downloadAgent.mockResolvedValue({ arrayBuffer: async () => new TextEncoder().encode("agent-binary").buffer } as Blob);
    mocks.createAgentHost.mockResolvedValue({ hostId: "edge-b", name: "Edge B", enrollmentToken: "one-time-secret", expiresInSeconds: 600 });
    mocks.revokeAgentHost.mockResolvedValue(undefined);
  });

  it("downloads selected architecture and shows the locally calculated checksum", async () => {
    renderHosts();
    fireEvent.click(await screen.findByRole("button", { name: "Add remote host" }));
    fireEvent.change(screen.getByLabelText("Host name"), { target: { value: "Edge B" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add remote host" })[1]);
    expect(await screen.findByLabelText("One-time enrollment token")).toHaveValue("one-time-secret");
    fireEvent.change(screen.getByLabelText("Linux architecture"), { target: { value: "arm64" } });
    fireEvent.click(screen.getByRole("button", { name: "Download Linux agent" }));
    await waitFor(() => expect(api.downloadAgent).toHaveBeenCalledWith("arm64"));
    await waitFor(() => expect(screen.getByLabelText("Agent install command").getAttribute("value") ?? (screen.getByLabelText("Agent install command") as HTMLTextAreaElement).value).toContain("sha256sum -c -"));
  });

  it("enables workloads only for a connected host and revokes after confirmation", async () => {
    renderHosts();
    const open = await screen.findByRole("button", { name: /Open workloads/i });
    expect(open).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke agent" }));
    await waitFor(() => expect(api.revokeAgentHost).toHaveBeenCalledWith("edge-a"));
  });
});
