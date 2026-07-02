import { type CSSProperties, type ReactNode } from "react";

export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface shadow-sm ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        connected
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          : "bg-hover text-muted"
      }`}
    >
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}
