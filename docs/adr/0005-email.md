# ADR 0005: Poskytovatel e-mailů a doručitelnost

Stav: navrženo (čeká na schválení majitele)

## Kontext

E-maily nesou přihlašovací kódy (FR-MAIL-1), potvrzení RSVP, oznámení o změně správců, upozornění na přihlášení na záložní e-mail a upozornění před vypršením webu. Když kód nedorazí, pár se nepřihlásí (riziko „Doručitelnost přihlašovacích kódů“ v zadání). Zadání vyžaduje SPF, DKIM a DMARC (FR-MAIL-2), česky i anglicky a české typografické zásady i v e-mailech.

Všechny DNS záznamy domény `se-vezmou.cz` se spravují ve Vercelu (nameservery Vercelu kvůli wildcard certifikátu). SPF, DKIM a DMARC proto patří tam, ne k registrátorovi. Ve scaffoldu už existuje `src/lib/email/ses.ts` (AWS SES SDK v2, `sendEmail`).

## Možnosti

| Možnost                           | Pro                                                                                                | Proti                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A. AWS SES, region `eu-central-1` | Data a odesílání v EU, cena za zprávu, SDK už ve scaffoldu, DKIM přes Easy DKIM, události přes SNS | Nový účet začíná v sandboxu a o produkční přístup je nutné požádat. Víc ruční konfigurace (DNS, SNS, suppression). Slabší rozhraní pro ladění |
| B. Resend                         | Jednoduché API a rozhraní, rychlý start                                                            | Region a smluvní podmínky zpracování nutno ověřit. Další dodavatel navíc, cena podle tarifu                                                   |
| C. Postmark                       | Dobrá pověst pro transakční e-maily, přehled doručení                                              | Cena za zprávu vyšší, umístění dat a DPA nutno ověřit                                                                                         |

Konkrétní ceny a limity zde záměrně neuvádíme. Ověří se v aktuálních ceníkách před schválením `[OTÁZKA]`.

## Rozhodnutí (doporučení)

Zvolit **A: AWS SES v `eu-central-1`**. Zachovat tenkou vrstvu `sendEmail`, aby šel poskytovatel vyměnit (B nebo C) bez zásahu do šablon a volajícího kódu.

### Doména a ověření odesílatele

- Ověřit doménu `se-vezmou.cz` v SES, zapnout Easy DKIM a záznamy (CNAME) vložit do DNS ve Vercelu.
- SPF: záznam TXT s `include` pro SES. Vlastní MAIL FROM doména (například `bounce.se-vezmou.cz`) kvůli zarovnání SPF s DMARC.
- DMARC: začít s `p=none` a reportem na schránku majitele, po ověření provozu přejít na `quarantine`, potom `reject`. Postup a termíny `[OTÁZKA]` (doporučení: přejít až po několika týdnech bez nesrovnalostí v reportech).
- Přesun nameserverů na Vercel: před přepnutím zkopírovat všechny existující záznamy (MX, SPF, DKIM) a po přepnutí je zkontrolovat. Plánovat před prvním tištěným oznámením.
- Odesílací adresa a adresa pro odpovědi (`Reply-To`): `[KONTAKT]`.

### Doručení a odrazy

- SES konfigurační sada publikuje události Bounce, Complaint a Delivery do SNS tématu. SNS posílá na HTTPS webhook v aplikaci (např. `/api/email/events` na hostiteli `app.`).
- Webhook ověří podpis zprávy SNS (a při odběru potvrdí `SubscriptionConfirmation` jen z očekaveného tématu). Neověřená zpráva se zahodí.
- Trvalý odraz (hard bounce) a stížnost (complaint) založí adresu na seznam potlačení. Na potlačenou adresu se kromě přihlašovacího kódu neposílá. U přihlašovacího kódu se po potlačení zobrazí stejná odpověď jako vždy (bez prozrazení existence), ale správce se dozví o záložním postupu níže.
- Zapnout též potlačení na úrovni účtu SES jako druhou pojistku.

### Záznam e-mailu (bez obsahu)

