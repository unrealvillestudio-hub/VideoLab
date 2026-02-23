import { Info } from 'lucide-react';

export const ModuleTips = ({ tip }: { tip: string }) => (
  <div className="p-3 bg-blue-900/10 border border-blue-900/20 rounded-lg flex gap-3">
    <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
    <p className="text-xs text-blue-200/70 leading-relaxed">{tip}</p>
  </div>
);
