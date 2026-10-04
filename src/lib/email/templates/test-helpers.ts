import { authorProjects, operator } from "@/config/operator";
import type { expect as Expect } from "vitest";
import type { RenderedEmail } from "./shared";

/** HTML bez loga a patičky (tělo zprávy), aby se pravidla o odkazech a zdrojích posuzovala jen nad obsahem. */
export const coreHtml = (html: string) =>
  html
    .replace(/<!--logo-->[\s\S]*?<!--\/logo-->/g, "")
    .replace(/<!--footer-->[\s\S]*?<!--\/footer-->/g, "");

/** Text bez patičky (od oddělovače podpisu). */
export const coreText = (text: string) => text.split("\n-- \n")[0];

/** Společné ověření loga (jen přes cid) a patičky (kontakt a dva projekty s UTM značkami). */
export function expectLogoAndFooter(email: RenderedEmail, expect: typeof Expect) {
  expect(email.inline?.map((i) => i.contentType)).toEqual(["image/png"]);
  expect(email.html).toContain('<img src="cid:logo@se-vezmou.cz"');
  expect(email.html).not.toMatch(/src="https?:/);
  expect(email.html).toContain(`mailto:${operator.contact}`);
  for (const { host } of authorProjects) {
    expect(email.html).toContain(
      `href="https://${host}/?utm_source=se-vezmou&amp;utm_medium=email&amp;utm_campaign=paticka-emailu"`,
    );
    expect(email.text).toContain(
      `https://${host}/?utm_source=se-vezmou&utm_medium=email&utm_campaign=paticka-emailu`,
    );
  }
}
