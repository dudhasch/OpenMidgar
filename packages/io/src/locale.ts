/**
 * Locale-Auflösung für Nicht-LGP-Dateien der Installation.
 *
 * **Warum es das gibt.** Eine FF7-Installation legt einen Teil ihrer Daten
 * doppelt ab: einmal unter `data/<rel>` und einmal unter
 * `data/lang-<code>/<rel>`. Das Original löst **je Datei** auf, nicht je
 * Verzeichnis — zusammengesetzte Archivpfade für GRAPHICS und BATTLE tragen
 * gar keine Sprachkomponente, `kernel` dagegen schon.
 *
 * **Was gemessen ist** (2026-08-15, an der Installation unter
 * `WEBMIDGAR_REAL_DIR`, ohne eine Instruktion des Originals zu lesen):
 *
 * 🟢 `kernel.bin` zerfällt in beiden Zweigen in **27 Sektionen**. Die
 *    Sektionen 0, 1, 4, 5, 6, 7, 8 sind byteidentisch, 9–26 durchweg
 *    verschieden (auch in der Länge). Sektion 3 unterscheidet sich in **3**
 *    Byte (`Ex-SOLDAT` gegen `Ex-SOLDIER`), Sektion 2 in **28**.
 *
 * 🟢 **Alle 28 Byte der Sektion 2 liegen im Blockindex bei `+0x0F1C`** — der
 *    Tabelle „Block → erste Szene" für `scene.bin`. Sie zählt im deutschen
 *    Zweig 34 Einträge, im englischen 33, und das Accounting trifft beide
 *    Dateien byteexakt (34 × 8192 = 278.528; 33 × 8192 = 270.336). Der
 *    Unterschied ist also **keine Übersetzung, sondern eine Packungsfolge**.
 *
 * 🟢 Daraus die Regel, die dieses Modul durchsetzt: **`kernel.bin` und
 *    `scene.bin` müssen aus demselben Zweig kommen.** Gemischt zeigt der
 *    Blockindex in die falsche Datei.
 *
 * 🟢 Der Locale-Unterschied in `scene.bin` selbst ist fast vollständig
 *    **Text**: Gegnernamen (216 von 256 Szenen unterscheiden sich *nur* im
 *    Namensfeld), Attackennamen (247/256), KI-Skripte (76/256). **Kameras,
 *    Formationen, Setup und Attackenrecords sind identisch** — mit genau
 *    einer Ausnahme, Szene 4, die im englischen Zweig vollständig
 *    leergeräumt ist (`0xFFFF` durchgehend) und im deutschen Reste trägt.
 *    Dazu zwei Byte an einem Gegner (`Lessaloploth`, `+0x98`) in drei Szenen.
 *
 * 🟢 `camdat0.bin`, `camdat1.bin`, `camdat2.bin` sind zwischen den Zweigen
 *    **byteidentisch** — für sie ist die Frage gegenstandslos.
 *
 * 🔴 Offen bleibt der **Mechanismus**: welche Aufrufstelle im Original die
 *    Sprachkomponente voranstellt. Das ist für uns folgenlos, weil wir
 *    ohnehin selbst auflösen; es steht hier, damit niemand die geklärte
 *    Tatsache mit der offenen Frage verwechselt.
 */

/** Sprachzweige heißen `lang-<code>`. */
export const LOCALE_PRAEFIX = 'lang-';

/** Wurzel des Datenbaums innerhalb der Installation. */
export const DATEN_WURZEL = 'data';

/**
 * Dateien, die zwingend aus **einem** Zweig stammen müssen. Nicht deklariert,
 * sondern gemessen: Für `kernel.bin`/`scene.bin` ist der Blockindex der
 * Beleg, für `WINDOW.BIN` das sprachabhängige Fontblatt, für `co.bin` und
 * `kernel2.bin` der schlichte Größenunterschied. `camdat*.bin` steht
 * ausdrücklich **nicht** hier — die Dateien sind identisch.
 */
export const LOCALE_VERBUND = [
  'kernel/KERNEL.BIN',
  'kernel/kernel2.bin',
  'kernel/WINDOW.BIN',
  'battle/scene.bin',
  'battle/co.bin',
] as const;

/** Ergebnis einer Auflösung; `geprueft` trägt die Kandidaten in Prüfreihenfolge. */
export interface LocaleAuswahl {
  /** Der Pfad, der benutzt wird — relativ zur Installationswurzel, '/'-getrennt. */
  readonly pfad: string;
  /** Relativpfad unterhalb von `data/`, mit dem aufgelöst wurde. */
  readonly rel: string;
  /** Sprachkennung, wenn der Sprachzweig gewonnen hat; sonst `null` (Wurzel). */
  readonly locale: string | null;
  /** Alle geprüften Kandidaten, in Reihenfolge — gehört in die Diagnose. */
  readonly geprueft: readonly string[];
}

