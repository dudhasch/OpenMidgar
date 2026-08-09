/**
 * Lesen originaler PC-Spielstände (`save*.ff7`) — S14.
 *
 * ✅ Realdaten-belegt (5 Dateien der Nutzerinstallation): Jede Datei ist
 * 65.109 Byte groß und zerfällt in einen 9-Byte-Kopf und **15 Slots à 4340
 * Byte**. Belegte Slots lassen sich sicher von leeren unterscheiden: leere
 * Slots sind zu über 99,6 % genullt, belegte tragen eine völlig andere
 * Byteverteilung.
 *
 * 🔴 **Die Prüfsumme ist NICHT geklärt.** Fünf gängige CRC-16-Varianten
 * (CCITT-FALSE, XMODEM, KERMIT, X25-artig, ARC) treffen bei keinem einzigen
 * der acht belegten Slots. Die zunächst gemessene Trefferquote von 89 % war
 * ein Artefakt: Sie entsprach exakt den leeren Slots, für die eine CRC mit
 * Startwert 0 trivial 0 ergibt. Deshalb prüft dieser Parser **keine**
 * Prüfsumme und behauptet auch nicht, es zu tun.
 *
 * 🟡 Die Kopflänge ist arithmetisch mehrdeutig: 9/4340, 24/4339, 39/4338 und
 * 54/4337 gehen alle auf, weil die großen Nullregionen kleine
 * Grenzverschiebungen schlucken. Gewählt ist 9/4340 als die gängigste
 * Auslegung — die Alternativen sind über `SAVE_LAYOUTS` erreichbar.
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
  /** false = nie beschriebener Slot (praktisch vollständig genullt). */
  occupied: boolean;
  /** u16 am Slotanfang — im Original vermutlich eine Prüfsumme (🔴 ungeklärt). */
  checksumRaw: number;
  /** Rohbytes des Slots; die Feldbelegung ist noch nicht erschlossen. */
  raw: Uint8Array;
}

export interface OriginalSaveFile {
  schemaVersion: 1;
  layout: SaveFileLayout;
  headerRaw: Uint8Array;
  slots: OriginalSaveSlot[];
  diagnostics: SaveDiagnostic[];
}

/**
 * Ein Slot gilt als belegt, sobald er nennenswert von Null abweicht. Die
 * Schwelle ist bewusst großzügig: Ein leerer Slot ist im Bestand zu über
 * 99,6 % genullt, ein belegter zu höchstens 39 % — dazwischen liegt eine
 * riesige Lücke, die keine Feinjustierung braucht.
 */
export const SAVE_EMPTY_ZERO_SHARE = 0.95;

export function isSlotOccupied(slot: Uint8Array): boolean {
  let zeros = 0;
  for (const b of slot) if (b === 0) zeros++;
  return zeros / slot.length < SAVE_EMPTY_ZERO_SHARE;
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
    slots.push({
      index: i,
      occupied: isSlotOccupied(raw),
      checksumRaw: view.getUint16(start, true),
      raw,
    });
  }
  return {
    schemaVersion: 1,
    layout,
    headerRaw: bytes.slice(0, layout.headerLength),
    slots,
    diagnostics,
  };
}
