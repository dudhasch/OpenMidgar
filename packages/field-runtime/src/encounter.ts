import type { FieldRuntimeState } from '@webmidgar/interpreter';
import { nextRandom } from '@webmidgar/interpreter';

/**
 * Zufallskämpfe (S33) — Encounter-Tabelle + Schrittzähler-/Ratenmodell.
 *
 * **Formatfakt** (Sektion 7, FINDINGS 2026-08-10): 2 Tabellen à 24 B —
 * `u8 enabled · u8 rate · u16 standard[6] · u16 special[4] · u16 padding`;
 * im Wort stecken die Wahrscheinlichkeit in den oberen 6 Bit und die
 * Kampf-ID in den unteren 10 (`& 0x03FF`). Alle 434 Kampf-IDs des Bestands
 * lösen auf nicht-leere Formationen auf (S30-Referenzschluss). Die
 * maskenlose Auslegung ist die belegt falsche Gegenhypothese (IDs > 1023).
 *
 * **🔵 Ratenmodell** (das Original-Schrittzähler-Modell ist unbelegt,
 * Formatlage 🔴): Ein „Schritt" ist ein bewegter Takt; alle
 * `stepsPerCheck` Schritte wird geprüft: `roll256 < rate` ⇒ Kampf; die
 * Formation wird gewichtet über die 6-Bit-Wahrscheinlichkeiten der
 * `standard`-Plätze gezogen. Gewürfelt wird mit dem Interpreter-PRNG —
 * der liegt im Snapshot, Replays bleiben bitidentisch.
 */

export interface EncounterEntry {
  battleId: number;
  probability: number;
}

export interface EncounterTable {
  enabled: boolean;
  rate: number;
  standard: EncounterEntry[];
  /** Die 4 special-Plätze, roh maskiert (Semantik 🟡 — nicht im Modell). */
  special: EncounterEntry[];
}

export const ENCOUNTER_TABLE_LEN = 24;

export function parseEncounterTables(section: Uint8Array | undefined): EncounterTable[] {
  if (!section || section.length !== ENCOUNTER_TABLE_LEN * 2) return [];
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const tables: EncounterTable[] = [];
  for (const t of [0, 1]) {
    const base = t * ENCOUNTER_TABLE_LEN;
    const entryAt = (i: number): EncounterEntry | null => {
      const raw = view.getUint16(base + 2 + i * 2, true);
      if (raw === 0) return null;
      return { battleId: raw & 0x03ff, probability: raw >> 10 };
    };
    const standard: EncounterEntry[] = [];
    for (let i = 0; i < 6; i++) {
      const e = entryAt(i);
      if (e) standard.push(e);
    }
    const special: EncounterEntry[] = [];
    for (let i = 6; i < 10; i++) {
      const e = entryAt(i);
      if (e) special.push(e);
    }
    tables.push({ enabled: section[base] !== 0, rate: section[base + 1]!, standard, special });
  }
  return tables;
}

/**
 * Schrittzähler-Modell nach der Speedrun-Dokumentation („Step Count",
 * FF7 Comprehensive Speedrun Tutorial pt 3).
 *
 * Das Original führt eine Zählerhierarchie, die je bewegtem Bild
 * fortgeschrieben wird. Genau diese Hierarchie ist hier nachgebaut, weil erst
 * sie das erklärt, worauf Routen aufbauen: **Gehen senkt den Gefahrenzuwachs
 * auf ein Viertel, ohne die Schrittzählung zu verlangsamen** — man „limbot"
 * unter einer Prüfung hindurch.
 *
 * | Zähler      | Überlauf | Fortschreibung |
 * |-------------|----------|----------------|
 * | `fractions` | 256      | je bewegtem Bild; Überlauf treibt alles Übrige |
 * | `stepId`    | 256      | +2 je Überlauf (also alle 8 Bilder) |
 * | `danger`    | —        | +64 beim Rennen, +16 beim Gehen, je Überlauf |
 * | `offset`    | 256      | +13 je Überlauf von `stepId` |
 * | `formationId` | —      | +2 bzw. +3 je Kampf |
 *
 * 🔵 **Was aus der Beschreibung abgeleitet und nicht gemessen ist:** Die Doku
 * nennt „jedes Bild" für `fractions` und zugleich „alle 8 Bilder" für den
 * Überlauf — daraus folgt der Zuwachs 256/8 = **32 je Bild**; so steht es
 * nicht wörtlich dort. Ebenso ist die **Gefahrenschwelle** je Prüfung nicht
 * beziffert; `DANGER_PRO_PRUEFUNG` ist der freie Parameter des Modells.
 * Belegt aus dem Format bleiben allein Tabelle, Rate und die 6-Bit-
 * Wahrscheinlichkeiten.
 *
 * Der frühere Ersatz („alle 24 bewegten Takte würfeln") kannte weder Gehen
 * noch Schrittzählung — er war der Grund, warum Zufallskämpfe in Stadt-Fields
 * viel zu dicht kamen (F14).
 */

