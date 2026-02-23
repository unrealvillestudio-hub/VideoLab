import { Play, Loader2 } from 'lucide-react';

export const RunControlButton = ({ isLoading, onClick, label = 'GENERATE' }: any) => (
  <button 
    onClick={onClick}
    disabled={isLoading}
    className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
  >
    {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
    {isLoading ? 'GENERATING...' : label}
  </button>
);
