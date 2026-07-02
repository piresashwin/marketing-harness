import { useId, type ReactNode } from "react";

/**
 * Labelled field wrapper. Clones a label/control association via htmlFor + the
 * `id` passed through render-prop so screen readers announce the label.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="block">
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-ink"
      >
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="mt-1 text-xs text-faint">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
