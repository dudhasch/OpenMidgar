import { fdiag, type FieldDiagnostic } from '../diagnostics.js';
import { SECTION, type FieldEncounters, type FieldEncounterSlot, type FieldEncounterTable } from '../nam.js';

/**
 * Encounter-Sektion (Sektion 7) — Zufallskämpfe eines Fields.
 * ✅ Realdaten-validiert (O3b, 2026-08-10): 702/702 Fields byteexakt.
 *
 * Layout — **zwei** Tabellen à 24 B, zusammen exakt 48 B:
 *
 * ```
 * u8  enabled      0 oder 1; 1 genau dann, wenn die Tabelle Inhalt hat
 * u8  rate         Begegnungsrate (🟡 Formel liegt in der EXE)
 * u16 standard[6]  Wahrscheinlichkeit << 10 | Formations-ID & 0x03FF
 * u16 special[4]   dito, für die Sonderanflüge (Rücken-/Seiten-/Zangenangriff)
 * u16 padding      1404/1404 genullt
 * ```
 *
 * **Wahrheitstest war die Summenprobe, nicht die Plausibilität der IDs.** Sind
 * die oberen 6 Bit der sechs Standardwörter Wahrscheinlichkeitsanteile, MUSS
 * ihre Summe in jeder belegten Tabelle gleich sein. Gemessen: **197/197
 * belegte Tabellen ergeben exakt 64**; über alle 1404 Tabellen gilt „Summe
 * == 64 ODER Tabelle genullt" ausnahmslos. Die Bit-Splits 8/9/11/12 liefern
 * 19,3 % / 31,0 % / 56,9 % / 55,3 % für ihren jeweils häufigsten Wert, eine um
 * 1 bzw. 3 Byte verschobene Wortbasis 84 bzw. 82 verschiedene Summen. Die
 * Zerlegung 6/10 ist damit gemessen, nicht übernommen.
 *
 * **Nullwert-Zweitrechnung (der eigentliche Fallstrick hier):** 1207 der 1404
 * Tabellen sind vollständig genullt — 520 der 702 Fields haben gar keine
 * Zufallskämpfe. Jede Quote oben ist **ohne** diese Tabellen gerechnet.
 *
 * Der Referenzschluss gegen `scene.bin` steht in
 * `tools/realdata-scan/src/encounter-closure.rdtest.ts`: Die ID ist eine
 * **globale Formationsnummer**, `scene = id >> 2`, `formation = id & 3`.
 */

export const ENC_TABLE_LEN = 24;
export const ENC_TABLE_COUNT = 2;
export const ENC_SECTION_LEN = ENC_TABLE_LEN * ENC_TABLE_COUNT;
export const ENC_STANDARD_SLOTS = 6;
export const ENC_SPECIAL_SLOTS = 4;
/** Wahrscheinlichkeitsanteile der Standardslots summieren sich auf 64. ✅ */
export const ENC_PROB_SUM = 64;
export const ENC_ID_MASK = 0x03ff;
export const ENC_PROB_SHIFT = 10;

/**
 * Gemessene Rolle der vier Sonderslots. Grundlage ist das Anflugbit im
 * Setup-Record der referenzierten Formation (`scene.bin`, u16@18 des
 * 20-B-Setups) — ein Bit, das von 328 Standard-IDs nur **eine** trägt:
 *
 * | Slot | Bit    | Anteil  |
 * |------|--------|---------|
 * | 0    | 0x0002 | 51 / 52 |
 * | 1    | 0x0002 | 49 / 50 |
 * | 2    | 0x0001 | 10 / 11 |
 * | 3    | 0x0004 | 36 / 36 |
 *
 * Bestätigt durch die Geometrie der Formationen: Von 328 Standard-IDs stehen
 * **327** vollständig vor der Gruppe (z < 0), keine einzige dahinter. Von 106
 * Sonder-IDs stehen **59** vollständig dahinter (Rückenangriff) und **44**
 * gleichzeitig davor und dahinter (Zangenangriff). Die Zuordnung von Slot 2
 * bleibt 🟡 (n = 11, Bits überlappen).
 */
export const ENC_SPECIAL_ROLE = ['back-attack-1', 'back-attack-2', 'side-attack', 'pincer'] as const;
export type EncounterSpecialRole = (typeof ENC_SPECIAL_ROLE)[number];

function readSlot(view: DataView, offset: number): FieldEncounterSlot {
  const raw = view.getUint16(offset, true);
  return { raw, probability: raw >>> ENC_PROB_SHIFT, formationId: raw & ENC_ID_MASK };
}

