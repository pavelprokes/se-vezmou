"use client";

import { ExternalLink, FileDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { useT } from "./i18n";
import { QrCode } from "./qr-code";

export interface DoneInfo {
  slug: string;
  url: string;
  host: string;
  /** PIN hostů v prostém tvaru, jen pro tuto obrazovku (v databázi je jeho hash). */
  pin: string | null;
}

/** Cesta pro stažení PDF oznámení (POST s PINem, relace správce). */
export const ANNOUNCEMENT_PATH = { cs: "/vytvorit/oznameni", en: "/en/vytvorit/oznameni" } as const;

/**
 * Obrazovka „Hotovo“ po zveřejnění: adresa, QR kód, PIN hostů a PDF oznámení k tisku. PIN se
 * ukazuje jen tady a v PDF: v databázi je jen jeho hash, takže ho nikdo nedohledá. Stránku
 * nahradí správa webu (M7), tlačítko vede do přehledu.
 */
export function Done({ info, uiLocale }: { info: DoneInfo; uiLocale: Locale }) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState<"url" | "pin" | null>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  async function copy(kind: "url" | "pin", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopied(null);
    }
  }

  return (
    <main
      id="obsah"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8"
      data-testid="done"
    >
      <div>
        <h1
          ref={heading}
          tabIndex={-1}
          id="wz-heading"
          className="text-3xl font-medium sm:text-4xl"
        >
          {t("wizard.done.title")}
        </h1>
        <p className="text-muted mt-3 text-lg">{t("wizard.done.intro")}</p>
      </div>

      <Card as="section" aria-labelledby="wz-done-address" className="flex flex-col gap-4">
        <h2 id="wz-done-address" className="text-xl font-medium">
          {t("wizard.done.address")}
        </h2>
        <p className="text-2xl font-semibold break-all" data-testid="done-address">
          {info.host}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={info.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "primary" }))}
            data-testid="done-open"
          >
            {t("wizard.done.open")}
            <Icon icon={ExternalLink} size={18} />
            <span className="sr-only">{t("wizard.done.newWindow")}</span>
          </a>
          <Button variant="secondary" onClick={() => void copy("url", info.url)}>
            {t("wizard.copy")}
          </Button>
          <span role="status" className="text-sm">
            {copied === "url" ? t("wizard.copied") : ""}
          </span>
        </div>
      </Card>

      <Card as="section" aria-labelledby="wz-done-qr" className="flex flex-col gap-4 sm:flex-row">
        <QrCode
          payload={info.url}
          label={t("wizard.done.qrLabel", { address: info.host })}
          className="size-48 shrink-0 self-center rounded-lg sm:self-start"
        />
        <div className="flex flex-col gap-2">
          <h2 id="wz-done-qr" className="text-xl font-medium">
            {t("wizard.done.qr.title")}
          </h2>
          <p>{t("wizard.done.qr.body")}</p>
        </div>
      </Card>

      {info.pin ? (
        <Card as="section" aria-labelledby="wz-done-pin" className="flex flex-col gap-3">
          <h2 id="wz-done-pin" className="text-xl font-medium">
            {t("wizard.done.pin.title")}
          </h2>
          {/* `aria-label` na odstavci čtečky ignorují: vizuální PIN je skrytý a čtečka dostane číslice zvlášť. */}
          <p className="text-3xl font-semibold tracking-widest">
            <span aria-hidden="true" data-testid="done-pin">
              {info.pin}
            </span>
            <span className="sr-only">
              {t("wizard.done.pin.spoken", { pin: info.pin.split("").join(" ") })}
            </span>
          </p>
          <p>{t("wizard.done.pin.body")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void copy("pin", info.pin ?? "")}>
              {t("wizard.done.pin.copy")}
            </Button>
            <span role="status" className="text-sm">
              {copied === "pin" ? t("wizard.copied") : ""}
            </span>
          </div>
        </Card>
      ) : null}

      <Card as="section" aria-labelledby="wz-done-pdf" className="flex flex-col gap-3">
        <h2 id="wz-done-pdf" className="flex items-center gap-2 text-xl font-medium">
          <Icon icon={FileDown} size={22} />
          {t("wizard.done.pdf.title")}
        </h2>
        <p>{t("wizard.done.pdf.body")}</p>
        <form method="post" action={ANNOUNCEMENT_PATH[uiLocale]}>
          {info.pin ? <input type="hidden" name="pin" value={info.pin} /> : null}
          <button
            type="submit"
            className={buttonVariants({ variant: "primary" })}
            data-testid="done-pdf"
          >
            {t("wizard.done.pdf.button")}
          </button>
        </form>
        <p className="text-muted text-sm">{t("wizard.done.pdf.note")}</p>
      </Card>

      <p>
        <a href="/" className={buttonVariants({ variant: "secondary" })}>
          {t("wizard.done.dashboard")}
        </a>
      </p>
    </main>
  );
}
