import * as RPopover from "@radix-ui/react-popover";
import { type ReactNode } from "react";

export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export const PopoverClose = RPopover.Close;
export const PopoverAnchor = RPopover.Anchor;

export function PopoverContent({
  children,
  align = "start",
  className = "",
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <RPopover.Portal>
      <RPopover.Content
        align={align}
        sideOffset={6}
        className={`z-50 rounded-xl border border-line bg-elevated p-3 shadow-lg outline-none ${className}`}
      >
        {children}
      </RPopover.Content>
    </RPopover.Portal>
  );
}
