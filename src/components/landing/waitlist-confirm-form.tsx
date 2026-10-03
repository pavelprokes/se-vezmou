"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { confirmWaitlistAction, type WaitlistConfirmState } from "./waitlist-action";

export interface WaitlistConfirmLabels {
  submit: string;
  pending: string;
  confirmed: string;
  invalid: string;
  error: string;
}

const initial: WaitlistConfirmState = { status: "idle" };

/** Tlačítko potvrzení zápisu; výsledek se ohlásí v živé oblasti. Funguje i bez JavaScriptu. */
export function WaitlistConfirmForm({
  token,
  labels,
}: {
  token: string;
  labels: WaitlistConfirmLabels;
}) {
  const [state, action, pending] = useActionState(confirmWaitlistAction, initial);
  if (state.status === "confirmed") {
    return (
      <p role="status" className="text-ink mt-8 flex items-start gap-2 text-lg">
        <Icon icon={CircleCheck} className="mt-1 shrink-0" />
        <span>{labels.confirmed}</span>
      </p>
    );
  }
  const message =
    state.status === "invalid" ? labels.invalid : state.status === "error" ? labels.error : null;
  return (
    <form action={action} className="mt-8 flex flex-col items-start gap-4">
      <input type="hidden" name="t" value={token} />
      <div role="alert">
        {message ? (
          <FormAlert>
            <Icon icon={CircleAlert} className="mt-0.5 shrink-0" />
            <span>{message}</span>
          </FormAlert>
        ) : null}
      </div>
      <Button type="submit" aria-disabled={pending || undefined}>
        {pending ? labels.pending : labels.submit}
      </Button>
    </form>
  );
}
