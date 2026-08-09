/**
 * Lesen originaler PC-Spielstände (`save*.ff7`) — S14.
 *
 * ✅ Realdaten-belegt (5 Dateien der Nutzerinstallation): Jede Datei ist
 * 65.109 Byte groß und zerfällt in einen 9-Byte-Kopf und **15 Slots à 4340
 * Byte**.
 *
 * ✅ **Prüfsumme geklärt (zweiter Anlauf).** Es ist CRC-16/CCITT — Polynom
 * `0x1021`, Startwert `0xFFFF`, unreflektiert — mit **Nachlauf-XOR `0xFFFF`**,
 * gerechnet über `slot[4 … 4340]`, also **4336 Byte**. Das Ergebnis steht als
 * u16 little-endian am Slotanfang; die Bytes 2–3 gehören zum selben Feld
 * (es ist ein DWord, von dem nur das untere Word belegt wird) und sind
 * deshalb vom Prüfbereich ausgenommen.
 *
 * Der erste Anlauf scheiterte an **zwei** Abweichungen gleichzeitig: Er
 * rechnete ab Offset 2 statt 4 und ohne Nachlauf-XOR. Die Probe belegt, dass
 * beide Korrekturen nötig sind — jede Teilkorrektur allein trifft 0 von 7.
 * Ergebnis: **8/8** nicht vollständig genullte Slots stimmen, **0/67**
 * genullte. Dass die genullten Slots durchfallen, ist hier ein Qualitäts-
 * merkmal: Mit Nachlauf-XOR ergibt eine Nullfolge eben nicht 0, also kann die
 * Trefferquote nicht — wie beim ersten Anlauf — von leeren Slots aufgebläht
 * werden.
 *
 * ✅ Damit ist auch die **Kopflänge entschieden**. Arithmetisch gehen 9/4340,
 * 24/4339, 39/4338 und 54/4337 alle auf; über die Prüfsumme trifft nur
 * 9/4340 (8/8), die drei Alternativen liegen bei 0/8.
 */

export interface SaveFileLayout {
  headerLength: number;
  slotLength: number;
  slotCount: number;
}

export const SAVE_LAYOUTS: readonly SaveFileLayout[] = [
  { headerLength: 9, slotLength: 4340, slotCount: 15 },
  { headerLength: 24, slotLength: 4339, slotCount: 15 },
  { headerLength: 39, slotLength: 4338, slotCount: 15 },
  { headerLength: 54, slotLength: 4337, slotCount: 15 },
];

export type SaveDiagnosticCode = 'E-SAVE-SIZE' | 'E-SAVE-LAYOUT' | 'W-SAVE-CHECKSUM';

export interface SaveDiagnostic {
  code: SaveDiagnosticCode;
  asset: string;
  slot?: number | undefined;
  detail: string;
}

export interface OriginalSaveSlot {
  index: number;
  /** false = nie beschriebener Slot (vollständig genullt). */
  occupied: boolean;
  /** Gespeicherte Prüfsumme: u16 LE am Slotanfang. */
  checksumRaw: number;
  /** Nachgerechnete Prüfsumme über `slot[4…]`. */
  checksumComputed: number;
  /**
   * Stimmen gespeicherte und gerechnete Prüfsumme überein? Bei genullten
   * Slots ist das erwartungsgemäß `false` — dort gibt es nichts zu schützen.
   */
  checksumValid: boolean;
  /** Rohbytes des Slots; die Feldbelegung ist noch nicht erschlossen. */
  raw: Uint8Array;
}

/** Prüfbereich: ab Offset 4, weil das Prüfsummenfeld selbst ein DWord ist. */
export const SAVE_CHECKSUM_FROM = 4;

/**
 * CRC-16/CCITT mit Nachlauf-XOR — bitweise statt tabellengetrieben, weil die
 * Fassung so unmittelbar gegen die Beschreibung lesbar bleibt. Ein Slot sind
 * 4336 Byte, das läuft auch bitweise in Mikrosekunden.
 */
export function saveSlotChecksum(slot: Uint8Array, from = SAVE_CHECKSUM_FROM): number {
  let r = 0xffff;
  for (let i = from; i < slot.length; i++) {
    r ^= slot[i]! << 8;
    for (let bit = 0; bit < 8; bit++) {
      r = r & 0x8000 ? ((r << 1) ^ 0x1021) & 0xffff : (r << 1) & 0xffff;
    }
  }
  return (r ^ 0xffff) & 0xffff;
}

export interface OriginalSaveFile {
  schemaVersion: 1;
  layout: SaveFileLayout;
  headerRaw: Uint8Array;
  slots: OriginalSaveSlot[];
  diagnostics: SaveDiagnostic[];
}

/**
 * Ein Slot gilt als belegt, sobald irgendein Byte von Null verschieden ist.
 *
 * Diese Regel hat die frühere 95-%-Schwelle abgelöst, weil die Prüfsumme sie
 * widerlegt hat: Im Bestand gibt es einen Slot, der zu über 95 % genullt ist
 * und trotzdem eine **gültige** Prüfsumme trägt — er ist beschrieben, nur
 * sehr dünn. Die Schwelle hätte ihn verworfen. „Nicht komplett genullt" ist
 * die strukturelle Aussage, die Prüfsumme die inhaltliche; beide gehören
 * getrennt gemeldet statt in eine Heuristik gemischt.
 */
export function isSlotOccupied(slot: Uint8Array): boolean {
  return slot.some((b) => b !== 0);
}

/**
 * @param sink Optionale Senke für Diagnosen. Nötig, weil die Funktion im
 *   Fehlerfall `null` liefert — ohne Senke wäre die Begründung für den
 *   Aufrufer unerreichbar, und „null ohne Grund" ist die unangenehmste Sorte
 *   Fehlschlag.
 */
export function parseOriginalSave(
  bytes: Uint8Array,
  asset: string,
  preferred: SaveFileLayout = SAVE_LAYOUTS[0]!,
  sink?: SaveDiagnostic[],
): OriginalSaveFile | null {
  const diagnostics: SaveDiagnostic[] = sink ?? [];
  const fits = (l: SaveFileLayout): boolean => l.headerLength + l.slotCount * l.slotLength === bytes.length;
  const layout = fits(preferred) ? preferred : SAVE_LAYOUTS.find(fits);
  if (!layout) {
    diagnostics.push({
      code: 'E-SAVE-SIZE',
      asset,
      detail: `Dateigröße ${bytes.length} passt zu keiner bekannten Aufteilung`,
    });
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const slots: OriginalSaveSlot[] = [];
  for (let i = 0; i < layout.slotCount; i++) {
    const start = layout.headerLength + i * layout.slotLength;
    const raw = bytes.slice(start, start + layout.slotLength);
    const occupied = isSlotOccupied(raw);
    const checksumRaw = view.getUint16(start, true);
    const checksumComputed = saveSlotChecksum(raw);
    const checksumValid = checksumRaw === checksumComputed;
    // Nur bei beschriebenen Slots ist eine falsche Prüfsumme ein Befund —
    // ein genullter Slot hat schlicht keine.
    if (occupied && !checksumValid) {
      diagnostics.push({
        code: 'W-SAVE-CHECKSUM',
        asset,
        slot: i,
        detail: `Prüfsumme ${checksumRaw} erwartet ${checksumComputed}`,
      });
    }
    slots.push({ index: i, occupied, checksumRaw, checksumComputed, checksumValid, raw });
  }
  return {
    schemaVersion: 1,
    layout,
    headerRaw: bytes.slice(0, layout.headerLength),
    slots,
    diagnostics,
  };
}
