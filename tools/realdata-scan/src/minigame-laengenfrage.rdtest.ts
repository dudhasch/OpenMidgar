import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { MAKOU_NAME, MAKOU_TOTAL_LEN } from './makou-lengths.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * **Dauerprobe: die Längenfrage von 0x20 MINIGAME (mit 0x27 und 0xFB).**
 *
 * Sie fasst sieben Wegwerfsonden zusammen und hält vor allem fest, **wo die
 * eigene frühere Argumentation nicht trägt**:
 *
 *  **M1 — Rauschboden der verankerten Zählung.** „118 verankerte Fundstellen
 *  in 79 Fields" klingt nach einem Befund. Die Kontrolle dazu fehlte: Wie
 *  viele verankerte Fundstellen bekommt ein Bytewert, der nachweislich KEIN
 *  Opcode ist? Die Referenz führt 13 Werte als unbelegt; jede Fundstelle dort
 *  ist per Definition ein Phantom. Erst der Vergleich macht die 118 lesbar.
 *
 *  **M2 — Die „harte Schranke" ist selbst fraglich.** Das Argument lautete:
 *  In vier Spannen steht 0x20 nur 6 Byte vor dem Spannenende, also passt die
 *  Referenzlänge 10 dort physisch nicht. Diese Probe zeigt den Byte-Kontext
 *  dieser Stellen. Alle acht kleinsten Abstände entstehen an der Folge
 *  `31 00 20 xx` — das ist `IFKEYON` mit Tastenmaske `0x2000`, und das `0x20`
 *  ist deren hohes Byte, kein Opcode. Sichtbar wird es nur, weil unsere
 *  Tabelle 0x31 mit Operandenlänge 2 führt statt der Referenzlänge 3.
 *
 *  **M3 — Und warum wir 0x31 trotzdem nicht ändern.** Die Referenzlänge 3
 *  verschlechtert den Spannen-Abschluss bestandsweit. Beide Seiten haben also
 *  ein Argument, und keines schlägt das andere. Das ist der ehrliche Stand:
 *  **nicht** „die Schranke ist widerlegt" und **nicht** „die Schranke steht",
 *  sondern zwei Messungen, die sich widersprechen — der Posten bleibt offen.
 *
 *  **M4 — Der Abschluss über alle Längen 0…12** für 0x20, 0x27 und 0xFB, mit
 *  der gemessenen Rauschschwelle von 3 Spannen als Maßstab.
 *
 * Urheberrecht: ausschließlich Zähler und Quoten über die Daten des Nutzers.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(REAL_DIR);
const hex = (n: number): string => `0x${n.toString(16).padStart(2, '0')}`;

/** Rauschschwelle des Spannen-Abschlusses, gemessen in `oplen-abstieg-nachlese`. */
const RAUSCHSCHWELLE = 3;

interface Feld {
  name: string;
  code: Uint8Array;
  spans: Array<{ start: number; end: number }>;
}

function istTabelle(): number[] {
  const t = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) t[Number(op)] = len;
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) t[Number(op)] = len;
  return t;
}

function schritt(code: Uint8Array, p: number, len: number[]): number {
  const op = code[p]!;
  if (op === OP_KAWAI) {
    const total = code[p + 1];
    return total === undefined || total < 2 ? -1 : total;
  }
  const l = len[op] ?? -1;
  return l < 0 ? -1 : 1 + l;
}

function abschluss(felder: Feld[], len: number[]): { zu: number; over: number; unb: number } {
  let zu = 0;
  let over = 0;
  let unb = 0;
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      let pc = s.start;
      let guard = 0;
      let abbruch = false;
      while (pc < s.end && ++guard < 100_000) {
        const sch = schritt(f.code, pc, len);
        if (sch < 0) {
          abbruch = true;
          break;
        }
        pc += sch;
      }
      if (abbruch) unb++;
      else if (pc === s.end) zu++;
      else over++;
    }
  }
  return { zu, over, unb };
}

