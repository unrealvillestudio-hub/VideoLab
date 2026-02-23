export const DrawerHeader = ({ title, onClose }: any) => (
  <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
    <h3 className="text-sm font-bold">{title}</h3>
    <button onClick={onClose} className="text-zinc-500 hover:text-white">X</button>
  </div>
);
