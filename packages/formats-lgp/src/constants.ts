/**
 * LGP-Containerlayout — Referenz: Masterplan Phase 1.1.
 * Alle Werte sind Formatfakten (🟢) laut Community-Dokumentation und werden
 * durch Golden-Fixture-Roundtrips abgesichert.
 */

/** Länge des Creator-Felds am Dateianfang (rechtsbündig, NUL-gepolstert). */
export const CREATOR_LEN = 12;

/** Header = Creator + uint32 Dateianzahl. */
export const HEADER_LEN = CREATOR_LEN + 4;

/** Ein TOC-Record: name[20] + offset u32 + check u8 + conflict u16. */
export const NAME_LEN = 20;
export const TOC_ENTRY_LEN = NAME_LEN + 4 + 1 + 2; // 27

/**
 * Die beiden einzigen Werte, die der „Check-Code" im gemessenen Bestand
 * annimmt (O5, 45.563 TOC-Einträge über 56 Archive). Gemessene Invariante,
 * kein Formatfakt — Herleitung und Grenzen in [check-byte.ts](check-byte.ts).
 */
export const CHECK_BYTE_PLAIN = 0x0e;
export const CHECK_BYTE_HRC = 0x0b;

/** Lookup-Tabelle: 30×30 Buckets à (u16 tocStart1based + u16 count). */
export const LOOKUP_DIM = 30;
export const LOOKUP_ENTRY_LEN = 4;
export const LOOKUP_TABLE_LEN = LOOKUP_DIM * LOOKUP_DIM * LOOKUP_ENTRY_LEN; // 3600

/** Datenvorsatz je Eintrag: name[20] + u32 Länge. */
export const DATA_PREFIX_LEN = NAME_LEN + 4; // 24

/** Ordnernamensfeld in Konflikttabellen-Records. Zu validieren (🟡): Feldbreite. */
export const CONFLICT_DIR_LEN = 128;

/**
 * Funktionale Format-Signaturen (Formatfakten, keine schöpferischen Inhalte).
 * Zu validieren (🟡): ob alle PC-Releases den Terminator identisch schreiben.
 */
export const CREATOR_DEFAULT = 'SQUARESOFT';
export const TERMINATOR = 'FINAL FANTASY7';

/** Harte Obergrenze der Dateianzahl für Header-Plausibilität (E-LGP-HDR). */
export const MAX_FILE_COUNT = 1 << 20;
