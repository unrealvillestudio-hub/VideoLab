import { create } from 'zustand';

interface LibraryItem {
  id: string;
  name: string;
  url: string;
  type: 'video' | 'image';
  category: string;
}

interface LibraryStore {
  items: LibraryItem[];
  addItem: (item: LibraryItem) => void;
  removeItem: (id: string) => void;
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
  removeItem: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
}));
