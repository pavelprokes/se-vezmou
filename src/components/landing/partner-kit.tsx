"use client";

import { useId, useState } from "react";
import { PrintButton } from "@/components/admin/guests/print-button";
import { CopyButton } from "@/components/site/copy-button";
import { QrCode } from "@/components/wizard/qr-code";

/** Kód partnera z jména: bez diakritiky, malá písmena a spojovníky, nejvýš 40 znaků. */
export function partnerCode(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

/** Odkaz s UTM parametry: návštěvy a založené weby jde v analytice rozlišit podle partnera, bez cookies. */
export function partnerUrl(homeUrl: string, code: string): string {
  const url = new URL(homeUrl);
  url.searchParams.set("utm_source", code);
  url.searchParams.set("utm_medium", "partner");
  url.searchParams.set("utm_campaign", "doporuceni");
  return url.toString();
}

export interface PartnerKitLabels {
  name: string;
  nameHint: string;
  link: string;
  copy: string;
  copyLabel: string;
  copied: string;
  qr: string;
  print: string;
  empty: string;
  leafletTitle: string;
  leafletLead: string;
  leafletPoints: string[];
  leafletScan: string;
  leafletBy: string;
}

/**
 * Doporučující odkaz a leták pro fotografy a další dodavatele: odkaz s kódem partnera, QR kód
 * a tisk letáku A4 (při tisku zmizí zbytek stránky). Vše v prohlížeči, nic se neukládá.
 */
export function PartnerKit({ homeUrl, labels }: { homeUrl: string; labels: PartnerKitLabels }) {
  const id = useId();
  const [name, setName] = useState("");
  const code = partnerCode(name);
  const url = code ? partnerUrl(homeUrl, code) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-md flex-col gap-2 print:hidden">
        <label htmlFor={`${id}-name`} className="font-bold">
          {labels.name}
        </label>
        <input
          id={`${id}-name`}
          type="text"
          autoComplete="organization"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-describedby={`${id}-hint`}
          className="min-h-target rounded-button border-field-border text-ink border-2 bg-white px-3 py-2 text-base"
        />
        <p id={`${id}-hint`} className="text-muted text-sm">
          {labels.nameHint}
        </p>
      </div>

      {url ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start print:hidden">
            <QrCode payload={url} label={labels.qr} className="size-40 shrink-0" />
            <div className="flex min-w-0 flex-col gap-3">
              <p className="font-bold">{labels.link}</p>
              <p className="font-mono text-sm break-all" data-testid="partner-url">
                {url}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <CopyButton
                  value={url}
                  label={labels.copyLabel}
                  copiedLabel={labels.copied}
                  text={labels.copy}
                  className="min-h-target rounded-button border-ink text-ink inline-flex items-center border-2 bg-white px-4 font-bold"
                  statusClassName="text-muted text-sm"
                />
                <PrintButton label={labels.print} />
              </div>
            </div>
          </div>

          {/* Leták: jen při tisku, na A4 na výšku */}
          <section
            aria-label={labels.leafletTitle}
            className="hidden text-black print:flex print:min-h-[250mm] print:flex-col print:gap-8 print:bg-white print:p-[12mm]"
          >
            <p className="font-display text-2xl">se-vezmou.cz</p>
            <h2 className="font-display text-5xl leading-tight">{labels.leafletTitle}</h2>
            <p className="text-xl">{labels.leafletLead}</p>
            <ul className="flex list-disc flex-col gap-2 pl-6 text-lg">
              {labels.leafletPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <div className="mt-auto flex items-end gap-6">
              <QrCode payload={url} label={labels.qr} className="size-[45mm] shrink-0" />
              <div className="flex flex-col gap-2">
                <p className="text-lg font-bold">{labels.leafletScan}</p>
                <p className="font-mono text-sm break-all">{url}</p>
                <p className="text-lg">{labels.leafletBy.replace("{name}", name.trim())}</p>
              </div>
            </div>
          </section>
        </>
      ) : (
        <p className="text-muted print:hidden">{labels.empty}</p>
      )}
    </div>
  );
}
