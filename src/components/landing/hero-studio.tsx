"use client";

import { type ReactNode, useState } from "react";
import type { Locale } from "@/i18n/config";
import { previewSlug } from "@/lib/slug-preview";
import { cn } from "@/lib/utils";
import { NameForm, type NameFormLabels, type Names } from "./name-form";

export type TemplateKey = "editorial" | "eucalyptus" | "chateau" | "modern";

export interface HeroStudioProps {
  appUrl: string;
  locale: Locale;
  /** Doména pro náhled adresy (`se-vezmou.cz`). */
  domain: string;
  formLabels: NameFormLabels;
  /** Popisek adresy v liště náhledu (pro čtečky). */
  addressLabel: string;
  /** Přístupný název skupiny přepínačů šablon. */
  templatesLabel: string;
  templates: readonly { key: TemplateKey; name: string }[];
  /** Ukázkové datum a místo a text tlačítka v náhledu. */
  dateplace: string;
  rsvp: string;
  /** Levý sloupec nad formulářem (štítek, `<h1>`, úvod) a pod ním (přednosti, odkaz na ukázku). */
  intro: ReactNode;
  outro: ReactNode;
}

/**
 * Hero s živým náhledem: jména z formuláře se hned propíšou do adresy a do náhledu vybrané šablony.
 * Náhled je ozdoba (čtečky ho přeskočí); adresa v liště a přepínač šablon jsou přístupné.
 * Bez JavaScriptu zůstane formulář funkční (GET na průvodce) a náhled ukáže Kláru a Matěje.
 */
export function HeroStudio(props: HeroStudioProps) {
  const { formLabels, templates } = props;
  const [names, setNames] = useState<Names>({ first: "", second: "" });
  const [template, setTemplate] = useState<TemplateKey>(templates[0].key);

  const first = names.first.trim() || formLabels.firstPlaceholder;
  const second = names.second.trim() || formLabels.secondPlaceholder;
  const slug = previewSlug(names.first, names.second);

  return (
    <div className="grid items-center gap-12 md:grid-cols-[1.05fr_1fr] lg:gap-16">
      <div className="flex min-w-0 flex-col gap-7">
        {props.intro}
        <NameForm
          appUrl={props.appUrl}
          locale={props.locale}
          labels={formLabels}
          variant="hero"
          names={names}
          onNamesChange={setNames}
        />
        {props.outro}
      </div>

      <div className="mx-auto flex w-full max-w-xl min-w-0 flex-col items-center gap-4">
        <div className="border-field-border w-full overflow-hidden rounded-2xl border bg-white">
          <div className="bg-warm border-hairline flex items-center gap-3 border-b px-4 py-2.5">
            <span aria-hidden="true" className="flex gap-1.5">
              {[0, 1, 2].map((n) => (
                <span key={n} className="bg-field-border size-2.5 rounded-full" />
              ))}
            </span>
            <p className="text-ink min-w-0 flex-1 truncate rounded-full bg-white px-4 py-1 text-center text-sm">
              <span className="sr-only">{props.addressLabel}: </span>
              <span data-testid="address-preview">
                <span className={slug ? "font-semibold" : undefined}>
                  {slug ?? previewSlug(first, second)}
                </span>
                .{props.domain}
              </span>
            </p>
          </div>
          <TemplateMock
            template={template}
            first={first}
            second={second}
            dateplace={props.dateplace}
            rsvp={props.rsvp}
          />
        </div>
        <div
          role="group"
          aria-label={props.templatesLabel}
          className="flex flex-wrap justify-center gap-2"
        >
          {templates.map(({ key, name }) => (
            <button
              key={key}
              type="button"
              aria-pressed={template === key}
              onClick={() => setTemplate(key)}
              className={cn(
                "min-h-target cursor-pointer rounded-full border-2 px-4 text-base",
                template === key
                  ? "border-ink bg-ink text-parchment"
                  : "border-field-border text-ink hover:border-ink bg-transparent",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface MockProps {
  template: TemplateKey;
  first: string;
  second: string;
  dateplace: string;
  rsvp: string;
}

/** Zjednodušený úvod webu páru ve čtyřech šablonách (barvy a písmo odpovídají šablonám). */
function TemplateMock({ template, first, second, dateplace, rsvp }: MockProps) {
  const box = "flex min-h-80 flex-col gap-4 p-8 sm:p-10";
  if (template === "eucalyptus") {
    return (
      <div
        aria-hidden="true"
        className={cn(box, "relative items-center justify-center bg-[#e4ece6] text-center")}
      >
        <span className="absolute inset-y-0 right-9 w-0.5 bg-[#6f8f7f]" />
        <span className="absolute top-10 right-5 size-7 rounded-full bg-[#9db5a7]" />
        <span className="absolute top-28 right-10 size-9 rounded-full bg-[#9db5a7]" />
        <span className="absolute top-48 right-4 size-7 rounded-full bg-[#9db5a7]" />
        <p className="text-pine max-w-[80%] font-serif text-5xl leading-none break-words italic">
          {first}
          <br />& {second}
        </p>
        <p className="text-sm text-[#2c3b33]">{dateplace}</p>
        <span className="bg-pine rounded-lg px-5 py-2 text-sm text-white">{rsvp}</span>
      </div>
    );
  }
  if (template === "chateau") {
    return (
      <div aria-hidden="true" className="flex min-h-80 bg-[#eadfcc] p-5">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 border border-[#8a7556] p-6 text-center text-[#3b2f20]">
          <span className="flex size-16 items-center justify-center rounded-full border border-[#5c4a33] font-serif text-2xl">
            {first.charAt(0).toUpperCase()}&amp;{second.charAt(0).toUpperCase()}
          </span>
          <p className="text-sm font-semibold tracking-[0.24em] break-words uppercase">
            {first} &amp; {second}
          </p>
          <p className="text-sm">{dateplace}</p>
          <span className="rounded-full border-2 border-[#4a3b28] px-4 py-1.5 text-sm">{rsvp}</span>
        </div>
      </div>
    );
  }
  if (template === "modern") {
    return (
      <div aria-hidden="true" className={cn(box, "bg-ink text-parchment")}>
        <p className="font-sans text-5xl leading-[0.95] font-extrabold tracking-tight break-words uppercase">
          {first}
          <br />+ {second}
        </p>
        <p className="text-sm">{dateplace}</p>
        <span className="bg-cinnamon h-20 rounded" />
        <span className="bg-parchment text-ink self-start rounded-md px-4 py-2 text-sm font-semibold">
          {rsvp}
        </span>
      </div>
    );
  }
  return (
    <div aria-hidden="true" className={cn(box, "bg-parchment text-ink")}>
      <span className="bg-ink h-0.5 w-10" />
      <p className="font-serif text-5xl leading-none break-words">
        {first}
        <br />& {second}
      </p>
      <p className="text-muted text-sm">{dateplace}</p>
      <span className="bg-linen h-20 rounded-md" />
      <span className="border-ink self-start rounded-full border-2 px-4 py-1.5 text-sm">
        {rsvp}
      </span>
    </div>
  );
}
