import { CircleAlert } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** Viditelný popisek (WCAG 3.3.2). Placeholder popisek nenahrazuje. */
  label: ReactNode;
  hint?: ReactNode;
  /** Chybová zpráva; pole se označí `aria-invalid` a zpráva se připojí přes `aria-describedby`. */
  error?: ReactNode;
  id?: string;
}

/** Textové pole s popiskem, nápovědou a chybou. Chyba je text s ikonou, ne jen barva (WCAG 1.4.1). */
export function Field({ label, hint, error, id, className, ...input }: FieldProps) {
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
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          "min-h-target rounded-button bg-parchment text-ink w-full border-2 px-3 py-2 text-base",
          error ? "border-cinnamon-deep" : "border-field-border",
        )}
        {...input}
      />
      {/* Oblast zůstává v DOM, aby čtečky novou chybu oznámily. */}
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

export interface FieldsetProps {
  legend: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Skupina voleb (přepínače) s popiskem skupiny. */
export function Fieldset({ legend, error, children, className }: FieldsetProps) {
  const errorId = useId();
  return (
    <fieldset
      className={cn("flex flex-col gap-1", className)}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="text-ink mb-1 font-medium">{legend}</legend>
      {children}
      <div aria-live="polite">
        {error ? (
          <p id={errorId} className="text-cinnamon-deep flex items-start gap-2 text-sm font-medium">
            <Icon icon={CircleAlert} size={18} className="mt-0.5" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
