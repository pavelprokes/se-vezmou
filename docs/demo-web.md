# Demo web „Test a Test“

Trvalý, plně vyplněný ukázkový web `test-a-test.se-vezmou.cz` s vymyšleným párem Klára a Matěj, který majitel ukazuje zájemcům jako hotovou naplánovanou svatbu. **Není veřejný**: nikam se neodkazuje, není v mapě webu ani na úvodní stránce a celý je zamčený PINem hostů. Odkaz a PIN pošle majitel jen na poptávku.

Zakládá ho a udržuje skript `scripts/demo-seed.mjs` (`npm run demo:seed`) nebo ručně spouštěný workflow GitHubu „Demo web“ (`.github/workflows/demo-seed.yml`). Obojí dělá totéž.

## 1. Jak skript pracuje (a proč)

- **Volá existující funkce `security definer`**, ne tabulky přímo. Používá stejné přepnutí role a claimy transakce jako aplikace (`src/lib/db/transport.ts`): před přihlášením `service_role`, jinak `authenticated` s claimy správce nebo hosta jedné svatby. Tím platí všechny invarianty: hashe PINů (argon2id s `PIN_PEPPER`), lhůty retence, audit, kontrola snímku webu, omezení počtů a práva. Přímý zápis SQL do tabulek by je obcházel a při každé změně schématu by se rozbil.
- Spojení vlastníka (`MIGRATE_DATABASE_URL`, `MIGRATE_CA_CERT`, stejné jako u `npm run db:migrate`) slouží jen k tomu, aby se mohla přepnout role. Přímý SQL zápis mají jen tři úzké případy, vždy se záznamem do auditu (aktér `system`):
  1. **Adresa se slovem `test`.** Rejstřík vyhrazených slov (`slug_registry`, token `test` má víc než 4 znaky) odmítne `test-a-test` v průvodci i u operátora (`slug_available`). Skript proto svatbu založí s dočasnou adresou a před prvním zveřejněním ji přepne na požadovanou (audit `demo.slug_exception`). Je to výjimka jen pro vlastníka databáze, běžný pár ji nikdy nedostane.
  2. Obnova smazaného nebo archivovaného dema (stav zpět na `published`, audit `demo.restore`).
  3. `--reset` smaže odpovědi hostů mimo seznam, které nemají domácnost (žádná funkce pro to neexistuje).
- **Neodesílá žádné e-maily a nevolá SES.** Funkce databáze e-maily neposílají (posílá je aplikace). Oznámení provozovateli „Nový web“ vzniká jen v aplikaci při dokončení průvodce, který se tu nepoužívá. Záložní e-mail (`demo-zaloha@example.invalid`) a druhý správce (`demo-druhy-spravce@example.invalid`) jsou vymyšlené adresy na vyhrazené doméně; záložní e-mail zůstává nepotvrzený, takže na něj nic nechodí.
- **Fotografie** se vytvoří lokálně z vlastních SVG ilustrací (žádné cizí fotografie) a projdou stejným zpracováním jako nahrání párem (`processImage`: překódování, bez metadat, varianty 640/1280/1920 px ve WebP a AVIF) a uloží se do R2 přes stejné rozhraní úložiště. Bez R2 proměnných se fotografie **vynechají a skript to výslovně vypíše**; galerie pak nese jen odkaz na externí galerii (funkce „odkaz na galerii“).
- Ochrany: proti vzdálené databázi odmítne běžet bez `--yes`, před jakoukoli změnou vypíše, co udělá (host databáze bez hesla; v GitHub Actions se host skrývá), PIN se nikdy neukládá do souboru ani do logu zadaný z prostředí.

## 2. Spuštění na produkci

### A) Přes GitHub (doporučeno, bez práce z počítače)

1. **Secrety** v prostředí `production` (Settings → Environments → production → Environment secrets; použijí se i repozitářové):

   | Secret                                                                   | K čemu                                                                                 |
   | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
   | `MIGRATE_DATABASE_URL`, `MIGRATE_CA_CERT`                                | už nastavené pro migrace (stejné připojení vlastníka)                                  |
   | `PIN_PEPPER`                                                             | **stejná hodnota jako `PIN_PEPPER` na Vercelu**, jinak PIN neodpovídá ověření aplikace |
   | `DEMO_ADMIN_EMAIL`                                                       | e-mail správce dema (váš), na něj se přihlásíte do správy kódem z e-mailu              |
   | `DEMO_GUEST_PIN`                                                         | PIN hostů, odemyká zamčený web (6 až 12 číslic, ne triviální jako `123456`)            |
   | `DEMO_SITE_PIN`                                                          | PIN správy webu (jiný než PIN hostů)                                                   |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | volitelné: ukázkové fotografie; bez nich se fotografie přeskočí a workflow to vypíše   |

   Volitelná proměnná prostředí `ROOT_DOMAIN` (výchozí `se-vezmou.cz`) jen pro výpis adresy.

