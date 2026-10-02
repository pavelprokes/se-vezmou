import { expect, test as base } from "./fixtures";
import { prepareWedding, lockWedding, type RsvpSetup, type TenantWedding } from "./rsvp-db";

export { expect };

/**
 * Fixtura pro testy RSVP a PINu hostů: výhradní zámek sdílené svatby a její příprava.
 * `wedding(setup)` uvede svatbu do stavu podle `setup`; zámek se uvolní po testu.
 */
export const test = base.extend<{ wedding: (setup?: RsvpSetup) => Promise<TenantWedding> }>({
  wedding: [
    async ({ ip }, provide) => {
      const unlock = await lockWedding();
      try {
        await provide((setup) => prepareWedding(ip, setup));
      } finally {
        await unlock();
      }
    },
    // Čekání na zámek (testy sdílené svatby běží po jednom) nesmí ukrajovat z času testu.
    { timeout: 900_000 },
  ],
});
