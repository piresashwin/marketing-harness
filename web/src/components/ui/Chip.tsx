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
          ? "border-accent-line bg-accent-soft text-accent-soft-fg"
          : "border-line-strong bg-surface text-muted hover:border-faint hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