2. **Ruční schválení:** v prostředí `production` zapněte „Required reviewers“. Každé spuštění pak čeká na schválení (workflow ho ani nezačne bez něj). Workflow běží na produkci **jen z větve `main`** (z jiné větve se úloha přeskočí) a nikdy automaticky: žádný push, žádný plán, žádné CI.
3. **Actions → Demo web → Run workflow**, vstupy: `slug` (výchozí `test-a-test`) a `action`: `create` (založit nebo aktualizovat), `reset` (smazat obsah a založit znovu), `delete` (smazat web).
4. PINy se v CI **nikdy negenerují ani nevypisují**: chybí-li `DEMO_GUEST_PIN` nebo `DEMO_SITE_PIN`, workflow skončí srozumitelnou chybou (vygenerovaný PIN by se vypsal do logu). Secrety jsou v logu maskované.

### B) Ručně z počítače (záložní varianta)

```bash
cp .env.migrate.example .env.migrate.local     # MIGRATE_DATABASE_URL a MIGRATE_CA_CERT_FILE, jako u migrací
export PIN_PEPPER='…'                          # stejná hodnota jako na Vercelu
export DEMO_ADMIN_EMAIL='vas@email.cz'
# PINy buď zadejte, nebo se vygenerují a vypíšou JEDNOU na konzoli:
export DEMO_GUEST_PIN='…' DEMO_SITE_PIN='…'

npm run demo:seed -- --yes                     # založí, nebo aktualizuje (vypíše plán a výsledek)
```

Další volby: `--slug`, `--date` (viz kap. 4), `--template`, `--palette`, `--rotate-pins`, `--no-photos`, `--help`. Fotografie se nahrají, když jsou v prostředí `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` a `R2_BUCKET`.

## 3. Správa dema

| Co chcete                                           | Jak                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Změnit PIN hostů nebo správy                        | Změňte secret (nebo proměnnou) a spusťte `create` (`npm run demo:seed -- --yes`). Každý běh s PINem z prostředí PIN znovu nastaví a ukončí odemčené relace. Bez PINu v prostředí PIN zůstane; `--rotate-pins` vygeneruje nové.                                      |
| Vrátit demo do čistého stavu (po zkouškách zájemců) | `reset` (`--reset --yes`). Zájemci mohou na demu odeslat odpověď (host mimo seznam je povolený), `reset` takové zásahy smaže.                                                                                                                                       |
| Aktualizovat datum svatby                           | `create`: datum se přepočítá (kap. 4)                                                                                                                                                                                                                               |
| Demo smazat                                         | `delete` (`--delete --yes`). Web zmizí hned, trvale ho smaže noční úloha po ochranné lhůtě. **Adresa po prvním zveřejnění zůstává trvale zabraná** (pravidlo produktu). Dokud web trvale neodstraní úloha, `create` ho obnoví; potom je nutné zvolit jiné `--slug`. |
| Přihlásit se do správy dema                         | `https://app.se-vezmou.cz` → e-mail `DEMO_ADMIN_EMAIL` → kód z e-mailu (nebo adresa + PIN správy). Druhý správce je vymyšlená adresa, nelze se jí přihlásit.                                                                                                        |

**Pozor ve správě dema:** e-mailové funkce (potvrzení odpovědi hostu, upozornění hostům na změnu, oznámení páru) by posílaly skutečné e-maily. Skript je nespouští; v demu je nepoužívejte. Upozornění páru na odpovědi (`rsvp notify`) je vypnuté.

## 4. Proč je demo trvalé (retence)

Retenční a životní úlohy (`/api/cron/daily`, `docs/data-model.md` kap. 10) jsou pevně vázané na **datum svatby**. Pro zveřejněný web platí (hodnoty z `app_settings`, stav k migraci `20261017120000_retention_periods`):

- dieta a alergie se mažou **30 dní po svatbě**,
- ostatní údaje hostů a odpovědi **3 měsíce po svatbě**,
- web zůstane veřejný **12 měsíců po svatbě**, pak se archivuje; archiv se smaže 365 dní po smazání údajů hostů.

Nic z toho neběží před datem svatby. Rozepsané koncepty se mažou po 14 dnech bez aktivity, ale zveřejněný web (stav `published`) mezi ně nepatří. Demo proto dostane datum svatby **dnes + 1 rok, posunuté na sobotu** (`--date auto`), takže první zásah (mazání hostů) přijde nejdřív za zhruba 15 měsíců.

**Trvalé zůstane tak:**

1. **Znovu spusťte `create` aspoň jednou za 12 měsíců** (připomínka v kalendáři). Běh datum přepočítá a retenční data se přepočítají spouštěčem databáze (`weddings_before_write`). Je to bezpečný, idempotentní běh, ale nastaví PINy znovu (viz kap. 3).
2. Chcete-li zásah na dlouho „zaparkovat“, zadejte vzdálené pevné datum, např. `--date 2031-06-15` (v odpočtu na webu pak bude několik set dní, nad rámec ukázky). Pevné datum má nejméně `90` dní předstih; blíž skript odmítne.
3. Operátor může lhůty jen **prodloužit** v administraci (`admin.se-vezmou.cz`, prodloužení lhůt, `op_extend_retention`); zkrátit je nelze.

