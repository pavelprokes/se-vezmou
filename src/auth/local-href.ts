import "server-only";
import { appHref } from "@/admin/paths";
import { getUiLocale } from "./request";

/**
 * Cesta v jazyce požadavku (`/prihlaseni` česky, `/en/prihlaseni` anglicky) na hostitelích `app.`
 * a `admin.`. Jazyk určuje cesta, takže každé přesměrování a odkaz musí jazyk nést sám; jinak by
 * anglický uživatel po prvním kroku přeskočil do češtiny.
 */
export async function localHref(path: string): Promise<string> {
  return appHref(path, await getUiLocale());
}
