export const GalleryItem = ({ url }: any) => (
  <div className="aspect-square bg-zinc-800 rounded-xl overflow-hidden border border-zinc-700">
    <img src={url} className="w-full h-full object-cover" />
  </div>
);
