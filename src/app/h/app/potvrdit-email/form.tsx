"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { confirmBackupAction } from "./actions";

/** Tlačítko potvrzení; výsledek oznámí živá oblast (WCAG 4.1.3), po potvrzení tlačítko zmizí. */
export function BackupConfirmForm({
  token,
  labels,
}: {
  token: string;
  labels: { submit: string; done: string; invalid: string; generic: string };
}) {
  const [state, action, pending] = useActionState(confirmBackupAction, null);
  const error = state === "invalid" ? labels.invalid : state === "generic" ? labels.generic : null;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormAlert>{error}</FormAlert>
      <div role="status">
        {state === "confirmed" ? (
          <p className="text-ink text-lg" data-testid="backup-confirmed">
            {labels.done}
          </p>
        ) : null}
      </div>
      {state === "confirmed" ? null : (
        <>
          <input type="hidden" name="t" value={token} />
          <Button type="submit" fullWidth disabled={pending} aria-disabled={pending || undefined}>
            {labels.submit}
          </Button>
        </>
      )}
    </form>
  );
}
