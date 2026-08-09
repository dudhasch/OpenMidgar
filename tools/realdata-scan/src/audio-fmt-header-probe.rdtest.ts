import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * O1 — Der Vorspann von `audio.fmt`. **Gelöst.**
 *
 * **Stand vorher.** Die Eintragsgröße 74 B war hypothesenfrei gemessen
 * (Abstandshistogramm häufiger u32-Konstanten: 87,1 % bei 74). Ein
 * WAVEFORMATEX mit 32 B Zusatz ist 50 B lang, also blieben rechnerisch 24 B
 * Vorspann übrig — aber unverbucht. Geprüft wurden die Versätze 0 und 10; sie
 * trafen in 198/738 bzw. 265/738 Einträgen. Faktor 1,34, kein Befund.
 *
 * **Der Fehler im ersten Anlauf.** Der Versatz 24 wurde nie geprüft. Die
 * Suche lief über die Stellen, an denen das WAVEFORMATEX vermutet wurde,
 * nicht über die, die nach der Rechnung 24 + 50 = 74 übrig blieben.
 *
 * **Die Auslegung** (Struktur von FF7SND benannt, hier gegen die eigenen Daten
 * geprüft): je Eintrag 24 B Vorspann aus sechs `uint32` —
 * `Length, Offset, Loop, Count, Start, End` — gefolgt von einem
 * `ADPCMWAVEFORMAT` (18 B WAVEFORMATEX + 32 B Zusatz = 50 B). Zusammen 74 B.
 *
 * **Warum das hier als belegt gilt.** Nicht wegen einer Quote, sondern wegen
 * des **Accountings**: Die 198 belegten Einträge beschreiben Bereiche in
 * `audio.dat`, die **lückenlos und überlappungsfrei** bei 0 beginnen und
 * zusammenhängend bis 23.227.348 laufen. Eine falsche Feldzuordnung erzeugt
 * so etwas nicht — sie erzeugt Löcher oder Überschneidungen. Das ist die
 * stärkste Beweisklasse, die dieses Projekt kennt.
 *
 * **Zweite, unabhängige Vorhersage.** Ist `Loop` wirklich ein Schleifen-Flag
 * und sind `Start`/`End` die zugehörigen Marken, dann muss `End` genau dann
 * gesetzt sein, wenn `Loop` gesetzt ist. Diese Vorhersage stammt aus der
 * Benennung und kann unabhängig durchfallen.
 *
 * **Der Nullwert-Fallstrick, diesmal andersherum.** Eintrag 198 trägt
 * `Length == 0` und als `Offset` genau das Ende der Nutzdaten — er ist die
 * Abschlussmarke. Alles danach ist **uninitialisierter Speicher**: Die Bytes
 * folgen dem MSVC-Füllmuster 0xCD. Diese Einträge dürfen nicht mitgezählt
 * werden; täte man es, sähe jede Quote schlagartig schlechter aus, ohne dass
 * die Auslegung falsch wäre. Genau daran ist der zweite Anlauf gescheitert.
 *
 * **Offen bleibt** (🟡, kleiner als vorher): `audio.dat` ist 71.738.528 B
 * groß, referenziert sind davon 23.227.348 B — 32,4 %. Die restlichen 48,5 MB
 * werden von dieser Tabelle nicht adressiert.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten, Wertebereiche.
 * Keine Audiodaten, keine Rohbytes, keine Pfade.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const FMT = join(REAL_DIR, 'data', 'sound', 'audio.fmt');
const DAT = join(REAL_DIR, 'data', 'sound', 'audio.dat');

const available = existsSync(FMT) && existsSync(DAT);

const RECORD_LEN = 74;
/** Der Vorspann ist 24 B lang; danach beginnt das WAVEFORMATEX. */
const WAVE_AT = 24;

const FORMAT_TAGS = new Set([1, 2]);
const CHANNELS = new Set([1, 2]);
const RATES = new Set([11025, 22050, 44100]);
const BITS = new Set([4, 8, 16]);

/** Steht bei `o` ein plausibles WAVEFORMATEX? */
function istWave(view: DataView, o: number): boolean {
  if (o + 18 > view.byteLength) return false;
  return (
    FORMAT_TAGS.has(view.getUint16(o, true)) &&
    CHANNELS.has(view.getUint16(o + 2, true)) &&
    RATES.has(view.getUint32(o + 4, true)) &&
    BITS.has(view.getUint16(o + 14, true))
  );
}

