import { fdiag, type FieldDiagnostic } from '../diagnostics.js';
import { SECTION, type FieldScriptSet, type ScriptEntity } from '../nam.js';
import { diagnoseAkaoBlock, parseAkaoBlock, type AkaoBlock } from './akao.js';

/**
 * Script-/Dialogsektion — S2-Scope laut Roadmap: NUR Span-Indexierung und
 * Stringtabellen-Index, keine Opcode-Interpretation (die kommt in S6).
 *
 * Layout (🟢 Grundstruktur, 🟡 Felddetails Zu validieren, Masterplan 1.4):
 *   u16 unknown, u8 nEntities, u8 nModels, u16 stringTableOffset,
 *   u16 nAkaoOffsets, u16 scale, 6 B leer, creator[8], name[8],
 *   Entity-Namen à 8 B, Akao-Offsets u32, Entry-Tabelle nEntities×32×u16
 *   (sektionsrelative Offsets), Script-Bytecode, Stringtabelle.
 * Stringtabelle (Fixture-Konvention, 🟡 reale Zählweise Zu validieren):
 *   u16 nStrings, dann nStrings×u16 Offsets relativ zum Tabellenbeginn.
 */

export const SCR_HEADER_LEN = 32;
export const SCR_ENTITY_NAME_LEN = 8;
export const SCR_ENTRIES_PER_ENTITY = 32;
export const SCR_MAX_ENTITIES = 64;
export const SCR_MAX_STRINGS = 1024;

export function parseScriptSection(
  data: Uint8Array,
  field: string,
  diagnostics: FieldDiagnostic[],
): FieldScriptSet | null {
  if (data.length < SCR_HEADER_LEN) {
    diagnostics.push(fdiag('E-SCR-HDR', field, 'Sektion kürzer als Header', SECTION.SCRIPT));
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nEntities = view.getUint8(2);
  const stringTableOffset = view.getUint16(4, true);
  const nAkao = view.getUint16(6, true);

  const namesBase = SCR_HEADER_LEN;
  const akaoBase = namesBase + nEntities * SCR_ENTITY_NAME_LEN;
  const entryBase = akaoBase + nAkao * 4;
  const dataStart = entryBase + nEntities * SCR_ENTRIES_PER_ENTITY * 2;

  if (
    nEntities === 0 ||
    nEntities > SCR_MAX_ENTITIES ||
    dataStart > data.length ||
    stringTableOffset < dataStart ||
    stringTableOffset > data.length
  ) {
    diagnostics.push(
      fdiag(
        'E-SCR-HDR',
        field,
        `Header unplausibel: nEntities=${nEntities}, stringTableOffset=${stringTableOffset}, dataStart=${dataStart}, len=${data.length}`,
        SECTION.SCRIPT,
      ),
    );
    return null;
  }

  // AKAO-/Tutorial-Offsettabelle (F09-B). Bis Schemaversion 1 wurde sie nur
  // übersprungen; damit war die MUSIC-Kette am ersten Glied abgeschnitten.
  // 🟢 u32 LE, sektionsrelativ (Makou §3.2).
  const akaoOffsets: number[] = [];
  const akaoBlocks: AkaoBlock[] = [];
  for (let i = 0; i < nAkao; i++) {
    const off = view.getUint32(akaoBase + i * 4, true);
    akaoOffsets.push(off);
    const block = parseAkaoBlock(data, off);
    akaoBlocks.push(block);
    // Tutorial-Blöcke sind normaler Inhalt und bleiben still; gemeldet werden
    // nur die belegten Defekte (abgeschnittenes Magic, Offset daneben).
    diagnoseAkaoBlock(block, i, field, diagnostics);
  }

  const entities: ScriptEntity[] = [];
  const validEntries = new Set<number>();
  for (let e = 0; e < nEntities; e++) {
    let name = '';
    const nb = namesBase + e * SCR_ENTITY_NAME_LEN;
    for (let i = 0; i < SCR_ENTITY_NAME_LEN; i++) {
      const b = data[nb + i]!;
      if (b === 0) break;
      name += String.fromCharCode(b);
    }
    const entryPoints: (number | null)[] = [];
    for (let s = 0; s < SCR_ENTRIES_PER_ENTITY; s++) {
      const value = view.getUint16(entryBase + (e * SCR_ENTRIES_PER_ENTITY + s) * 2, true);
      // value == stringTableOffset ist gültig: ungenutzte Slots wiederholen den
      // letzten Entry, der ans Bytecode-Ende zeigen kann (leerer Span).
      // ✅ Realdaten-validiert 2026-08-09: alle 29 vormaligen E-SCR-SPAN-Fälle
      // (ein Field, eine Entität) hatten exakt diesen Sentinel-Wert.
      if (value < dataStart || value > stringTableOffset) {
        diagnostics.push(
          fdiag('E-SCR-SPAN', field, `Entity ${e} (${name}), Slot ${s}: Entry ${value} außerhalb [${dataStart}, ${stringTableOffset}]`, SECTION.SCRIPT),
        );
        entryPoints.push(null);
      } else {
        entryPoints.push(value);
        if (value < stringTableOffset) validEntries.add(value);
      }
    }
    entities.push({ name, entryPoints });
  }

  // Disjunkte Spans aus den eindeutigen, sortierten Entry-Points ableiten.
  const sorted = [...validEntries].sort((a, b) => a - b);
  const spans = sorted.map((start, i) => ({
    start,
    end: i + 1 < sorted.length ? sorted[i + 1]! : stringTableOffset,
  }));

  // Stringtabellen-Index.
  const stringOffsets: (number | null)[] = [];
  if (stringTableOffset + 2 <= data.length) {
    const nStrings = view.getUint16(stringTableOffset, true);
    if (nStrings > SCR_MAX_STRINGS || stringTableOffset + 2 + nStrings * 2 > data.length) {
      diagnostics.push(
        fdiag('E-SCR-STR', field, `Stringtabelle unplausibel: nStrings=${nStrings}`, SECTION.SCRIPT),
      );
    } else {
      for (let s = 0; s < nStrings; s++) {
        const off = view.getUint16(stringTableOffset + 2 + s * 2, true);
        if (stringTableOffset + off >= data.length) {
          diagnostics.push(
            fdiag('E-SCR-STR', field, `String ${s}: Offset ${off} außerhalb der Sektion`, SECTION.SCRIPT),
          );
          stringOffsets.push(null);
        } else {
          stringOffsets.push(off);
        }
      }
    }
  }

  return {
    schemaVersion: 2,
    entities,
    dataStart,
    stringTableOffset,
    akaoOffsets,
    akaoBlocks,
    spans,
    stringOffsets,
  };
}
