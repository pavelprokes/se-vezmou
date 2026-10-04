"use client";

import { useEffect } from "react";

/**
 * Posouvací navigace webu páru: odkaz, na který přejde zaměření klávesnicí, se posune do pohledu celý
 * (prohlížeč zčásti viditelný prvek neposouvá a zůstal by pod prolnutím u okraje). Okraj určuje
 * `scroll-padding-inline` v site.css.
 */
export function NavFocusScroll({ selector }: { selector: string }) {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(selector);
    if (!nav) return;
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) {
        event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    nav.addEventListener("focusin", onFocus);
    return () => nav.removeEventListener("focusin", onFocus);
  }, [selector]);
  return null;
}
