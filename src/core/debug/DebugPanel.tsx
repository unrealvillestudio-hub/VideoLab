import { Terminal } from 'lucide-react';

export const DebugPanel = () => (
  <div className="fixed bottom-4 left-4 z-50">
    <button className="p-2 bg-zinc-900 border border-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors">
      <Terminal size={16} />
    </button>
  </div>
);
