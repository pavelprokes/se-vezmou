"use client";

import type { ButtonHTMLAttributes } from "react";

/**
 * Prvek `<button>` s hlídáním zablokovaného stavu. `disabled` se vykreslí jako `aria-disabled`:
 * nativně vypnuté tlačítko ztrácí zaměření (po odeslání formuláře by uživatel s klávesnicí skončil
 * na `body`) a čtečky ho přeskakují. Kliknutí (i implicitní odeslání Enterem v poli) se u
 * zablokovaného tlačítka zahodí. Je to klientská komponenta, protože drží obsluhu kliknutí; `Button`
 * ji ale používá i na serveru (bez `onClick`), tak se nesmí měnit typ prvku podle stavu, jinak by se
 * tlačítko při přepnutí vykreslilo znovu a ztratilo zaměření.
 */
export function ButtonElement({
  disabled,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const blocked =
    Boolean(disabled) || props["aria-disabled"] === true || props["aria-disabled"] === "true";
  return (
    <button
      {...props}
      aria-disabled={blocked || undefined}
      onClick={(event) => {
        if (blocked) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    />
  );
}
