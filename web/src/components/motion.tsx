import {
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

/**
 * Per-item entrance delay for staggered list / grid reveals. Apply alongside the
 * `animate-fade-up` utility on each mapped item:
 *
 *   {items.map((it, i) => (
 *     <li key={it.id} className="animate-fade-up" style={staggerStyle(i)}>…</li>
 *   ))}
 *
 * The index is capped so long lists don't accumulate a multi-second tail — past
 * the cap everything lands together. Honors reduced-motion via the global guard
 * in index.css (delays are forced to 0 there).
 */
export function staggerStyle(
  index: number,
  { step = 65, base = 0, cap = 14 }: { step?: number; base?: number; cap?: number } = {},
): CSSProperties {
  return { animationDelay: `${base + Math.min(index, cap) * step}ms` };
}

/**
 * Fade-and-rise an element in on mount. Pass `index` for a staggered list item,
 * or `delay` (ms) for an explicit offset. Renders a `div` unless `as` overrides
 * the element (e.g. `as="li"` inside a `<ul>`).
 */
export function Reveal({
  as,
  index,
  delay,
  className = "",
  style,
  children,
}: {
  as?: ElementType;
  index?: number;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const Tag = as ?? "div";
  const ms = delay ?? (index != null ? Math.min(index, 14) * 65 : 0);
  return (
    <Tag
      className={`animate-fade-up ${className}`}
      style={{ animationDelay: `${ms}ms`, ...style }}
    >
      {children}
    </Tag>
  );
}
