import type { WaitlistErrors } from "@/lib/waitlist";

/** Stav formuláře čekací listiny mezi Server Action a formulářem. */
export interface WaitlistFormState {
  status: "idle" | "success" | "invalid" | "rateLimited" | "error";
  errors?: WaitlistErrors;
  /** Co uživatel napsal, aby se po chybě pole nevyprázdnilo (jen jeho vlastní e-mail zpět jemu). */
  email?: string;
}

export const initialWaitlistState: WaitlistFormState = { status: "idle" };