Tabulka `email_log` (viz `docs/data-model.md`): typ (`login_code`, `rsvp_confirmation`, `admin_added`, `admin_removed`, `backup_login_notice`, `expiry_warning`), svatba (je-li), příjemce v minimálním tvaru (hash adresy plus doména; úplnou adresu jen tam, kde je nutná pro opakované doručení), identifikátor zprávy od poskytovatele, stav (`sent`, `delivered`, `bounced`, `complaint`), čas. **Nikdy se neukládá předmět ani tělo**, tedy ani přihlašovací kód, jména, dieta. Záznamy se mažou po krátké lhůtě `[LHŮTY]` (návrh: řádově týdny až měsíce, určí právník).

### Šablony

- Vlastní funkce v TypeScriptu (např. `src/lib/email/templates/*.ts`), každá vrací `{ subject, html, text }` pro daný jazyk. Žádná externí šablonovací služba a žádný zdroj třetí strany v obsahu e-mailu.
- Povinně obě jazykové verze (cs, en) a textová alternativa. Test parity jazyků jako u překladových souborů.
- Všechny texty procházejí pomocnou funkcí `typo()` (nezlomitelné mezery, české uvozovky, tečky, jednotky) i dynamické vložené hodnoty (datum, částka, jména).
- Přístupnost: skutečný text místo obrázků, kontrast jako na webu, srozumitelné odkazy, kód ve vlastním řádku v jednoduchém textu (jde vložit ze schránky, 3.3.8). Žádné přesměrování odkazů přes třetí stranu. Sledovací pixely nejsou, výjimkou je volitelný měřicí pixel vlastní instance Umami jen v oznámeních o vypršení a smazání webu pro správce (ADR 0014, vypnutý bez `UMAMI_PIXEL_URL`). Změna 10/2026: každá zpráva nese logo vložené přes Content-ID (`cid:`, příloha INLINE, ne vzdálený obrázek) a patičku s kontaktem a dvěma projekty autora s odkazy a UTM značkami (`utm_source=se-vezmou&utm_medium=email`); jiné odkazy v těle zprávy zůstávají zakázané. U přihlašovacích a ověřovacích kódů pro páry je kód na začátku předmětu, aby ho Gmail a mobilní klienti nabídly ke zkopírování (operátorské kódy zůstávají bez kódu v předmětu).
- Ukázková jména ve vzorech a testech: Klára a Matěj.

### Záložní postup přihlášení

1. Přihlášení kódem selže (nedoručeno): v rozhraní je po krátké době tlačítko „Poslat znovu“ (podléhá limitům z ADR 0010) a nápověda s kontrolou složky nevyžádané pošty.
2. Správce s nastaveným PINem správy se přihlásí PINem (ADR a `docs/security-privacy.md`), přihlášení se oznámí na záložní e-mail.
3. Správce má víc adres (N, výchozí 3): kód lze vyžádat na jinou přiřazenou adresu.
4. Poslední možnost: ruční obnova přes podporu. Operátor po ověření totožnosti (postup `[OTÁZKA]`) pošle přihlašovací odkaz na záložní e-mail, každý zásah jde do auditu.
5. Sledování: podíl nedoručených kódů je ukazatel v provozní administraci (počty bez PII).

## Důsledky

- **Cena:** nejnižší cena za zprávu z uvedených možností předpokládáme, ale hodnoty neověřujeme zde. Reálný objem je malý (trh zadání: asi 42 500 svateb ročně, jen část bude naše). Pevné náklady bez aplikace jsou nulové. Skryté náklady: čas na zřízení.
- **Bezpečnost:** DKIM, SPF a DMARC chrání před zneužitím naší domény. Webhook SNS je nová veřejná plocha: nutné ověření podpisu a omezení počtu požadavků. Poskytovatel zpracovává adresy příjemců, takže je potřeba DPA s AWS a ověření EU umístění `[OTÁZKA]` pro právníka.
- **Údržba:** více ruční konfigurace (DNS, SNS, žádost o produkční přístup). Monitorovat míru odrazů a stížností, protože vysoké hodnoty ohrožují účet SES. Vrstva `sendEmail` drží výměnu poskytovatele na dosah (alternativy B, C).
- **Riziko:** zdržení při žádosti o produkční přístup. Podat žádost včas, před betou.
