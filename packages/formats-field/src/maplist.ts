import { fdiag, type FieldDiagnostic } from './diagnostics.js';

/**
 * `maplist` — die Namenstabelle des Field-Archivs. Sie ist kein Field, sondern
 * ein eigener Eintrag in `flevel`, und sie ist der Schlüssel für den
 * Field-Wechsel: Die Zielangabe eines Gateways ist ein **Index in diese
 * Liste**, kein Index in die Archivreihenfolge.
 *
 * Layout ✅ realdaten-validiert (S11): `u16 count` + `count` Namen à 32 Byte,
 * ASCII, mit Nullen aufgefüllt, unkomprimiert. Im Bestand: 788 Einträge, davon
 * 787 auf einen echten Field-Eintrag auflösbar.
 *
 * Belegt wurde die Zuordnung über die Rückkantenprobe: Fasst man die
 * Gateway-Ziele als gerichteten Graphen auf, haben **78,8 %** der Kanten eine
 * Gegenkante — gegen ein Kontrollniveau von 0,2 % bei verwürfelten Zielen.
 */

export const MAPLIST_NAME_LEN = 32;

export interface FieldMaplist {
  schemaVersion: 1;
  /** Namen in Listenreihenfolge, kleingeschrieben; leere Slots als "". */
  names: string[];
}

export function parseMaplist(
  data: Uint8Array,
  asset: string,
  diagnostics: FieldDiagnostic[],
): FieldMaplist | null {
  if (data.length < 2) {
    diagnostics.push(fdiag('E-MAPLIST-SIZE', asset, `Eintrag zu kurz (${data.length} B)`));
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(0, true);
  const expected = 2 + count * MAPLIST_NAME_LEN;
  if (expected !== data.length) {
    diagnostics.push(
      fdiag('E-MAPLIST-SIZE', asset, `erwartet ${expected} B (${count} Namen), tatsächlich ${data.length}`),
    );
    return null;
  }
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const base = 2 + i * MAPLIST_NAME_LEN;
    let end = base;
    while (end < base + MAPLIST_NAME_LEN && data[end] !== 0) end++;
    names.push(String.fromCharCode(...data.subarray(base, end)).toLowerCase());
  }
  return { schemaVersion: 1, names };
}

/**
 * Löst eine Gateway-Zielangabe zu einem Fieldnamen auf.
 * Gibt `null` zurück, wenn der Index außerhalb liegt oder der Slot leer ist —
 * beides kommt im Bestand vor und ist kein Fehler, sondern eine Sackgasse.
 */
export function resolveMaplistTarget(maplist: FieldMaplist, index: number): string | null {
  const name = maplist.names[index];
  return name !== undefined && name.length > 0 ? name : null;
}
