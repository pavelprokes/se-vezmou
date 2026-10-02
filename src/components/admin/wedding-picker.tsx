"use client";

import { CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { useAdminT } from "./i18n";

export interface PickerWedding {
  weddingId: string;
  names: string;
  site: string | null;
  isCurrent: boolean;
}

/**
 * Výběr svatby, když má správce víc svateb (stejný e-mail). Přepnutí je akce serveru, která
 * zkontroluje, že svatba patří správci, a založí novou relaci; bez JavaScriptu funguje také.
 */
export function WeddingPicker({
  weddings,
  action,
}: {
  weddings: PickerWedding[];
  action: (
    state: { error: "failed" } | null,
    formData: FormData,
  ) => Promise<{ error: "failed" } | null>;
}) {
  const t = useAdminT();
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {weddings.map((wedding) => (
          <li
            key={wedding.weddingId}
            aria-current={wedding.isCurrent ? "true" : undefined}
            className="border-hairline bg-parchment flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
          >
            <div>
              <p className="text-ink font-medium">{wedding.names}</p>
              <p className="text-muted text-sm">{wedding.site ?? t("admin.picker.noAddress")}</p>
            </div>
            {wedding.isCurrent ? (
              <p className="text-pine flex items-center gap-2 font-medium">
                <Icon icon={CircleCheck} />
                {t("admin.picker.current")}
              </p>
            ) : (
              <Button type="submit" name="weddingId" value={wedding.weddingId} disabled={pending}>
                {t("admin.picker.switch", { names: wedding.names })}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <FormAlert>{state?.error ? t("admin.picker.error") : null}</FormAlert>
    </form>
  );
}
