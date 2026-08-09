import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * S12-Kernprobe: **Operandenlängen aus den Daten ableiten**, nicht aus
 * Dokumentation übernehmen.
 *
 * Die Gütefunktion ist der Spannen-Abschluss. Jede Script-Spanne eines
 * Entity-Slots ist ein zusammenhängender Instruktionsstrom; läuft man ihn vom
 * Anfang linear durch, muss man **exakt** auf ihrem Ende landen. Ist auch nur
 * eine Länge falsch, verrutscht der Strom und das Spannenende wird verfehlt
 * oder überschritten. Damit ist die Abschlussquote ein direktes, unbestechliches
 * Maß für die Richtigkeit der Tabelle — und erlaubt einen Koordinatenabstieg:
 * je Opcode alle plausiblen Längen durchprobieren und die beste behalten.
 *
 * Das Ergebnis ist per Konstruktion Clean-Room: abgeleitet aus dem Bestand des
 * Nutzers, nicht abgeschrieben.
 *
 * **Überanpassungsschutz.** Ein freier Abstieg über alle 256 Opcodes erreicht
 * zwar 99,65 % Abschluss, verbiegt dabei aber auch nachweislich richtige
 * Längen (REQ 2→0, MUL 3→0) — 256 freie Parameter gegen eine einzige Kennzahl
 * lassen sich leicht gegen die Kennzahl optimieren statt gegen die Wahrheit.
 * Deshalb sind alle vom Interpreter tatsächlich ausgeführten Opcodes
 * (`IMPL_OPERAND_LEN`) **eingefroren**: sie sind durch die S6-Fixture-Tests
 * gedeckt. Gesucht wird nur über die verbleibenden Opcodes, und bei
 * Gleichstand gewinnt der bisherige Wert. Zusätzlich wird gemeldet, welche
 * Längen mehrdeutig bleiben (mehrere Werte mit identischer Güte).
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const MAX_LEN = 16;

interface Span {
  bytes: Uint8Array;
  start: number;
  end: number;
}

/**
 * Läuft eine Spanne linear ab. Rückgabe: 'ok' (endet exakt am Spannenende),
 * 'unknown' (Opcode ohne Länge) oder 'overrun' (verfehlt das Ende).
 */
function walkSpan(span: Span, table: readonly number[]): 'ok' | 'unknown' | 'overrun' {
  let ip = span.start;
  let guard = 0;
  while (ip < span.end) {
    if (++guard > 100_000) return 'overrun';
    const op = span.bytes[ip]!;
    if (op === OP_KAWAI) {
      // Variable Länge: erstes Operandenbyte trägt die Gesamtlänge.
      const total = span.bytes[ip + 1];
      if (total === undefined || total < 2) return 'unknown';
      ip += total;
      continue;
    }
    const len = table[op]!;
    if (len < 0) return 'unknown';
    ip += 1 + len;
  }
  return ip === span.end ? 'ok' : 'overrun';
}

