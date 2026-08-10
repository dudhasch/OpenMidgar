import type { FieldBundle } from '@webmidgar/formats-field';
import { buildFieldTextTable, decodeFfText } from '@webmidgar/formats-kernel';

/**
 * Field-Dialogtexte (Dialogtext-Pipeline): dekodiert die Stringtabelle der
 * Script-Sektion zu Text — der Index entspricht dem String-Index, den
 * MESSAGE/ASK als `dialogId` in den Wartezustand schreiben.
 *
 * Quarantäne-Politik statt Exceptions (Masterplan 4.3): Ein einzelner
 * defekter Eintrag wird zu `null`, nie zu einem Abbruch — ein Field mit einem
 * kaputten String bleibt spielbar, und der Host zeigt für diesen Dialog
 * schlicht nichts an.
 *
 * Zeichentabelle: die Feldtext-Tabelle aus `@webmidgar/formats-kernel` —
 * ASCII-Versatz 0x20 (realdaten-abgeleitet, S13) plus Funktionscodes (F29:
 * Anführungszeichen, Zeilenumbruch, Seitenwechsel, Namensplatzhalter).
 */
export function decodeFieldDialogs(bundle: FieldBundle, names?: readonly string[]): (string | null)[] {
  const script = bundle.script;
  const section = bundle.rawSections[1];
  if (!script || !section) return [];
  const table = buildFieldTextTable(names);
  return script.stringOffsets.map((off) => {
    if (off === null) return null;
    const start = script.stringTableOffset + off;
    if (start < 0 || start >= section.length) return null;
    try {
      const decoded = decodeFfText(section, table, start);
      // Ohne 0xFF-Terminator lief der Dekoder aus der Sektion — der Text wäre
      // ein Artefakt des Überlaufs, nicht der Tabelle: Quarantäne.
      return decoded.terminated ? decoded.text : null;
    } catch {
      return null;
    }
  });
}
