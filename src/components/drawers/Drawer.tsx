export const Drawer = ({ isOpen, children }: any) => (
  <div className={`fixed inset-y-0 right-0 w-80 bg-zinc-900 border-l border-zinc-800 transform transition-transform ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
    {children}
  </div>
);
