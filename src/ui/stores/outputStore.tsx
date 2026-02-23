import { create } from 'zustand';

interface Output {
  id: string;
  type: 'video' | 'image';
  url: string;
  prompt: string;
  timestamp: number;
  metadata?: any;
}

interface OutputStore {
  outputs: Output[];
  addOutput: (output: Output) => void;
  removeOutput: (id: string) => void;
  clearOutputs: () => void;
}

export const useOutputStore = create<OutputStore>((set) => ({
  outputs: [],
  addOutput: (output) => set((state) => ({ outputs: [output, ...state.outputs] })),
  removeOutput: (id) => set((state) => ({ outputs: state.outputs.filter((o) => o.id !== id) })),
  clearOutputs: () => set({ outputs: [] }),
}));