/** Zuwachs von `fractions` je bewegtem Bild — 256/8 (s. Kopfnotiz, 🔵). */
export const FRACTION_PRO_BILD = 32;
/** Bilder je Schrittzyklus — Doku: „Step ID increments … every 8 frames". */
export const BILDER_JE_SCHRITT = 8;
/** Zuwachs von `stepId` je Schrittzyklus. */
export const STEP_ID_ZUWACHS = 2;
/** Gefahrenzuwachs je Schrittzyklus beim Rennen bzw. Gehen (Verhältnis 4:1). */
export const DANGER_RENNEN = 64;
export const DANGER_GEHEN = 16;
/** Zuwachs von `offset` je Überlauf von `stepId`. */
export const OFFSET_ZUWACHS = 13;
/**
 * 🔵 Gefahrenschwelle je Prüfung — der freie Parameter. 1024 ergibt beim
 * Rennen eine Prüfung je 16 Schrittzyklen (128 Bilder ≈ 4,3 s bei 30 Hz) und
 * beim Gehen je 64 Zyklen; das deckt sich mit dem Bild aus der Doku, dass
 * kurze Gehstrecken eine Prüfung komplett überspringen lassen.
 */
export const DANGER_PRO_PRUEFUNG = 1024;

/** Sichtbarer Zählerstand — für Snapshot, Diagnose und Step-Routing. */
export interface EncounterCounters {
  fractions: number;
  stepId: number;
  danger: number;
  offset: number;
  formationId: number;
}

export class EncounterModel {
  fractions = 0;
  stepId = 0;
  danger = 0;
  offset = 0;
  formationId = 0;

  constructor(
    readonly table: EncounterTable,
    readonly dangerProPruefung = DANGER_PRO_PRUEFUNG,
  ) {}

  zaehler(): EncounterCounters {
    return {
      fractions: this.fractions,
      stepId: this.stepId,
      danger: this.danger,
      offset: this.offset,
      formationId: this.formationId,
    };
  }

  setzeZaehler(z: Partial<EncounterCounters>): void {
    if (z.fractions !== undefined) this.fractions = z.fractions;
    if (z.stepId !== undefined) this.stepId = z.stepId;
    if (z.danger !== undefined) this.danger = z.danger;
    if (z.offset !== undefined) this.offset = z.offset;
    if (z.formationId !== undefined) this.formationId = z.formationId;
  }

  /**
   * Ein bewegtes Bild. `laufend = false` bedeutet Gehen und damit ein Viertel
   * des Gefahrenzuwachses bei UNVERÄNDERTER Schrittzählung — der Kern des
   * Step-Routings. Liefert die Kampf-ID, wenn eine Prüfung anschlägt.
   */
  onMovedTick(state: FieldRuntimeState, laufend = true): number | null {
    if (!this.table.enabled || this.table.standard.length === 0) return null;

    this.fractions += FRACTION_PRO_BILD;
    if (this.fractions < 256) return null;
    this.fractions -= 256;

    // Schrittzyklus: stepId und danger wandern, offset bei stepId-Überlauf.
    const vorher = this.stepId;
    this.stepId = (this.stepId + STEP_ID_ZUWACHS) & 0xff;
    if (this.stepId <= vorher) this.offset = (this.offset + OFFSET_ZUWACHS) & 0xff;
    this.danger += laufend ? DANGER_RENNEN : DANGER_GEHEN;

    if (this.danger < this.dangerProPruefung) return null;
    this.danger -= this.dangerProPruefung;

    const roll = Math.floor(nextRandom(state) * 256);
    if (roll >= this.table.rate) return null;
    return this.waehleFormation(state);
  }

  /**
   * Formationswahl über die 6-Bit-Wahrscheinlichkeiten (Formatfakt) und
   * Fortschreibung der Formationsnummer.
   *
   * 🔵 Der Zuwachs +2/+3 je Kampf stammt aus der Doku („variable increment …
   * depending on the field screen and current Formation ID"); welche Größe
   * ihn genau bestimmt, steht dort nicht. Nachgebaut ist die Abhängigkeit vom
   * aktuellen Wert — dadurch bleibt die Folge nichtlinear, und eine
   * verschobene Route kann sich wie beschrieben wieder einfangen.
   */
  private waehleFormation(state: FieldRuntimeState): number {
    const total = this.table.standard.reduce((s, e) => s + Math.max(1, e.probability), 0);
    let r = Math.floor(nextRandom(state) * total);
    let gewaehlt = this.table.standard[this.table.standard.length - 1]!.battleId;
    for (const e of this.table.standard) {
      r -= Math.max(1, e.probability);
      if (r < 0) {
        gewaehlt = e.battleId;
        break;
      }
    }
    this.formationId = (this.formationId + (this.formationId % 2 === 0 ? 2 : 3)) & 0xff;
    return gewaehlt;
  }
}
