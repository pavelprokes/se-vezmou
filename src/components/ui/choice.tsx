import { Check } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> {
  label: ReactNode;
}

/** Celý řádek je klikací (min. 44 px), vlastní vzhled stojí na nativním prvku. */
function Choice({
  label,
  className,
  type,
  ...input
}: ChoiceProps & { type: "checkbox" | "radio" }) {
  const round = type === "radio";
  return (
    <label
      className={cn(
        "min-h-target text-ink has-disabled:text-muted flex cursor-pointer items-center gap-3 py-1 has-disabled:cursor-not-allowed",
        className,
      )}
    >
      <span className="relative inline-flex size-6 shrink-0 items-center justify-center">
        <input
          type={type}
          className={cn(
            "peer border-field-border bg-parchment size-6 cursor-[inherit] appearance-none border-2",
            "checked:border-pine checked:bg-pine",
            round ? "rounded-full" : "rounded-md",
          )}
          {...input}
        />
        {round ? (
          <span
            aria-hidden="true"
            className="bg-parchment pointer-events-none absolute size-2.5 rounded-full opacity-0 peer-checked:opacity-100"
          />
        ) : (
          <Icon
            icon={Check}
            size={16}
            className="text-parchment pointer-events-none absolute opacity-0 peer-checked:opacity-100"
          />
        )}
      </span>
      <span>{label}</span>
    </label>
  );
}

export type CheckboxProps = ChoiceProps;

export function Checkbox(props: CheckboxProps) {
  return <Choice type="checkbox" {...props} />;
}

export type RadioProps = ChoiceProps;

/** Přepínače se stejným `name` tvoří skupinu; obal je `Fieldset` s legendou. */
export function Radio(props: RadioProps) {
  return <Choice type="radio" {...props} />;
}
