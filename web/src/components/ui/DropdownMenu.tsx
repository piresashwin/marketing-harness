import * as RMenu from "@radix-ui/react-dropdown-menu";
import { type ComponentPropsWithoutRef, type ReactNode } from "react";

export const DropdownMenu = RMenu.Root;
export const DropdownMenuTrigger = RMenu.Trigger;
export const DropdownMenuSeparator = () => (
  <RMenu.Separator className="my-1 h-px bg-line" />
);

export function DropdownMenuContent({
  children,
  align = "start",
  className = "",
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <RMenu.Portal>
      <RMenu.Content
        align={align}
        sideOffset={6}
        className={`z-50 min-w-[14rem] rounded-xl border border-line bg-elevated p-1.5 shadow-lg outline-none ${className}`}
      >
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}

export function DropdownMenuItem({
  children,
  className = "",
  ...rest
}: ComponentPropsWithoutRef<typeof RMenu.Item>) {
  return (
    <RMenu.Item
      className={`flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </RMenu.Item>
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <RMenu.Label className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-faint">
      {children}
    </RMenu.Label>
  );
}
