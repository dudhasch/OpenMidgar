/**
 * Eigenes Spielstandsformat (S14, Masterplan-Vertrag). Bewusst **kein**
 * Schreiben originaler `save*.ff7`-Dateien: Ein eigenes, versioniertes Format
 * lässt sich migrieren, prüfen und dokumentieren — ein nachgebautes
 * Originalformat wäre in jeder Hinsicht schlechter und obendrein
 * verteilungsrechtlich heikel.
 *
 * Der Slot ist ein reiner Datenbaum. Alles, was der Wiederaufnahme dient,
 * steht drin; alles Ableitbare bewusst nicht.
 */

export const SAVE_SCHEMA_VERSION = 1;

export interface SaveSlot {
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  /** Fingerprint der Quellinstallation — ein Stand gehört zu seinen Daten. */
  sourceFingerprint: string;
  /** Zeitstempel der Erstellung (ms seit Epoche), vom Aufrufer gesetzt. */
  createdAt: number;
  /** Persistente Variablenregionen (Bankpaare), je 256 Byte. */
  globalState: Uint8Array[];
  /** Aktuelles Field und dessen Laufzeitzustand. */
  fieldId: string;
  /** Serialisierter `FieldSessionSnapshot`; hier bewusst opak gehalten. */
  fieldState: unknown;
  tickCounter: number;
  /** Anzeigename des Standes (Nutzereingabe, kein Originalinhalt). */
  label: string;
}

export interface SaveSlotMeta {
  index: number;
  schemaVersion: number;
  sourceFingerprint: string;
  createdAt: number;
  fieldId: string;
  tickCounter: number;
  label: string;
}

export function slotMeta(index: number, slot: SaveSlot): SaveSlotMeta {
  return {
    index,
    schemaVersion: slot.schemaVersion,
    sourceFingerprint: slot.sourceFingerprint,
    createdAt: slot.createdAt,
    fieldId: slot.fieldId,
    tickCounter: slot.tickCounter,
    label: slot.label,
  };
}

export type SaveLoadOutcome =
  | { ok: true; slot: SaveSlot; warnings: string[] }
  | { ok: false; reason: string };

/**
 * Prüft und migriert einen geladenen Stand.
 *
 * Zwei Fälle werden streng getrennt: Eine **unbekannte Schemaversion** wird
 * abgelehnt (lieber sichtbar scheitern als stillschweigend falsch laden), ein
 * **abweichender Quell-Fingerprint** dagegen nur gewarnt — der Nutzer darf
 * seinen Stand auch nach einer Neuinstallation öffnen, muss aber wissen, dass
 * die Daten nicht dieselben sind.
 */
export function acceptSlot(raw: unknown, expectedFingerprint?: string): SaveLoadOutcome {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'Kein Objekt' };
  const slot = raw as Partial<SaveSlot>;
  if (slot.schemaVersion !== SAVE_SCHEMA_VERSION) {
    return { ok: false, reason: `Schemaversion ${String(slot.schemaVersion)} wird nicht unterstützt` };
  }
  if (typeof slot.fieldId !== 'string' || !Array.isArray(slot.globalState)) {
    return { ok: false, reason: 'Pflichtfelder fehlen' };
  }
  const warnings: string[] = [];
  if (expectedFingerprint && slot.sourceFingerprint !== expectedFingerprint) {
    warnings.push(
      `Stand stammt von einer anderen Installation (${String(slot.sourceFingerprint).slice(0, 12)}…)`,
    );
  }
  return { ok: true, slot: slot as SaveSlot, warnings };
}

/**
 * Kanonische Serialisierung für den Fixpunkttest „Speichern → Laden →
 * Speichern ergibt dasselbe Ergebnis". Uint8Arrays werden als Zahlenfolgen
 * geführt, Schlüssel sortiert — sonst wäre der Vergleich von der
 * Einfügereihenfolge abhängig.
 */
export function canonicalizeSlot(slot: SaveSlot): string {
  const replacer = (_key: string, value: unknown): unknown => {
    if (value instanceof Uint8Array) return { __u8: Array.from(value) };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    return value;
  };
  return JSON.stringify(slot, replacer);
}
