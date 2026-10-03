import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Testovací vrátka v produkčním sestavení bez opt-in jsou chyba nasazení: server se nespustí
    // a chyba je v logu (src/lib/test-hatches.ts).
    const { assertTestHatchesSafe } = await import("./src/lib/test-hatches");
    assertTestHatchesSafe();
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
