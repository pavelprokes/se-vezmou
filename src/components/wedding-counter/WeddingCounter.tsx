"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_YEARLY_WEDDINGS,
  acceleratedTime,
  weddingsSinceNewYear,
} from "@/lib/wedding-count";
import styles from "./WeddingCounter.module.css";

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>;

export interface WeddingCounterProps {
  /** Počet svateb za rok. Výchozí: DEFAULT_YEARLY_WEDDINGS (42 500, ČSÚ 2025). */
  yearlyWeddings?: number;
  /** Zrychlení času. 60 = 1 sekunda je 1 minuta (výchozí), 1 = reálný čas. */
  speed?: number;
  /** Písmena v kolečkách. */
  initials?: [string, string, string];
  /** Text pod číslem (z překladů). */
  label?: string;
  /** Jednotka za číslem: řetězec, nebo tvary podle množného čísla (z překladů). */
  unit?: string | PluralForms;
  /** Jazyk pro formátování čísla a množné číslo. */
  locale?: string;
  className?: string;
}

const DEFAULT_UNIT: PluralForms = { one: "pár", few: "páry", other: "párů" };

export function WeddingCounter({
  yearlyWeddings = DEFAULT_YEARLY_WEDDINGS,
  speed = 60,
  initials = ["P", "A", "J"],
  label = "už letos řeklo své ano",
  unit = DEFAULT_UNIT,
  locale = "cs-CZ",
  className,
}: WeddingCounterProps) {
  // Číslo závisí na aktuálním čase, proto se počítá až v prohlížeči.
  // Na serveru je null, aby nevznikla hydration chyba.
  const [count, setCount] = useState<number | null>(null);

  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const pluralRules = useMemo(() => new Intl.PluralRules(locale), [locale]);

  useEffect(() => {
    const startedAt = Date.now();
    const compute = () =>
      weddingsSinceNewYear(acceleratedTime(startedAt, Date.now(), speed), yearlyWeddings);
    const first = window.setTimeout(() => setCount(compute()), 0);
    const id = window.setInterval(() => setCount(compute()), 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [yearlyWeddings, speed]);

  const shown = count ?? 0;
  const unitText =
    typeof unit === "string" ? unit : (unit[pluralRules.select(shown)] ?? unit.other ?? "");

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      <div className={styles.avatars} aria-hidden="true">
        {initials.map((letter, i) => (
          <span key={i}>{letter}</span>
        ))}
      </div>
      <div className={styles.text}>
        {/* Před načtením v prohlížeči je text neviditelný, ale drží místo (bez poskoku layoutu). */}
        <strong className={count === null ? styles.pending : undefined}>
          {numberFormat.format(shown)} {unitText}
        </strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

export default WeddingCounter;