describe.skipIf(!available)('Realdaten: Operandenlängen (S12)', () => {
  it('Spannen-Abschluss als Gütefunktion + Koordinatenabstieg', { timeout: 1_800_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const spans: Span[] = [];
    const opCount = new Array<number>(256).fill(0);
    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const script = parsed.bundle?.script;
      const bytes = parsed.bundle?.rawSections[1];
      if (!parsed.ok || !script || !bytes) continue;
      for (const s of script.spans) {
        if (s.end <= s.start) continue;
        spans.push({ bytes, start: s.start, end: s.end });
        // Grobzählung der Opcode-Häufigkeit (erste Bytes je Spanne reichen nicht;
        // hier bewusst über den ganzen Bereich, nur zur Priorisierung).
        for (let i = s.start; i < s.end; i++) opCount[bytes[i]!]!++;
      }
    }

    const rate = (table: readonly number[]): { ok: number; unknown: number; overrun: number } => {
      let ok = 0;
      let unknown = 0;
      let overrun = 0;
      for (const s of spans) {
        const r = walkSpan(s, table);
        if (r === 'ok') ok++;
        else if (r === 'unknown') unknown++;
        else overrun++;
      }
      return { ok, unknown, overrun };
    };

    // Ausgangstabelle: −1 = unbekannt.
    const base = new Array<number>(256).fill(-1);
    for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) base[Number(op)] = len;
    for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) base[Number(op)] = len;
    base[OP_KAWAI] = 0; // wird gesondert behandelt

    const before = rate(base);

    // --- Koordinatenabstieg ---------------------------------------------------
    // Reihenfolge nach Häufigkeit: die häufigsten Opcodes bestimmen die Quote
    // am stärksten und werden zuerst festgelegt.
    const order = Array.from({ length: 256 }, (_, op) => op)
      .filter((op) => op !== OP_KAWAI)
      .sort((a, b) => opCount[b]! - opCount[a]!);

    // Eingefroren: alles, was der Interpreter wirklich ausführt.
    const frozen = new Set(Object.keys(IMPL_OPERAND_LEN).map(Number));
    const table = [...base];
    const ambiguous: string[] = [];
    let bestOk = rate(table).ok;
    for (let pass = 0; pass < 3; pass++) {
      let improvedInPass = false;
      for (const op of order) {
        if (opCount[op] === 0 || frozen.has(op)) continue;
        const keep = table[op]!;
        let bestLen = keep;
        let ties = 0;
        for (let len = 0; len <= MAX_LEN; len++) {
          if (len === keep) continue;
          table[op] = len;
          const r = rate(table).ok;
          // Strikt besser gewinnt; bei Gleichstand bleibt der bisherige Wert.
          if (r > bestOk) {
            bestOk = r;
            bestLen = len;
            ties = 0;
          } else if (r === bestOk && bestLen !== keep) {
            ties++;
          }
        }
        table[op] = bestLen;
        if (bestLen !== keep) improvedInPass = true;
        if (ties > 0 && pass === 0) {
          ambiguous.push(`0x${op.toString(16).padStart(2, '0')} (${ties} gleichwertige Längen)`);
        }
      }
      if (!improvedInPass) break;
    }

    const after = rate(table);
    const changed = table
      .map((len, op) => ({ op, alt: base[op]!, neu: len, häufigkeit: opCount[op]! }))
      .filter((e) => e.neu !== e.alt && e.häufigkeit > 0);
    const stillUnknown = table
      .map((len, op) => ({ op, len, häufigkeit: opCount[op]! }))
      .filter((e) => e.len < 0 && e.häufigkeit > 0);

    const pct = (n: number): string => `${((n / spans.length) * 100).toFixed(2)}%`;
    console.log(
      'Operandenlängen:',
      JSON.stringify(
        {
          spannen: spans.length,
          vorher: { ok: pct(before.ok), unknown: pct(before.unknown), overrun: pct(before.overrun) },
          nachher: { ok: pct(after.ok), unknown: pct(after.unknown), overrun: pct(after.overrun) },
          geaendert: changed
            .sort((a, b) => b.häufigkeit - a.häufigkeit)
            .slice(0, 40)
            .map((e) => `0x${e.op.toString(16).padStart(2, '0')}: ${e.alt} → ${e.neu}`),
          nochUnbekannt: stillUnknown.map((e) => `0x${e.op.toString(16).padStart(2, '0')}`),
          mehrdeutig: ambiguous.length,
          mehrdeutigeBeispiele: ambiguous.slice(0, 20),
        },
        null,
        1,
      ),
    );
    // Vollständige abgeleitete Tabelle als kopierfertiges Literal.
    console.log(
      'ABGELEITETE TABELLE:',
      JSON.stringify(
        Object.fromEntries(
          table
            .map((len, op) => [`0x${op.toString(16).padStart(2, '0')}`, len] as const)
            .filter(([, len]) => len >= 0),
        ),
      ),
    );

    expect(spans.length).toBeGreaterThan(1000);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
