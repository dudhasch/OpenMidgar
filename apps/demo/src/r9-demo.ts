import { berechneReplayVektoren, messeMathExposition, kontrollLauf, vergleicheGegenErwartung } from '@webmidgar/nfr-run';

/**
 * R9-Vergleichsseite für Cross-Browser-Läufe.
 *
 * Bewusst **synchron** im Modulrumpf: Ein kopfloser Browserlauf mit
 * `--dump-dom` gibt das DOM aus, sobald das Laden abgeschlossen ist. Alles,
 * was erst in einem späteren Makrotask entsteht, ist zu diesem Zeitpunkt noch
 * nicht da — genau daran scheiterte die erste Fassung dieser Messung. Der
 * Digestvergleich braucht ohnehin keine Asynchronität.
 */

const vektoren = berechneReplayVektoren();
const vergleich = vergleicheGegenErwartung(vektoren);
const { exposition } = messeMathExposition(() => berechneReplayVektoren());
const { exposition: kontrolle } = messeMathExposition(() => kontrollLauf());

const ergebnis = {
  userAgent: navigator.userAgent,
  vektoren: vergleich,
  alleGleich: vergleich.every((v) => v.gleich),
  mathexposition: {
    unsicher: exposition.unsicher,
    summeUnsicher: exposition.summeUnsicher,
    summeSicher: exposition.summeSicher,
    anteilUnsicherProzent: +exposition.anteilUnsicherProzent.toFixed(2),
  },
  kontrolllaufUnsicher: kontrolle.summeUnsicher,
};

(window as unknown as { __r9: unknown }).__r9 = ergebnis;
const ziel = document.getElementById('r9');
if (ziel) ziel.textContent = JSON.stringify(ergebnis, null, 2);
console.log('R9:', JSON.stringify(ergebnis));