Pokud by demo přece vypršelo (archivováno, smazáno), `create` ho z těchto stavů obnoví (archivované i smazané do trvalého smazání), jinak založí nové na jiné adrese.

## 5. Neveřejnost (ověřeno testem `e2e/demo-seed.e2e.ts`)

- Web páru má vždy `X-Robots-Tag: noindex, nofollow` (proxy) i `<meta name="robots" content="noindex, nofollow">`; `robots.txt` hostitele webů zakazuje vše.
- Úvodní stránka, `sitemap.xml`, `llms.txt`, blog ani `robots.txt` úvodní stránky adresu ani název dema neobsahují (mapa webu se skládá jen ze statických stránek produktu).
- **Bez PINu vidí návštěvník jen zamykací stránku** („Web je jen pro pozvané hosty“) a jména páru. Ani v HTML odpovědi, ani v datech stránky (RSC) není obsah webu, adresa soukromého místa ani číslo účtu. Fotografie zamčeného webu se bez relace hosta nedoručí.
- **Limity pokusů na PIN:** po 5 chybách pauza 15 minut, každá další série dvojnásobná (strop 24 hodin); správný PIN v pauze nepomůže. Pauza je podle dvojice web a IP a zároveň podle celého webu. K tomu hodinový limit 60 pokusů na IP a 50 chyb na web (`src/auth/config.ts`). PIN je jen v databázi jako hash argon2id.
- Relace hosta po PINu: cookie jen pro hostitele webu, nečinnost 6 hodin, absolutně 2 dny.
- Osobní odkaz domácnosti (`/p/<kód>`, kód v přehledu hostů, karty s QR) zamčený web také otevře, takže zájemci lze poslat buď PIN, nebo odkaz.

## 6. Jak ukázat web zájemci

1. Pošlete adresu `https://test-a-test.se-vezmou.cz` a **PIN hostů** (zvlášť od odkazu, např. jinou zprávou).
2. Zájemce vidí po zadání PINu celý web v češtině i angličtině (přepínač jazyka), odpočet, program, mapu míst, ubytování, FAQ, dary (číslo účtu a QR platba jsou až po PINu), seznam věcných darů s rezervací, galerii a formulář potvrzení účasti (zkuste jméno „Jana Nováková“ nebo osobní odkaz).
3. Správu ukážete sami (přihlášením): hosté a skupiny, odpovědi, zasedací pořádek, jmenovky, karty s QR, cedulka galerie, dary, poznámky a dodavatelé, přístup.

## 7. Co demo obsahuje

**Web (cs i en, celý):** šablona Louka, paleta Levandule; všech 11 bloků (úvod s odpočtem, příběh, program, místa s mapou a soukromým místem za PINem, ubytování a doprava s ubytováním na mapě, dress code, 5 otázek v FAQ, dary s účtem a QR platbou, galerie, kontakty, potvrzení účasti); rychlá změna („Toto je ukázkový web …“); fáze „přijímáme odpovědi“ (RSVP otevřené, uzávěrka měsíc před svatbou).

**Přístup:** celý web zamčený PINem hostů („heslo na celý web“), PIN správy, záložní e-mail (nepotvrzený), druhý správce (ukázkový), citlivé údaje za PINem.

**RSVP:** 5 událostí (obřad, přípitek, hostina, zábava, snídaně v soukromém altánu), potvrzování u obřadu, hostiny a zábavy; jídelní volba (vlastní otázka), zůstanu-na-zábavu (ano/ne k události), doprovod, děti, diety a alergie, ubytování, doprava, píseň, vzkaz pro pár, upozornění na změny (zapnuto), host mimo seznam povolen, potvrzení e-mailem zapnuto.

**Hosté:** 12 domácností, 22 hostů ve skupinách (rodina nevěsty/ženicha, přátelé, svědci, kolegové, sousedé, zahraniční hosté); 8 domácností odpovědělo osobním odkazem (přijde vše, část programu, doprovod, dítě doplněné hostem, odmítnutí, diety), 4 bez odpovědi. Ne všichni jsou pozváni na všechny události.

**Další:** zasedací pořádek (6 kulatých stolů, usazená hostina), seznam 6 věcných darů (2 rezervované), 6 dodavatelů (nápad/oslovený/zamluvený), soukromé poznámky, tiskové výstupy nad těmito daty (jmenovky na stůl, karty s QR, cedulka s QR galerie, zasedací pořádek k tisku), odkaz na externí galerii; 6 ukázkových fotografií s popisky v obou jazycích, **jen s R2**.

**Co demo nepokrývá a proč:** e-mailová upozornění hostům a potvrzení odpovědi (odesílala by skutečné e-maily; zapnuté jsou, ale nikdo není přihlášen), platby a objednávky (zaváděcí provoz, zakázka je ve stavu zkušebního provozu), provozní administrace `admin.` (jiná část produktu), fáze po svatbě (poděkování) a archiv (demo má být vždy před svatbou).
