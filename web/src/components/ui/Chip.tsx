export function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm transition outline-none focus-visible:ring-2 focus-visible:ring-brand-100 motion-reduce:transition-none ${
        active
          ? "border-brand-600 bg-brand-50 text-brand-700"
          : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
      }`}
    >
      {label}
    </button>
  );
}
