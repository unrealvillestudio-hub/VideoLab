export const LibraryGrid = ({ items }: any) => (
  <div className="grid grid-cols-2 gap-2">
    {items.map((item: any) => (
      <div key={item.id} className="aspect-square bg-zinc-800 rounded-lg overflow-hidden border border-zinc-700">
        <img src={item.url} className="w-full h-full object-cover" />
      </div>
    ))}
  </div>
);