/**
 * Trenner vereinheitlichen. Die Installation mischt sie nachweislich: Im
 * Original stehen zusammengesetzte Pfade wie `…\FINAL FANTASY VII\data\BATTLE`
 * mit `/` aus der Wurzel und `\` aus dem festverdrahteten Teil.
 */
export function normalisierePfad(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
}

/** `data/lang-en/kernel/KERNEL.BIN` → `'en'`; alles andere → `null`. */
export function localeAusPfad(pfad: string): string | null {
  const teile = normalisierePfad(pfad).split('/');
  const i = teile.findIndex((t) => t.toLowerCase() === DATEN_WURZEL);
  if (i < 0 || i + 1 >= teile.length) return null;
  const zweig = teile[i + 1]!;
  return zweig.toLowerCase().startsWith(LOCALE_PRAEFIX)
    ? zweig.slice(LOCALE_PRAEFIX.length).toLowerCase()
    : null;
}

/** Welche Sprachzweige führt diese Installation? Sortiert, ohne Doppel. */
export function verfuegbareLocales(pfade: Iterable<string>): string[] {
  const s = new Set<string>();
  for (const p of pfade) {
    const l = localeAusPfad(p);
    if (l) s.add(l);
  }
  return [...s].sort();
}

/**
 * Sprachwahl. `wunsch` gewinnt, wenn die Installation ihn führt. Sonst
 * entscheidet die Installation selbst: Führt sie **genau einen** Zweig, ist
 * das die Antwort — es gibt nichts zu wählen. Führt sie mehrere, gewinnt
 * `en`, sonst der alphabetisch erste. Nie fest verdrahtet.
 */
export function waehleLocale(verfuegbar: readonly string[], wunsch?: string | null): string | null {
  if (verfuegbar.length === 0) return null;
  if (wunsch) {
    const w = wunsch.toLowerCase();
    if (verfuegbar.includes(w)) return w;
  }
  if (verfuegbar.length === 1) return verfuegbar[0]!;
  return verfuegbar.includes('en') ? 'en' : verfuegbar[0]!;
}

/** Kandidaten für `rel` in Prüfreihenfolge: Sprachzweig zuerst, Wurzel danach. */
export function localeKandidaten(rel: string, locale: string | null): string[] {
  const r = normalisierePfad(rel);
  const wurzelPfad = `${DATEN_WURZEL}/${r}`;
  return locale ? [`${DATEN_WURZEL}/${LOCALE_PRAEFIX}${locale}/${r}`, wurzelPfad] : [wurzelPfad];
}

/**
 * Auflösung gegen einen Existenztest. `null` ⇔ die Datei liegt in keinem
 * Zweig; das ist ein zulässiges Ergebnis und keine Ausnahme (nicht jede
 * Installation ist vollständig).
 */
export function loeseLocale(
  rel: string,
  locale: string | null,
  existiert: (pfad: string) => boolean,
): LocaleAuswahl | null {
  const geprueft = localeKandidaten(rel, locale);
  for (const p of geprueft) {
    if (!existiert(p)) continue;
    return { pfad: p, rel: normalisierePfad(rel), locale: localeAusPfad(p), geprueft };
  }
  return null;
}

/**
 * Verbundprüfung: Alle aufgelösten Dateien aus {@link LOCALE_VERBUND} müssen
 * denselben Zweig getroffen haben. Rückgabe `null` ⇔ in Ordnung, sonst der
 * Klartextgrund für die Diagnose.
 *
 * Fehlende Dateien sind **kein** Verstoß — sie werden übersprungen. Der
 * Verstoß ist die *Mischung*, nicht die Lücke.
 */
export function pruefeVerbund(auswahlen: readonly LocaleAuswahl[]): string | null {
  const beteiligt = auswahlen.filter((a) =>
    (LOCALE_VERBUND as readonly string[]).some((v) => v.toLowerCase() === a.rel.toLowerCase()),
  );
  if (beteiligt.length < 2) return null;
  const zweige = new Map<string, string[]>();
  for (const a of beteiligt) {
    const schluessel = a.locale ?? '(Wurzel)';
    const liste = zweige.get(schluessel);
    if (liste) liste.push(a.pfad);
    else zweige.set(schluessel, [a.pfad]);
  }
  if (zweige.size <= 1) return null;
  const teile = [...zweige.entries()].map(([z, ps]) => `${z}: ${ps.join(', ')}`);
  return (
    `Locale-Verbund gemischt (${zweige.size} Zweige) — ${teile.join(' | ')}. ` +
    'kernel.bin trägt den Blockindex für scene.bin; gemischt zeigt er in die falsche Datei.'
  );
}
