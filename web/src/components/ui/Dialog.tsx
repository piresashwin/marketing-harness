import * as RDialog from "@radix-ui/react-dialog";
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
      <RDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px]" />
      <RDialog.Content
        className={`fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl outline-none focus:outline-none ${className}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <RDialog.Title className="text-lg font-semibold text-slate-900">
              {title}
            </RDialog.Title>
            {description && (
              <RDialog.Description className="mt-1 text-sm text-slate-500">
                {description}
              </RDialog.Description>
            )}
          </div>
          <RDialog.Close
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-100"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </RDialog.Close>
        </div>
        {children}
      </RDialog.Content>
    </RDialog.Portal>
  );
}
