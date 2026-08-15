import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  loeseLocale,
  normalisierePfad,
  verfuegbareLocales,
  waehleLocale,
  type LocaleAuswahl,
} from '@webmidgar/io';

/**
 * Locale-bewusste Pfadauflösung für alle Realdatenproben.
 *
 * **Warum das nicht optional ist.** Eine FF7-Installation legt einen Teil
 * ihrer Daten doppelt ab (`data/<rel>` und `data/lang-<code>/<rel>`). Bis
 * 2026-08-15 griffen alle Proben fest auf den Wurzelzweig — auf der
 * Kalibrierinstallation ist das der **deutsche**, während das Original und
 * seit heute auch die Demo `data/lang-en/` laden. Messungen gegen den einen
 * Zweig und eine Demo gegen den anderen sind genau die Mischung, die
 * `pruefeVerbund` verbietet; sie hier zu belassen hieße, eine Regel
 * aufzustellen und sich selbst auszunehmen.
 *
 * **Was die Umstellung ändert und was nicht** (gemessen, `locale-probe`):
 * Gegner- und Attackennamen werden englisch, KI-Skripte unterscheiden sich in
 * 76 von 256 Szenen, und **Szene 4 ist im englischen Zweig leergeräumt**.
 * Kameras, Formationen, Setup und Attackenrecords sind byteidentisch — mit
 * genau dieser einen Szene als Ausnahme.
 */

export const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

/**
 * Sprachwunsch aus der Umgebung. Ohne ihn entscheidet die Installation:
 * genau ein Zweig ⇒ dieser, mehrere ⇒ `en`. Kein fest verdrahtetes `lang-en`.
 */
const WUNSCH = process.env['WEBMIDGAR_LOCALE'] ?? null;

function baum(): Set<string> {
  const out = new Set<string>();
  const wurzel = join(REAL_DIR, 'data');
  if (!existsSync(wurzel)) return out;
  const lauf = (abs: string, rel: string): void => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) lauf(join(abs, e.name), r);
      else out.add(normalisierePfad(r));
    }
  };
  lauf(wurzel, 'data');
  return out;
}

let zwischenspeicher: { dateien: Set<string>; locale: string | null } | null = null;
function stand(): { dateien: Set<string>; locale: string | null } {
  if (!zwischenspeicher) {
    const dateien = baum();
    zwischenspeicher = { dateien, locale: waehleLocale(verfuegbareLocales(dateien), WUNSCH) };
  }
  return zwischenspeicher;
}

/** Gewählter Sprachzweig der Installation (`null` = keiner vorhanden). */
export function realLocale(): string | null {
  return stand().locale;
}

/** Auflösung mit Herkunftsangabe — für Proben, die den Zweig protokollieren. */
export function realAuswahl(rel: string): LocaleAuswahl | null {
  const { dateien, locale } = stand();
  return loeseLocale(rel, locale, (p) => dateien.has(p));
}

/**
 * Absoluter Pfad zu `data/<rel>` bzw. `data/lang-<code>/<rel>`, je nachdem,
 * was die Installation führt. Fehlt die Datei in beiden Zweigen, kommt der
 * Wurzelpfad zurück — der Aufrufer prüft ohnehin mit `existsSync`, und ein
 * geworfener Fehler hier würde `describe.skipIf` unbrauchbar machen.
 */
export function realPfad(rel: string): string {
  const a = realAuswahl(rel);
  const p = a ? a.pfad : `data/${normalisierePfad(rel)}`;
  return join(REAL_DIR, ...p.split('/'));
}