describe.skipIf(!available)('Realdaten: audio.fmt-Vorspann (O1)', () => {
  it('belegt den 24-B-Vorspann per lückenlosem Accounting gegen audio.dat', async () => {
    const fmt = new Uint8Array(await readFile(FMT));
    const datLen = statSync(DAT).size;
    const view = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);

    let belegt = 0;
    let cbSize32 = 0;
    let numCoef7 = 0;
    let loopMitEnde = 0;
    let loopGesetzt = 0;
    let endeGesetzt = 0;
    let abschlussMarke = -1;
    let abschlussOffsetPasst = false;

    const bereiche: Array<{ von: number; bis: number }> = [];
    let summeLaengen = 0;

    // Kontrollversätze: dieselbe Prüfung an bewusst falschen Stellen.
    let kontrolle0 = 0;
    let kontrolle10 = 0;

    for (let i = 0; i * RECORD_LEN + RECORD_LEN <= fmt.length; i++) {
      const base = i * RECORD_LEN;
      if (!istWave(view, base + WAVE_AT)) {
        // Erster Bruch: das ist die Abschlussmarke, danach folgt nur noch
        // uninitialisierter Speicher. Ab hier wird nichts mehr gezählt.
        abschlussMarke = i;
        abschlussOffsetPasst = view.getUint32(base + 4, true) === summeLaengen && view.getUint32(base, true) === 0;
        break;
      }
      belegt++;

      const laenge = view.getUint32(base, true);
      const versatz = view.getUint32(base + 4, true);
      const loop = view.getUint32(base + 8, true);
      const ende = view.getUint32(base + 20, true);

      summeLaengen += laenge;
      bereiche.push({ von: versatz, bis: versatz + laenge });

      if (loop !== 0) loopGesetzt++;
      if (ende !== 0) endeGesetzt++;
      if ((loop !== 0) === (ende !== 0)) loopMitEnde++;

      if (view.getUint16(base + WAVE_AT + 16, true) === 32) cbSize32++;
      if (view.getUint16(base + WAVE_AT + 20, true) === 7) numCoef7++;

      if (istWave(view, base)) kontrolle0++;
      if (istWave(view, base + 10)) kontrolle10++;
    }

    // Accounting per Intervall-Sweep.
    bereiche.sort((a, b) => a.von - b.von);
    let ueberlappungen = 0;
    let luecken = 0;
    let ausserhalb = bereiche.filter((b) => b.bis > datLen).length;
    for (let i = 1; i < bereiche.length; i++) {
      const vorher = bereiche[i - 1]!;
      const jetzt = bereiche[i]!;
      if (jetzt.von < vorher.bis) ueberlappungen++;
      else if (jetzt.von > vorher.bis) luecken++;
    }
    const beginntBeiNull = bereiche.length > 0 && bereiche[0]!.von === 0;

    const q = (n: number): string => `${((n / Math.max(1, belegt)) * 100).toFixed(1)}%`;

    console.log(
      'audio.fmt-Vorspann (O1):',
      JSON.stringify(
        {
          'belegte Einträge': belegt,
          'Abschlussmarke bei Eintrag': abschlussMarke,
          'Abschlussmarke: Length 0 und Offset == Datenende': abschlussOffsetPasst,
          'cbSize == 32': q(cbSize32),
          'NumCoef == 7': q(numCoef7),
          'Loop gesetzt genau dann wenn End gesetzt': `${loopMitEnde}/${belegt} (${q(loopMitEnde)})`,
          'davon Loop gesetzt': loopGesetzt,
          'davon End gesetzt': endeGesetzt,
          Accounting: {
            'audio.dat Bytes': datLen,
            'referenzierte Bytes': summeLaengen,
            'Anteil referenziert': `${((summeLaengen / datLen) * 100).toFixed(2)}%`,
            'beginnt bei 0': beginntBeiNull,
            Lücken: luecken,
            Überlappungen: ueberlappungen,
            'ausserhalb der Datei': ausserhalb,
          },
          'Kontrolle Versatz 0': `${kontrolle0}/${belegt} (${q(kontrolle0)})`,
          'Kontrolle Versatz 10': `${kontrolle10}/${belegt} (${q(kontrolle10)})`,
        },
        null,
        1,
      ),
    );

    expect(belegt).toBeGreaterThan(100);

    // 1. Jeder belegte Eintrag trägt die MS-ADPCM-Standardbelegung.
    expect(cbSize32).toBe(belegt);
    expect(numCoef7).toBe(belegt);

    // 2. Das Accounting ist der eigentliche Beweis: lückenlos, überlappungs-
    //    frei, bei 0 beginnend, innerhalb der Datei.
    expect(beginntBeiNull).toBe(true);
    expect(luecken).toBe(0);
    expect(ueberlappungen).toBe(0);
    expect(ausserhalb).toBe(0);

    // 3. Die Abschlussmarke bestätigt die Feldzuordnung ein zweites Mal:
    //    Länge 0, Offset genau am Ende der Nutzdaten.
    expect(abschlussOffsetPasst).toBe(true);

    // 4. Unabhängige Vorhersage aus der Benennung: Loop ⟺ End.
    expect(loopMitEnde).toBe(belegt);

    // 5. Die Kontrollversätze fallen deutlich ab.
    expect(kontrolle0 * 2).toBeLessThan(belegt);
    expect(kontrolle10 * 2).toBeLessThan(belegt);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
