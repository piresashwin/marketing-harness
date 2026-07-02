import * as RDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode } from "react";

export const Dialog = RDialog.Root;
export const DialogTrigger = RDialog.Trigger;
export const DialogClose = RDialog.Close;

export function DialogContent({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RDialog.Portal>
      <RDialog.Overlay className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[1px]" />
      <RDialog.Content
        className={`fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-elevated p-6 shadow-xl outline-none focus:outline-none ${className}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <RDialog.Title className="text-lg font-semibold text-ink">
              {title}
            </RDialog.Title>
            {description && (
              <RDialog.Description className="mt-1 text-sm text-muted">
                {description}
              </RDialog.Description>
            )}
          </div>
          <RDialog.Close
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-faint outline-none transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-100"
          >
            <X className="h-4 w-4" />
          </RDialog.Close>
        </div>
        {children}
      </RDialog.Content>
    </RDialog.Portal>
  );
}
