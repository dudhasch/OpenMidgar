import { mathProbe } from '@webmidgar/nfr-run';

/**
 * Math-Fingerprint-Seite: synchron im Modulrumpf, damit kopflose Läufe mit
 * `--dump-dom` das Ergebnis sehen. Zeigt je Funktion einen Digest über ein
 * festes Argumentgitter — die Diagnose zum R9-Digestvergleich.
 */
const ergebnis = { userAgent: navigator.userAgent, proben: mathProbe() };
(window as unknown as { __mathprobe: unknown }).__mathprobe = ergebnis;
const ziel = document.getElementById('mp');
if (ziel) ziel.textContent = JSON.stringify(ergebnis, null, 2);
