// ui/src/lib/hostStore.ts
// Selected-host store (V1 always "local", but the switcher is multi-host-ready).
import { create } from "zustand";
import { DEFAULT_HOST } from "./hooks";

interface HostState {
  selectedHostId: string;
  setSelectedHost: (id: string) => void;
}

export const useHostStore = create<HostState>((set) => ({
  selectedHostId: DEFAULT_HOST,
  setSelectedHost: (id) => set({ selectedHostId: id }),
}));

export function useSelectedHost(): string {
  return useHostStore((s) => s.selectedHostId);
}
