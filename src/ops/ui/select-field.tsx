import { CircleAlert } from "lucide-react";
import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  /** Viditelný popisek (WCAG 3.3.2). */
  label: ReactNode;
  options: readonly SelectOption[];
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
}

/** Výběr z nabídky se stejným popiskem, nápovědou a chybou jako `Field`; cíl dotyku alespoň 44 px. */
export function SelectField({
  label,
  options,
  hint,
  error,
  id,
  className,
  ...select
}: SelectFieldProps) {
  const generated = useId();
  const selectId = id ?? generated;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={selectId} className="text-ink font-medium">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-muted text-sm">
          {hint}
        </p>
      ) : null}
      <select
        // React po změně `defaultValue` výběr po resetu formuláře neobnoví; nový klíč prvek znovu vytvoří
        // (jinak by se po chybě formuláře vrátil výběr na první položku).
        key={String(select.defaultValue ?? "")}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          "min-h-target rounded-button bg-parchment text-ink w-full border-2 px-3 py-2 text-base",
          error ? "border-cinnamon-deep" : "border-field-border",
        )}
        {...select}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
