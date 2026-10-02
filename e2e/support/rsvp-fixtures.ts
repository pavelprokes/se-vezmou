import { expect, test as base } from "./fixtures";
import { prepareWedding, lockWedding, type RsvpSetup, type TenantWedding } from "./rsvp-db";

export { expect };

/**
 * Fixtura pro testy RSVP a PINu hostů: výhradní zámek sdílené svatby a její příprava.
 * `wedding(setup)` uvede svatbu do stavu podle `setup`; zámek se uvolní po testu.
 */
export const test = base.extend<{ wedding: (setup?: RsvpSetup) => Promise<TenantWedding> }>({
  wedding: async ({ ip }, provide, testInfo) => {
    // Čekání na zámek patří do času testu: testy sdílené svatby běží po jednom.
    testInfo.setTimeout(Math.max(testInfo.timeout, 120_000));
    const unlock = await lockWedding();
    try {
      await provide((setup) => prepareWedding(ip, setup));
    } finally {
      await unlock();
    }
  },
});
