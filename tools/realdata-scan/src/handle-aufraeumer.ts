import { afterAll } from 'vitest';
import { alleQuellenSchliessen } from './node-source.js';

/**
 * Aufräumnetz für offene Dateihandles — eingehängt über `setupFiles` in
 * `vitest.realdata.config.ts` und damit für JEDE Realdaten-Probe wirksam.
 *
 * **Warum zentral und nicht nur je Probe.** Ein `FileHandle`, das nur
 * weggeworfen statt geschlossen wird, meldet Node seit v20 als unbehandelten
 * `ERR_INVALID_STATE` — aber erst, wenn die Speicherbereinigung darüber
 * stolpert. Das ist typischerweise eine ganz andere Probe, oft eine, die
 * `global.gc()` aufruft (die NFR- und Soak-Läufe tun das wegen `--expose-gc`).
 * Der Fehler landet also bei einem Unbeteiligten im Protokoll, und die Zahl der
 * Fehler schwankt von Lauf zu Lauf. Kein Test schlägt deswegen fehl — aber ein
 * ECHTER unbehandelter Fehler ginge in diesem Rauschen unter.
 *
 * Die Proben schließen ihre Quellen weiterhin selbst (`await dir.closeAll()`);
 * das gibt die Handles früh frei. Dieser Haken fängt nur ab, was dabei
 * durchrutscht: eine neue Probe, die den Aufruf vergisst, oder ein Testabbruch,
 * der ihn überspringt.
 */
afterAll(async () => {
  await alleQuellenSchliessen();
});
