import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...rest }, ref) => (
    <input ref={ref} className={`${inputCls} ${className}`} {...rest} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = "", rows = 3, ...rest }, ref) => (
  <textarea ref={ref} rows={rows} className={`${inputCls} ${className}`} {...rest} />
));
Textarea.displayName = "Textarea";
