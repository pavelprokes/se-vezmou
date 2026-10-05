# Logo se-vezmou.cz

Vybraná varianta A (dva prsteny s vyplněným průnikem). Ostatní návrhy jsou v historii gitu.

| Soubor                     | Použití                                   |
| -------------------------- | ----------------------------------------- |
| `logo-a-prsteny.svg`       | plné logo (symbol + název), světlé pozadí |
| `logo-a-prsteny-tmave.svg` | totéž na tmavém podkladu (`#1b2a23`)      |
| `logo-a-prsteny-mono.svg`  | jedna barva (tisk, razítko)               |
| `symbol-a.svg`             | samotný symbol (avatar, sociální sítě)    |
| `favicon-a.svg`            | zjednodušený symbol pro 16 až 48 px       |

Kopie SVG jsou v `public/brand/` (ke stažení na `https://se-vezmou.cz/brand/<soubor>`); při změně loga upravit
obě místa. Brand manuál pro AI agenty a grafiku: `docs/brand-manual.md`.

Kde se používá:

- Web: `src/components/brand-logo.tsx` (hlavička, patička, průvodce).
- Ikony: `node scripts/generate-icons.mjs` vytvoří `src/app/icon.svg`, `favicon.ico`, `apple-icon.png` a `public/icons/*` (Android, maskable); manifest je `src/app/manifest.ts`.
- Sdílení: `node scripts/generate-og.mjs` (obrázky `public/og`).
- Strukturovaná data: `Organization.logo` (`src/seo/json-ld.ts`).

Pravidla:

- Minimální šířka: plné logo 80 px, symbol 24 px, favicon 16 px (6 mm v tisku).
- Ochranná zóna kolem loga: čtvrtina jeho šířky.
- Barvy: borovice `#365c4e`, skořice `#8e503c`, inkoust `#1b2a23`, pergamen `#f7f4ed`.
- Nenatahovat, nepřebarvovat, nedávat efekty ani stíny, nepoužívat na rušivém pozadí.
- Text je převedený na křivky (DM Sans Bold), soubory nepotřebují fonty.
