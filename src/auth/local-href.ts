import "server-only";
import { appHref } from "@/admin/paths";
import { getUiLocale } from "./request";

/**
 * Cesta v jazyce rozhraní správy (`/prihlaseni` česky, `/en/prihlaseni` anglicky). Jazyk na hostiteli
 * `app.` určuje cesta, takže každé přesměrování a odkaz uvnitř správy musí jazyk nést sám; jinak by
 * anglický uživatel po prvním kroku přeskočil do češtiny.
 */
export async function localHref(path: string): Promise<string> {
  return appHref(path, await getUiLocale());
}
