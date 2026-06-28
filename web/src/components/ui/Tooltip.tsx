import * as RTooltip from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={250} skipDelayDuration={300}>
      {children}
    </RTooltip.Provider>
  );
}

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-md"
        >
          {label}
          <RTooltip.Arrow className="fill-slate-900" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