function parseTable(
  view: DataView,
  base: number,
  data: Uint8Array,
  field: string,
  index: number,
  diagnostics: FieldDiagnostic[],
): FieldEncounterTable {
  const flag = data[base]!;
  const standard: FieldEncounterSlot[] = [];
  const special: FieldEncounterSlot[] = [];
  for (let i = 0; i < ENC_STANDARD_SLOTS; i++) standard.push(readSlot(view, base + 2 + i * 2));
  for (let i = 0; i < ENC_SPECIAL_SLOTS; i++) special.push(readSlot(view, base + 2 + (ENC_STANDARD_SLOTS + i) * 2));
  const padding = view.getUint16(base + 22, true);
  const probabilitySum = standard.reduce((a, s) => a + s.probability, 0);
  const leer = data.subarray(base, base + ENC_TABLE_LEN).every((b) => b === 0);

  if (flag > 1) {
    diagnostics.push(fdiag('W-ENC-FLAG', field, `Tabelle ${index}: enabled = ${flag} (erwartet 0 oder 1)`, SECTION.ENCOUNTER));
  }
  if ((flag !== 0) !== !leer) {
    diagnostics.push(
      fdiag('W-ENC-FLAG', field, `Tabelle ${index}: enabled = ${flag}, Tabelle ${leer ? 'genullt' : 'belegt'}`, SECTION.ENCOUNTER),
    );
  }
  if (padding !== 0) {
    diagnostics.push(fdiag('W-ENC-PAD', field, `Tabelle ${index}: Padding = ${padding} (erwartet 0)`, SECTION.ENCOUNTER));
  }
  if (flag !== 0 && probabilitySum !== ENC_PROB_SUM) {
    diagnostics.push(
      fdiag(
        'W-ENC-PROBSUM',
        field,
        `Tabelle ${index}: Summe der Standardanteile = ${probabilitySum} (erwartet ${ENC_PROB_SUM})`,
        SECTION.ENCOUNTER,
      ),
    );
  }

  return { enabled: flag !== 0, enabledRaw: flag, rate: data[base + 1]!, standard, special, probabilitySum, padding };
}

export function parseEncounterSection(
  data: Uint8Array,
  field: string,
  diagnostics: FieldDiagnostic[],
): FieldEncounters | null {
  if (data.length !== ENC_SECTION_LEN) {
    diagnostics.push(
      fdiag('E-ENC-SIZE', field, `Sektion ${data.length} B, erwartet ${ENC_SECTION_LEN} B (2 × ${ENC_TABLE_LEN})`, SECTION.ENCOUNTER),
    );
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    schemaVersion: 1,
    tables: [
      parseTable(view, 0, data, field, 0, diagnostics),
      parseTable(view, ENC_TABLE_LEN, data, field, 1, diagnostics),
    ],
  };
}

/**
 * Zieht einen Standardkampf aus der Tabelle. `roll` ist ein Wert in
 * `[0, ENC_PROB_SUM)`; die Slots werden in Reihenfolge kumuliert — genau die
 * Verteilung, die die gemessene Summenregel erzwingt. Rückgabe `null`, wenn
 * die Tabelle nicht aktiv ist oder der Wurf außerhalb liegt.
 *
 * Bewusst KEINE eigene Zufallsquelle: Der Wurf kommt vom Aufrufer, damit der
 * Replay-Determinismus (ADR-006) erhalten bleibt.
 */
export function selectStandardEncounter(table: FieldEncounterTable, roll: number): FieldEncounterSlot | null {
  if (!table.enabled) return null;
  if (!Number.isInteger(roll) || roll < 0 || roll >= ENC_PROB_SUM) return null;
  let acc = 0;
  for (const slot of table.standard) {
    acc += slot.probability;
    if (roll < acc) return slot.raw === 0 ? null : slot;
  }
  return null;
}

/**
 * Sonderanflug-Wurf: liefert den Slot, dessen Anteil den Wurf trifft.
 * Die vier Sonderslots tragen **absolute** Anteile (sie summieren sich NICHT
 * auf 64 — gemessen: Gesamtsummen 64/72/76/80). `roll` ist deshalb ein Wert in
 * `[0, ENC_PROB_SUM)`, der je Slot getrennt geprüft wird.
 */
export function selectSpecialEncounter(table: FieldEncounterTable, slot: number, roll: number): FieldEncounterSlot | null {
  if (!table.enabled) return null;
  const s = table.special[slot];
  if (!s || s.raw === 0 || s.probability === 0) return null;
  return roll < s.probability ? s : null;
}

/** Szene und Formationsindex einer globalen Formations-ID (✅ Referenzschluss). */
export function splitFormationId(formationId: number): { scene: number; formation: number } {
  return { scene: (formationId & ENC_ID_MASK) >>> 2, formation: formationId & 3 };
}
