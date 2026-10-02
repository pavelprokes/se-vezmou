import { CircleAlert } from "lucide-react";
import { useId, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  /** Viditelný popisek (WCAG 3.3.2). */
  label: ReactNode;
  hint?: ReactNode;
  /** Chybová zpráva; pole se označí `aria-invalid` a zpráva se připojí přes `aria-describedby`. */
  error?: ReactNode;
  id?: string;
}

/** Víceřádkové pole se stejným popiskem, nápovědou a chybou jako `Field`. */
export function TextArea({ label, hint, error, id, className, rows = 3, ...input }: TextAreaProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-ink font-medium">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-muted text-sm">
          {hint}
        </p>
      ) : null}
      <textarea
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          "min-h-target rounded-button bg-parchment text-ink w-full resize-y border-2 px-3 py-2 text-base",
          error ? "border-cinnamon-deep" : "border-field-border",
        )}
        {...input}
      />
      <div aria-live="polite">
        {error ? (
          <p id={errorId} className="text-cinnamon-deep flex items-start gap-2 text-sm font-medium">
            <Icon icon={CircleAlert} size={18} className="mt-0.5" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
