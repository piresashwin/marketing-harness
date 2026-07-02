import * as RDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode } from "react";

/**
 * Immersive, edge-to-edge modal built on Radix Dialog: opaque full-viewport
 * surface with a sticky header (eyebrow + title + close, plus optional
 * `headerActions`), a scrollable body, and an optional sticky `footer` (e.g.
 * stepper navigation). Behaviour — focus trap, Esc to close, scroll lock — comes
 * from Radix; styling is ours via semantic tokens.
 *
 * Reusable for any take-over flow (profile editor, composer, wizards). The body
 * controls its own width/padding so callers can be as spacious as they like.
 */
export function FullScreenDialog({
  open,
  onOpenChange,
  title,
  description,
  eyebrow,
  headerActions,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required for accessibility — labels the dialog. Shown in the header. */
  title: string;
  description?: string;
  eyebrow?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-canvas/70 backdrop-blur-sm" />
        <RDialog.Content className="fixed inset-0 z-50 flex flex-col bg-canvas outline-none animate-fade-up">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface/80 px-4 py-3 backdrop-blur md:px-8">
            <div className="min-w-0">
              {eyebrow && (
                <div className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
                  {eyebrow}
                </div>
              )}
              <RDialog.Title className="truncate text-lg font-semibold leading-tight text-ink">
                {title}
              </RDialog.Title>
              {description && (
                <RDialog.Description className="truncate text-xs text-faint">
                  {description}
                </RDialog.Description>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              {headerActions}
              <RDialog.Close
                aria-label="Close"
                className="grid h-9 w-9 place-items-center rounded-lg text-faint outline-none transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-100"
              >
                <X className="h-5 w-5" />
              </RDialog.Close>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">{children}</div>

          {footer && (
            <footer className="shrink-0 border-t border-line bg-surface/80 px-4 py-3 backdrop-blur md:px-8">
              {footer}
            </footer>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
