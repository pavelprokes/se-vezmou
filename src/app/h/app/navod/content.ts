/**
 * Text návodu pro páry (`/navod`). Jen česky (zadání majitele). Tučně (`**takto**`) jsou popisky
 * z rozhraní, které musí přesně odpovídat textům v `src/i18n/messages/cs/*.json` (po změně rozhraní
 * je potřeba upravit i návod), a v části „Když něco nejde“ úvodní slova potíží. Typografii a uvozovky
 * tu `i18n:check` nehlídá.
 */

export type GuideBlock =
  { p: string } | { steps: string[] } | { list: string[] } | { tip: string } | { h3: string };

export interface GuideSection {
  id: string;
  title: string;
  blocks: GuideBlock[];
}

export const GUIDE_TITLE = "Návod: jak si vytvořit svatební web";

export const GUIDE_LEAD =
  "Krok za krokem, bez technických znalostí. Návod si můžete nechat otevřený vedle a postupovat podle něj. Nic se nerozbije: dokud web nezveřejníte, hosté nic nevidí, a i potom můžete skoro všechno změnit.";

export const GUIDE: GuideSection[] = [
  {
    id: "priprava",
    title: "Než začnete",
    blocks: [
      {
        p: "Na první verzi webu stačí tři věci. Zabere to zhruba deset minut, zbytek doplníte kdykoli později.",
      },
      {
        list: [
          "**Jména** vás dvou tak, jak je chcete mít na webu, například Klára a Matěj.",
          "**Datum svatby**.",
          "**E-mail**, na který vám pošleme kód pro přihlášení. Heslo si pamatovat nemusíte.",
        ],
      },
      {
        p: "Až budete mít chuť, připravte si i další podklady: čas a místo obřadu a hostiny, tipy na ubytování, dress code, číslo účtu pro dary a fotky.",
      },
      {
        tip: "Web můžete tvořit na mobilu i na počítači. Na počítači je to pohodlnější, protože vedle formuláře rovnou vidíte náhled webu.",
      },
    ],
  },
  {
    id: "pruvodce",
    title: "Vytvoření webu v průvodci",
    blocks: [
      {
        p: "Na úvodní stránce se-vezmou.cz klepněte na **Vytvořit web**. Otevře se průvodce s devíti kroky. Nahoře vidíte, ve kterém kroku jste. Tlačítkem **Další** jdete dál, tlačítkem **Zpět** se vrátíte. Kroky označené jako nepovinné můžete přeskočit tlačítkem **Přeskočit**.",
      },
      { h3: "1. Jména a jazyk" },
      {
        p: "Napište obě jména a vyberte, jestli má být web česky, anglicky, nebo v obou jazycích. Dva jazyky se hodí, když přijedou hosté ze zahraničí. Texty pak píšete pro každý jazyk zvlášť.",
      },
      { h3: "2. Datum a adresa" },
      {
        p: "Zadejte **Datum svatby**. Pokud svatba trvá víc dní, zaškrtněte **Svatba trvá více dní** a doplňte poslední den.",
      },
      {
        p: "**Adresa webu** je to, co hosté napíšou do prohlížeče, například klara-a-matej.se-vezmou.cz. Navrhneme ji podle jmen, můžete ji ale změnit. Používejte jen malá písmena bez háčků a čárek, číslice a pomlčky. Pod polem hned uvidíte, jestli je adresa volná. Po zveřejnění už adresu změnit nejde, vyberte ji proto pečlivě.",
      },
      { h3: "3. Šablona a barvy" },
      {
        p: "Vyberte vzhled webu: **Editorial**, **Eukalyptus**, **Chateau** nebo **Modern**, a k němu barvy. Jak web vypadá, ukazuje náhled vedle formuláře, na mobilu po klepnutí na **Náhled**. Vzhled můžete kdykoli později změnit.",
      },
      {
        tip: "Na úvod webu můžete později dát i velkou fotku, ve všech šablonách. Víc v části Úvodní fotka.",
      },
      { h3: "4. Program a místo (nepovinné)" },
      {
        p: "Přidejte obřad a hostinu s časem a místem. U místa stačí název a adresa, mapu pro hosty přidáte zaškrtnutím **Ukázat mapu**. Další body programu, třeba první tanec, přidáte tlačítkem **Přidat bod programu**.",
      },
      { h3: "5. Praktické informace (nepovinné)" },
      {
        p: "Dress code, tipy na ubytování, doprava a parkování a kontakt na někoho, komu hosté mohou zavolat, třeba na svědka.",
      },
      { h3: "6. Potvrzení účasti (nepovinné)" },
      {
        p: "Zvolte, do kdy mají hosté odpovědět a na co se jich zeptáte: jestli přivedou doprovod, jestli přijdou s dětmi a jestli mají dietu nebo alergii. Seznam hostů doplníte později ve správě.",
      },
      { h3: "7. Přístup a soukromí (nepovinné)" },
      {
        p: "Web se nikdy nezobrazuje ve vyhledávačích, najde ho jen ten, komu adresu pošlete. Navíc můžete zaškrtnout **Chránit citlivé části webu PINem**: PIN je číslo, které napíšete na oznámení. Číslo účtu a adresu soukromého místa pak hosté uvidí až po jeho zadání. Bez PINu se číslo účtu na webu neukáže vůbec.",
      },
      { h3: "8. Kontrola" },
      {
        p: "Uvidíte souhrn všeho, co jste zadali. U každé části je tlačítko **Upravit**. Pokud něco chybí, průvodce vám napíše co a v kterém kroku to opravíte.",
      },
      { h3: "9. Uložit, nebo zveřejnit" },
      {
        list: [
          "**Uložit koncept**: web uvidíte jen vy. Dostanete soukromý odkaz na náhled, který můžete poslat třeba mamince nebo svědkovi. Odkaz uvidíte jen jednou, hned si ho zkopírujte.",
          "**Zveřejnit web**: web začne fungovat na své adrese a můžete ho poslat hostům.",
        ],
      },
      {
        tip: "Dokud web poprvé neuložíte, je jen ve vašem prohlížeči. Proto ho na konci uložte nebo zveřejněte, jinak by se při vymazání historie prohlížeče ztratil.",
      },
    ],
  },
  {
    id: "prihlaseni",
    title: "Uložení a přihlášení e-mailem",
    blocks: [
      {
        p: "Při prvním uložení vás požádáme o e-mail. Pošleme na něj šestimístný kód, který opíšete do formuláře. Kód platí deset minut.",
      },
      {
        p: "Vyplňte i **Záložní e-mail** (povinný, jiný než první), třeba toho druhého z vás. Pomůže, když se k prvnímu e-mailu nedostanete. Na záložní adresu přijde zpráva s tlačítkem **Potvrdit záložní e-mail**. Po potvrzení na ni chodí upozornění při každém přihlášení PINem a při změně PINu.",
      },
      {
        p: "Příště se přihlásíte na app.se-vezmou.cz/prihlaseni: napíšete e-mail, klepnete na **Poslat kód** a kód opíšete. Pokud si ve správě nastavíte PIN správy, můžete se přihlásit i přes **Přihlásit se PINem**.",
      },
      {
        tip: "Kód nepřišel? Podívejte se do složky Hromadné, Promoakce nebo Spam. Pokud tam není ani po pár minutách, klepněte na **Poslat nový kód** (v průvodci **Poslat kód znovu**).",
      },
    ],
  },
  {
    id: "zverejneni",
    title: "Po zveřejnění: poslat web hostům",
    blocks: [
      {
        p: "Po zveřejnění uvidíte adresu webu, QR kód a tlačítka pro sdílení přes WhatsApp, SMS nebo e-mail. Hostům se v aplikaci ukáže hezký náhled s vašimi jmény.",
      },
      {
        p: "Pokud jste zapnuli PIN, ukážeme vám ho jen jednou. Zkopírujte si ho tlačítkem **Zkopírovat PIN** a někam si ho poznamenejte. Zapomenutý PIN můžete později změnit ve správě v části **Přístup**.",
      },
      {
        p: "Tlačítko **Stáhnout oznámení (PDF)** připraví stránku k tisku s adresou webu, QR kódem a PINem. Můžete ji vytisknout nebo poslat do tiskárny spolu s oznámením.",
      },
      { p: "Tlačítkem **Přejít do správy webu** se dostanete k dalším úpravám." },
    ],
  },
  {
    id: "sprava",
    title: "Správa webu: co je co",
    blocks: [
      {
        p: "Správa je na app.se-vezmou.cz. Nahoře je nabídka, každá položka má svůj účel:",
      },
      {
        list: [
          "**Můj web**: jestli je web zveřejněný, tlačítka pro sdílení a **Rychlá změna**, tedy pruh nahoře na webu pro důležité oznámení.",
          "**Upravit web**: texty, sekce webu, fotky, vzhled a jazyky. Tady strávíte nejvíc času.",
          "**Hosté**: seznam pozvaných rodin a párů, skupiny, osobní odkazy a kartičky s QR kódem.",
          "**Odpovědi**: kdo přijde, kdo ne a kdo ještě neodpověděl.",
          "**Přístup**: PIN hostů, PIN správy, zamknutí celého webu a další správci, například druhý z vás.",
          "**Data a smazání**: stažení všech údajů a smazání webu.",
          "**Historie verzí**: dřívější zveřejněné verze, ke kterým se můžete vrátit.",
          "**Nápověda**: krátké odpovědi k jednotlivým obrazovkám.",
        ],
      },
      {
        tip: "Na každé obrazovce je pod nadpisem rozbalovací **Nápověda k této obrazovce** a v ní odkaz sem na návod.",
      },
    ],
  },
  {
    id: "upravy",
    title: "Úpravy textů a sekcí",
    blocks: [
      {
        p: "V části **Upravit web** vidíte seznam sekcí webu: Úvod, Program, Místo konání, Ubytování a doprava, Dress code, Časté otázky, Kontakt, Náš příběh, Dary, Fotografie a Potvrzení účasti.",
      },
      {
        steps: [
          "U sekce, kterou chcete změnit, klepněte na **Upravit**.",
          "Přepište text. Ukládá se sám, nahoře uvidíte **Všechny změny jsou uložené**.",
          "Sekci, kterou nechcete, skryjete zrušením zaškrtnutí **Zobrazit na webu**. Pořadí změníte šipkami nahoru a dolů nebo přetažením. Úvod je vždy první.",
          "Jak web vypadá, vidíte v náhledu vedle formuláře, na mobilu po přepnutí na **Náhled**.",
          "Až budete hotoví, klepněte na **Zveřejnit změny** v liště dole na stránce (je vidět, ať jste v editoru kdekoli).",
        ],
      },
      {
        tip: "Dokud neklepnete na **Zveřejnit změny**, hosté vidí starou verzi. Můžete tak v klidu upravovat i několik dní a zveřejnit všechno najednou.",
      },
      {
        p: "Pokud máte web ve dvou jazycích, píšete každý text pro češtinu i angličtinu zvlášť. Chybějící překlady najdete v části **Překlady**.",
      },
      {
        p: "Web, který ještě nebyl zveřejněný, se upravuje v průvodci. Ve správě uvidíte tlačítko **Dokončit v průvodci**.",
      },
    ],
  },
  {
    id: "fotky",
    title: "Jak vložit fotky",
    blocks: [
      {
        p: "Na web můžete nahrát až 12 vlastních fotografií. Fotky se přidávají ve správě, až když je web jednou zveřejněný. Pokud zatím nechcete, aby web někdo viděl, zamkněte ho v části **Přístup** tlačítkem **Zamknout web** (nejdřív musí být nastavený a zapnutý PIN hostů) a fotky přidejte v klidu.",
      },
      {
        steps: [
          "Ve správě otevřete **Upravit web**.",
          "U sekce **Fotografie** klepněte na **Upravit**.",
          "Klepněte na **Vybrat fotografie** a vyberte fotky z počítače nebo z telefonu. Můžete jich vybrat víc najednou.",
          "Počkejte, než se u každé fotky v přehledu nahrávání ukáže **Hotovo**. Nejdřív se nahrává, potom ji na serveru zmenšíme a upravíme. Okno během toho nezavírejte.",
          "Ke každé fotce můžete napsat **Popisek fotografie**, například „Klára a Matěj na procházce v Krkonoších“. Je nepovinný; popisek přečte hostům se zrakovým postižením čtečka obrazovky.",
          "Pořadí fotek změníte přetažením nebo šipkami nahoru a dolů.",
          "Klepněte na **Zveřejnit změny**. Teprve potom fotky uvidí hosté.",
        ],
      },
      {
        tip: "Fotka bez popisku se na webu zobrazí taky, jen ji čtečka obrazovky přeskočí a nevidomí hosté se nedozví, co na ní je. Když chvilku máte, popisek doplňte.",
      },
      { h3: "Jaké fotky jdou nahrát" },
      {
        list: [
          "Formát JPEG, PNG nebo WebP, každá fotka nejvýš 40 MB a 100 megapixelů.",
          "Fotky ve formátu HEIC (typicky zkopírované z iPhonu do počítače) nahrát nejdou. Na iPhonu vyberte fotku přímo z knihovny, převede se sama. V počítači ji nejdřív uložte jako JPEG.",
          "Z fotek automaticky odstraníme polohu, kde byly pořízené, a další skryté údaje.",
        ],
      },
      { h3: "Další možnosti" },
      {
        list: [
          "**Fotografie zobrazit jen po zadání PINu hostů**: fotky uvidí jen hosté, kteří znají PIN.",
          "**Přidat odkaz na externí fotogalerii**: odkaz na velkou galerii, například od fotografa. Na webu se ukáže jako náhled s obrázkem.",
          "**Smazat fotografii**: smaže fotku natrvalo, i ze zveřejněného webu.",
          "**Stáhnout všechny fotografie**: stáhne vaše fotky najednou, třeba na památku po svatbě.",
        ],
      },
    ],
  },
  {
    id: "uvodni-fotka",
    title: "Úvodní fotka (velká fotka nahoře)",
    blocks: [
      {
        p: "Úvodní fotka je velká fotka nahoře na webu. V šabloně **Eukalyptus** je přes celý úvod a vaše jména jsou napsaná přes ni. V šablonách **Editorial**, **Chateau** a **Modern** je jako velký snímek pod jmény, datem a místem.",
      },
      {
        p: "Úvodní fotka se nenahrává zvlášť. Vybírá se z fotek, které už máte nahrané v sekci Fotografie.",
      },
      {
        steps: [
          "Nejdřív fotku nahrajte podle předchozí části. Vybrat jde i fotka z galerie chráněné PINem, v úvodu ji ale uvidí každý. Musí u ní být vidět náhled.",
          "V **Upravit web** klepněte u sekce **Úvod** na **Upravit**.",
          "V nabídce **Fotka v úvodu** vyberte svou fotku. Poznáte ji podle popisku (fotka bez popisku má jen číslo). Pod nabídkou se ukáže její malý náhled.",
          "Klepněte na **Zveřejnit změny**.",
        ],
      },
      { h3: "Jaká fotka se hodí" },
      {
        list: [
          "Na šířku, ideálně v poměru 3 : 2, alespoň 2400 × 1600 bodů. Fotka z dobrého mobilu nebo od fotografa to splní.",
          "Hlavní motiv, tedy vy dva, mějte uprostřed. Na mobilu se fotka ořízne na výšku a okraje se schovají.",
          "Klidné pozadí, na kterém budou dobře čitelná jména.",
        ],
      },
      {
        tip: "Fotka v nabídce chybí? Zkontrolujte, že je nahraná celá (je vidět její náhled). Úvodní fotka je vidět vždy, i když máte zapnuté **Fotografie zobrazit jen po zadání PINu hostů**.",
      },
    ],
  },
  {
    id: "hoste",
    title: "Hosté a odpovědi",
    blocks: [
      {
        p: "Hosty zadáváte po domácnostech: rodina, pár nebo jeden člověk, kteří dostanou jedno oznámení. Hosté se nikam neregistrují, účast potvrdí přímo na webu.",
      },
      {
        steps: [
          "V části **Hosté** klepněte na **Přidat domácnost** a vyplňte jména.",
          "Domácnosti můžete zařadit do skupin (pole **Skupiny** u domácnosti), například Rodina, Kolegové nebo Jen obřad. Podle skupin pak filtrujete a zvete na jednotlivé části programu.",
          "Každá domácnost má **Osobní odkaz**. Když ho hostům pošlete, najdou formulář už s vyplněnými jmény.",
          "**Kartičky s QR k tisku** připraví pro každou domácnost kartičku s jejím osobním QR kódem, třeba do oznámení.",
        ],
      },
      {
        p: "Máte seznam hostů v Excelu? Použijte **Importovat hosty**. Před uložením vám ukážeme, co se načte.",
      },
      {
        p: "V části **Odpovědi** vidíte, kdo přijde a kdo ještě neodpověděl. Když vám host odpoví telefonem, zapíšete to sami: u domácnosti klepněte na **Upravit odpověď**. Seznam hostů i s odpověďmi stáhnete v části **Hosté** tlačítkem **Stáhnout export**, jako Excel nebo CSV.",
      },
    ],
  },
  {
    id: "soukromi",
    title: "PIN a soukromí",
    blocks: [
      {
        list: [
          "**PIN hostů** (6 až 12 číslic, jiný než PIN správy) nastavíte v části **Přístup** tlačítkem **Nastavit PIN** a pak ho zapnete tlačítkem **Zapnout PIN hostů**, pokud jste to neudělali už v průvodci. Napíšete ho na oznámení. Číslo účtu, adresu soukromého místa a fotky schované za PINem hosté uvidí až po jeho zadání.",
          "**Zamknout web**: v části **Přístup** zamknete celý web, bez PINu z něj hosté neuvidí nic kromě vašich jmen. Hosté s osobním odkazem nebo QR kódem z oznámení se dostanou dovnitř i bez PINu. Zamknout jde jen se zapnutým PINem hostů.",
          "**PIN správy** je jiné číslo, jen pro vás. Slouží k přihlášení do správy bez e-mailu.",
          "Dary: v sekci **Dary** vyplníte číslo účtu. Hosté ho uvidí s QR kódem pro platbu z mobilu až po zadání PINu hostů, bez zapnutého PINu ho neuvidí nikdo. Na anglické verzi webu se ukáže i IBAN, a když vyplníte **Majitel účtu**, i evropský QR kód pro platbu v eurech.",
        ],
      },
    ],
  },
  {
    id: "zmeny",
    title: "Rychlá změna a návrat k dřívější verzi",
    blocks: [
      {
        p: "**Rychlá změna** na stránce **Můj web** zobrazí nahoře na webu pruh s krátkým oznámením, například o změně času. Napište text, zaškrtněte **Zobrazit pruh na webu** a klepněte na **Uložit rychlou změnu**. Projeví se hned, bez zveřejňování. Funguje až po prvním zveřejnění webu.",
      },
      {
        p: "Pokud se vám změna nepovedla, na stránce **Historie verzí** klepněte u dřívější verze na **Vrátit tuto verzi** a pak na **Zveřejnit změny**.",
      },
    ],
  },
  {
    id: "po-svatbe",
    title: "Po svatbě",
    blocks: [
      {
        p: "Den po svatbě (u vícedenní svatby po posledním dni) se web sám přepne do režimu poděkování. Formulář pro potvrzení účasti a údaje o darech zmizí a hosté uvidí poděkování a fotky. Nic nemusíte nastavovat.",
      },
      {
        p: "Na stránce **Můj web** pak uvidíte, kdy web přestane být veřejný a kdy smažeme údaje hostů. Předtím si stáhněte export hostů a fotografie tlačítkem **Stáhnout všechny fotografie**.",
      },
    ],
  },
  {
    id: "kdyz-neco-nejde",
    title: "Když něco nejde",
    blocks: [
      {
        list: [
          "**Fotka se nenahraje**: zkontrolujte formát (JPEG, PNG nebo WebP, ne HEIC) a velikost do 40 MB. U chyby klepněte na **Zkusit znovu**.",
          "**Fotka na webu není**: sekce Fotografie je skrytá nebo schovaná za PINem, nebo jste zatím neklepli na **Zveřejnit změny**.",
          "**Úvodní fotka se nezobrazuje**: zkontrolujte, že je vybraná v sekci **Úvod** a že jste klepli na **Zveřejnit změny**.",
          "**Hosté nevidí změnu**: klepněte na **Zveřejnit změny**. Hostům pomůže i obnovení stránky.",
          "**Nepřišel kód**: podívejte se do spamu a do složky Hromadné. Případně klepněte na **Poslat nový kód** (v průvodci **Poslat kód znovu**).",
          "**Zapomněli jste PIN hostů**: v části **Přístup** nastavte nový tlačítkem **Změnit PIN**. Pozor, starý PIN pak přestane platit.",
        ],
      },
      {
        p: "Pořád si nevíte rady? Napište nám na podpora@se-vezmou.cz, odpovídáme osobně. Pomůže, když přidáte adresu svého webu a snímek obrazovky.",
      },
    ],
  },
];
