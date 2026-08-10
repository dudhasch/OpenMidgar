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

/** 🔵 Prüfabstand in bewegten Takten. */
export const DEFAULT_STEPS_PER_CHECK = 24;

export class EncounterModel {
  stepAccum = 0;

  constructor(
    readonly table: EncounterTable,
    readonly stepsPerCheck = DEFAULT_STEPS_PER_CHECK,
  ) {}

  /** Ein bewegter Takt; liefert die Kampf-ID, wenn ein Kampf ausgelöst wird. */
  onMovedTick(state: FieldRuntimeState): number | null {
    if (!this.table.enabled || this.table.standard.length === 0) return null;
    this.stepAccum++;
    if (this.stepAccum < this.stepsPerCheck) return null;
    this.stepAccum = 0;
    const roll = Math.floor(nextRandom(state) * 256);
    if (roll >= this.table.rate) return null;
    const total = this.table.standard.reduce((s, e) => s + Math.max(1, e.probability), 0);
    let r = Math.floor(nextRandom(state) * total);
    for (const e of this.table.standard) {
      r -= Math.max(1, e.probability);
      if (r < 0) return e.battleId;
    }
    return this.table.standard[this.table.standard.length - 1]!.battleId;
  }
}