/** Erste Fundstelle je Spanne — als einzige unabhängig von der EIGENEN Länge. */
function verankert(felder: Feld[], len: number[], op: number): Array<{ f: Feld; pos: number; s: { start: number; end: number } }> {
  const out: Array<{ f: Feld; pos: number; s: { start: number; end: number } }> = [];
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      let pc = s.start;
      let guard = 0;
      while (pc < s.end && ++guard < 100_000) {
        if (f.code[pc] === op) {
          out.push({ f, pos: pc, s });
          break;
        }
        const sch = schritt(f.code, pc, len);
        if (sch < 0) break;
        pc += sch;
      }
    }
  }
  return out;
}

describe.skipIf(!available)('Realdaten: Längenfrage MINIGAME (0x20)', () => {
  it('misst Rauschboden, Schranke, Gegenargument und Abschlussverlauf', { timeout: 1_800_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const felder: Feld[] = [];
    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const b = parsed.bundle;
      if (!parsed.ok || !b?.script || !b.rawSections[1]) continue;
      felder.push({
        name: entry.name,
        code: b.rawSections[1]!,
        spans: b.script.spans.map((s) => ({ start: s.start, end: s.end })),
      });
    }
    await dir.closeAll();

    const ist = istTabelle();
    const basis = abschluss(felder, ist);

    // ── M1 ── Rauschboden. Die naheliegende Negativkontrolle — „Bytewerte, die
    // die Referenz nicht führt" — ist UNBRAUCHBAR: 0x76–0x7D sind bei uns die
    // saturierenden Rechenvarianten und damit echte Opcodes; die Referenz
    // listet sie nur nicht. Sie wird trotzdem mit ausgegeben, aber als das,
    // was sie ist: kontaminiert.
    //
    // Die saubere Kontrolle ist das **versetzte Raster**: derselbe Lauf, aber
    // ab `spanStart + k`. Das Raster ist damit nachweislich falsch, jede
    // Fundstelle dort per Konstruktion ein Phantom. Bleibt die verankerte
    // Zählung dabei ähnlich hoch, trennt „verankert" keine Phantome ab.
    const v20 = verankert(felder, ist, 0x20);
    const versetzt = (op: number, k: number): number => {
      let n = 0;
      for (const f of felder) {
        for (const s of f.spans) {
          if (s.end - s.start <= k) continue;
          let pc = s.start + k;
          let guard = 0;
          while (pc < s.end && ++guard < 100_000) {
            if (f.code[pc] === op) {
              n++;
              break;
            }
            const sch = schritt(f.code, pc, ist);
            if (sch < 0) break;
            pc += sch;
          }
        }
      }
      return n;
    };
    const versatzKontrolle = [1, 2, 3].map((k) => ({ Versatz: k, 'verankert 0x20': versetzt(0x20, k) }));
    const rauschMax = Math.max(...versatzKontrolle.map((v) => v['verankert 0x20']));
    const ungueltig = Array.from({ length: 256 }, (_, b) => b).filter((b) => (MAKOU_TOTAL_LEN[b] ?? 0) === 0);
    const referenzlos = ungueltig.map((b) => {
      const v = verankert(felder, ist, b);
      return { Bytewert: hex(b), verankert: v.length, 'bei uns implementiert': b in IMPL_OPERAND_LEN };
    });

    // ── M2 ── Die harte Schranke und ihr Byte-Kontext.
    const abstaende = v20
      .map(({ f, pos, s }) => ({
        stelle: `${f.name}@${pos}`,
        abstandZumSpannenende: s.end - pos - 1,
        davor: [...f.code.slice(Math.max(s.start, pos - 4), pos)].map((x) => x.toString(16).padStart(2, '0')).join(' '),
        danach: [...f.code.slice(pos, Math.min(s.end, pos + 4))].map((x) => x.toString(16).padStart(2, '0')).join(' '),
      }))
      .sort((a, b) => a.abstandZumSpannenende - b.abstandZumSpannenende);
    const engste = abstaende.slice(0, 8);
    // Wie viele der engsten Stellen stehen direkt hinter `31 00`?
    const ausIfkeyon = engste.filter((e) => e.davor.endsWith('31 00')).length;

    // ── M3 ── Das Gegenargument kostet etwas: 0x31 auf die Referenzlänge.
    const mit31 = ist.slice();
    mit31[0x31] = (MAKOU_TOTAL_LEN[0x31] ?? 1) - 1;
    const nach31 = abschluss(felder, mit31);
    const v20nach31 = verankert(felder, mit31, 0x20);
    const engsteNach31 = v20nach31
      .map(({ pos, s }) => s.end - pos - 1)
      .sort((a, b) => a - b)
      .slice(0, 8);

    // ── M4 ── Abschluss über alle Längen 0…12.
    const verlauf = (op: number): string => {
      const zeile: string[] = [];
      for (let L = 0; L <= 12; L++) {
        const t = ist.slice();
        t[op] = L;
        zeile.push(`${L}:${abschluss(felder, t).zu}`);
      }
      return zeile.join(' ');
    };

    console.log(
      'Längenfrage MINIGAME:',
      JSON.stringify(
        {
          Fields: felder.length,
          'Abschluss der Ist-Tabelle': basis,
          '=== M1 — Rauschboden ===': '',
          '0x20 verankert': `${v20.length} in ${new Set(v20.map((x) => x.f.name)).size} Fields`,
          'Kontrolle: versetztes Raster (jede Fundstelle ein Phantom)': versatzKontrolle,
          'Kontrolle: referenzlose Bytewerte (KONTAMINIERT, s. Kommentar)': referenzlos,
          '=== M2 — die harte Schranke ===': '',
          'engste acht Fundstellen': engste,
          'davon direkt hinter `31 00` (IFKEYON mit Maske 0x2000)': `${ausIfkeyon} von 8`,
          '=== M3 — was das Gegenargument kostet ===': '',
          '0x31 IFKEYON auf Referenzlänge 3': `Abschluss ${nach31.zu}/${nach31.over}/${nach31.unb} gegen ${basis.zu}/${basis.over}/${basis.unb} — Delta ${nach31.zu - basis.zu}`,
          '0x20 verankert danach': `${v20nach31.length}`,
          'engste Abstände danach': engsteNach31.join(', '),
          '=== M4 — Abschluss über alle Längen ===': '',
          Rauschschwelle: `${RAUSCHSCHWELLE} Spannen`,
          '0x20 MINIGAME': verlauf(0x20),
          '0x27 BGMOVIE': verlauf(0x27),
          '0xFB MVCAM': verlauf(0xfb),
        },
        null,
        1,
      ),
    );

    expect(felder.length).toBeGreaterThan(500);
    // Die Referenzlänge 10 für 0x20 bleibt draußen: Sie verschlechtert den
    // Abschluss um mehr als die Rauschschwelle.
    const mit20 = ist.slice();
    mit20[0x20] = 10;
    expect(abschluss(felder, mit20).zu).toBeLessThan(basis.zu - RAUSCHSCHWELLE);
    // 🔴 Das hier ist die eigentliche Zusicherung, und sie steht ABSICHTLICH
    // andersherum, als man erwartet: Ein nachweislich falsches Raster liefert
    // MEHR „verankerte Fundstellen" für 0x20 als das richtige. Solange das
    // gilt, ist die verankerte Zählung **kein Beleg dafür, dass der Opcode
    // vorkommt** — sie ist bestenfalls eine obere Schranke. Die frühere
    // Formulierung „118 verankerte Fundstellen in 79 Fields, die Suchmenge ist
    // also nicht leer" ist damit zurückgenommen. (Unter der korrigierten
    // Längentabelle sind es ohnehin nur noch 67 in 49 Fields — die Hälfte der
    // ursprünglichen Zahl waren Phantome der eigenen Tabelle.)
    expect(rauschMax).toBeGreaterThan(v20.length);
    // Und das Gegenargument gegen die Schranke muss weiterhin etwas kosten;
    // wäre 0x31 = 3 gratis, wäre die Schranke einfach widerlegt.
    expect(nach31.zu).toBeLessThan(basis.zu);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
