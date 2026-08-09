import type { FieldScriptSet } from '@webmidgar/formats-field';
import { fnv1a64Hex } from './digest.js';

/**
 * `PreparedScript` (Masterplan 2.3/S6): validierte Entry-Points + Bytecode-
 * Sicht auf die Script-Sektion. Der Bytecode selbst stammt zur Laufzeit aus
 * dem Nutzerdatenbestand (bzw. aus selbst erzeugten Fixtures) — er wird hier
 * nur referenziert, nie ins Repo übernommen.
 */

export interface PreparedEntity {
  name: string;
  /** 32 Slots; null = ungültig. Offsets sektionsrelativ; == codeEnd ⇒ leer. */
  entryPoints: (number | null)[];
}

export interface PreparedScript {
  schemaVersion: 1;
  /** Gesamte Script-Sektion (Instruktionen adressieren sektionsrelativ). */
  code: Uint8Array;
  /** Beginn/Ende des Bytecode-Bereichs [dataStart, codeEnd). */
  dataStart: number;
  codeEnd: number;
  entities: PreparedEntity[];
  /** Disjunkte Bytecode-Spannen (aus den Entry-Points, S2). */
  spans: { start: number; end: number }[];
  /** FNV-1a-64 über den Bytecode-Bereich — Guard für Snapshot-Restore. */
  scriptHash: string;
}

/** Ende des Spans, der `offset` enthält (Fallback: codeEnd). */
export function spanEnd(script: PreparedScript, offset: number): number {
  for (const s of script.spans) {
    if (offset >= s.start && offset < s.end) return s.end;
  }
  return script.codeEnd;
}

export function prepareScript(scriptSet: FieldScriptSet, sectionBytes: Uint8Array): PreparedScript {
  const codeEnd = scriptSet.stringTableOffset;
  return {
    schemaVersion: 1,
    code: sectionBytes,
    dataStart: scriptSet.dataStart,
    codeEnd,
    entities: scriptSet.entities.map((e) => ({
      name: e.name,
      entryPoints: [...e.entryPoints],
    })),
    spans: scriptSet.spans.map((s) => ({ ...s })),
    scriptHash: fnv1a64Hex(sectionBytes.subarray(scriptSet.dataStart, codeEnd)),
  };
}
