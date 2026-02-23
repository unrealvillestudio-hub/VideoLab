export const PromptWindow = ({ value, onChange }: any) => (
  <textarea 
    className="w-full h-32 bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-all resize-none"
    placeholder="Describe the scene..."
    value={value}
    onChange={(e) => onChange(e.target.value)}
  />
);
