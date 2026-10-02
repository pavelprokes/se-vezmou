import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { ButtonElement } from "./button-element";

/**
 * Tlačítka: hlavní (plná plocha), vedlejší (obrys) a textové (podtržené).
 * Zaoblení 10 px, cíl dotyku alespoň 44 px (WCAG 2.5.8), viditelný focus řeší `globals.css`.
 * `buttonVariants` jde použít i na odkaz (`<a className={buttonVariants({...})}>`).
 */
export const buttonVariants = cva(
  [
    "inline-flex min-h-target min-w-target cursor-pointer items-center justify-center gap-2",
    "rounded-button border-2 px-5 py-2 text-base leading-snug font-medium",
    "transition-colors motion-reduce:transition-none",
    "disabled:cursor-not-allowed disabled:border-linen disabled:bg-linen disabled:text-muted",
    "aria-disabled:cursor-not-allowed aria-disabled:border-linen aria-disabled:bg-linen aria-disabled:text-muted",
  ],
  {
    variants: {
      variant: {
        primary: "border-pine bg-pine text-parchment hover:border-ink hover:bg-ink",
        secondary: "border-pine bg-transparent text-pine hover:bg-linen",
        text: "border-transparent bg-transparent px-3 text-pine underline underline-offset-4 hover:bg-linen",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: { variant: "primary", fullWidth: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

/**
 * `disabled` se vykreslí jako `aria-disabled` s hlídáním kliknutí (viz `ButtonElement`), aby
 * tlačítko při odesílání neztratilo zaměření z klávesnice.
 */
export function Button({ variant, fullWidth, className, type = "button", ...props }: ButtonProps) {
  return (
    <ButtonElement
      type={type}
      className={cn(buttonVariants({ variant, fullWidth }), className)}
      {...props}
    />
  );
}
