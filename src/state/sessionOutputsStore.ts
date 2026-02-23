import { create } from 'zustand';
import { SessionOutput } from '../core/types';

interface SessionStore {
  activeOutputs: SessionOutput[];
  addSessionOutput: (output: SessionOutput) => void;
  updateSessionOutput: (id: string, updates: Partial<SessionOutput>) => void;
}

export const useSessionOutputsStore = create<SessionStore>((set) => ({
  activeOutputs: [],
  addSessionOutput: (output) => set((state) => ({ activeOutputs: [...state.activeOutputs, output] })),
  updateSessionOutput: (id, updates) => set((state) => ({
    activeOutputs: state.activeOutputs.map((o) => o.id === id ? { ...o, ...updates } : o)
  })),
}));
