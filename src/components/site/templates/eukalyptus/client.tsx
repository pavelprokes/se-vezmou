"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

/**
 * Klientské části šablony Eukalyptus: navigace s aktivní sekcí, ukotvené tlačítko „Potvrdit účast“ a zavíratelný
 * pruh rychlé změny. Bez JavaScriptu fungují jako obyčejné odkazy a text (navigace bez zvýraznění, tlačítko
 * stále vidět, pruh nezavíratelný). Posouvá se oknem, sledování sekcí je `IntersectionObserver` bez `root`.
 */

export interface NavItem {
  anchor: string;
  label: string;
}

/** Odsazení pro určení aktivní sekce (pás ve třetině výšky okna). */
const ACTIVE_MARGIN = "-35% 0px -60% 0px";

export function EuNav({
  items,
  label,
  monogram,
  topLabel,
  onPhoto,
  children,
}: {
  items: NavItem[];
  label: string;
  /** Iniciály páru (dekor odkazu na začátek). */
  monogram: string;
  topLabel: string;
  /** Úvod má fotku: navigace nad ní je světlá. */
  onPhoto: boolean;
  /** Přepínač jazyka (jen s více jazyky webu). */
  children?: ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const links = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const targets = items
      .map((item) => document.getElementById(item.anchor))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: ACTIVE_MARGIN },
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [items]);

  // Na úzké obrazovce se pruh odkazů posune tak, aby byl aktivní odkaz vidět (posouvá se jen pruh, ne stránka).
  useEffect(() => {
    const bar = links.current;
    const link = bar?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!bar || !link || bar.scrollWidth <= bar.clientWidth) return;
    bar.scrollTo({ left: link.offsetLeft - bar.clientWidth / 2 + link.offsetWidth / 2 });
  }, [active]);

  return (
    <header
      className="eu-nav"
      data-scrolled={scrolled ? "true" : undefined}
      data-on-photo={onPhoto && !scrolled ? "true" : undefined}
    >
      <div className="eu-nav-inner">
        <a href="#obsah" className="eu-monogram" aria-label={topLabel}>
          <span aria-hidden="true">{monogram}</span>
        </a>
        <nav ref={links} aria-label={label} className="eu-nav-links">
          <ul>
            {items.map((item) => (
              <li key={item.anchor}>
                <a
                  href={`#${item.anchor}`}
                  className="eu-nav-link"
                  aria-current={active === item.anchor ? "location" : undefined}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {children}
      </div>
    </header>
  );
}

const FIELD = "input, select, textarea";

/**
 * Ukotvené tlačítko „Potvrdit účast“. Schová se, když je sekce potvrzení vidět nebo když host píše do pole
 * (na mobilu by překrylo klávesnici); schované tlačítko není v pořadí tabulátoru ani pro čtečky.
 */
export function EuStickyCta({
  target,
  label,
  regionLabel,
}: {
  target: string;
  label: string;
  regionLabel: string;
}) {
  const [inView, setInView] = useState(false);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const section = document.getElementById(target);
    if (!section || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(section);
    return () => observer.disconnect();
  }, [target]);

  useEffect(() => {
    const onFocus = (event: FocusEvent) =>
      setTyping(event.target instanceof Element && event.target.matches(FIELD));
    const onBlur = () => setTyping(false);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  const hide = inView || typing;
  return (
    <aside
      className="eu-sticky"
      aria-label={regionLabel}
      data-hidden={hide ? "true" : undefined}
      aria-hidden={hide || undefined}
    >
      <a href={`#${target}`} className="eu-btn eu-btn-sticky" tabIndex={hide ? -1 : undefined}>
        {label}
      </a>
    </aside>
  );
}

const NOTICE_KEY = "sv-notice";

function readNotice(): string | null {
  try {
    return window.sessionStorage.getItem(NOTICE_KEY);
  } catch {
    // úložiště nemusí být k dispozici (soukromé okno); pruh pak zůstane
    return null;
  }
}

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Pruh rychlé změny nad navigací; zavření si pamatuje karta prohlížeče (jen pro stejný text). */
export function EuNoticeBar({
  text,
  lang,
  label,
  closeLabel,
}: {
  text: string;
  lang?: string;
  label: string;
  closeLabel: string;
}) {
  // Zavření z dřívějška (stejná karta prohlížeče); na serveru a při hydrataci vždy otevřeno.
  const stored = useSyncExternalStore(subscribeStorage, readNotice, () => null);
  const [dismissed, setDismissed] = useState(false);
  const closed = dismissed || stored === text;

  if (closed) return null;
  return (
    <aside className="eu-notice" aria-label={label}>
      <p role="status" lang={lang}>
        {text}
      </p>
      <button
        type="button"
        className="eu-notice-close"
        aria-label={closeLabel}
        onClick={() => {
          try {
            window.sessionStorage.setItem(NOTICE_KEY, text);
          } catch {
            // bez úložiště se pruh zavře jen do obnovení stránky
          }
          setDismissed(true);
          document.getElementById("obsah")?.focus();
        }}
      >
        <Icon icon={X} />
      </button>
    </aside>
  );
}
