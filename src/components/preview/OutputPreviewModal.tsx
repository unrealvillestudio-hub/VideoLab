export const OutputPreviewModal = ({ isOpen, onClose, content }: any) => (
  isOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="max-w-5xl w-full p-4">
        <button onClick={onClose} className="absolute top-4 right-4 text-white">X</button>
        {content}
      </div>
    </div>
  ) : null
);
