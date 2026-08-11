import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { MAKOU_NAME, MAKOU_TOTAL_LEN } from './makou-lengths.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * **Posten 3 der Nachlese — der Längentabellen-„Fixpunkt" ist keiner mehr.**
 *
 * `docs/ROADMAP-OFFENE-POSTEN.md` führt die Operandenlängentabelle seit O9 als
 * Fixpunkt: „Ein erneuter Lauf übernimmt nichts mehr." Das stimmt heute nicht
 * mehr. Seit O9 sind vier Längen gewandert (0x16–0x19 auf 7/8, 0x52 auf 3,
 * 0xA6/0xA7 auf 8) — jede davon verschiebt den Instruktionsstrom und damit die
 * Gütelandschaft aller übrigen Opcodes. Der Abstieg findet deshalb wieder
 * Vorschläge.
 *
 * Diese Probe fährt den Abstieg (`oplen-probe.rdtest.ts`, identische Mechanik:
 * implementierte Opcodes eingefroren, bei Gleichstand bleibt der Ausgangswert)
 * und **prüft jeden einzelnen Vorschlag gegen das O9-Kriterium** nach:
 *
 *  1. **Isoliert messen, nicht kumuliert.** Der Abstieg bewertet einen
 *     Vorschlag vor dem Hintergrund aller vorher übernommenen. Hier wird jeder
 *     Vorschlag allein auf die Ist-Tabelle gesetzt — sonst trägt eine Änderung
 *     die Verbesserung einer anderen mit.
 *  2. **Auf der betroffenen Teilmenge messen.** Über alle 48.041 Spannen
 *     verschwindet ein Opcode mit 30 Vorkommen im Rauschen; die Gütefunktion
 *     meldet dann „kein Unterschied", wo sie in Wahrheit nur nicht hinsieht.
 *  3. **Strikt besser als Ist UND als beide Nachbarn** (`L−1`, `L+1`). Ohne die
 *     Nachbarkontrolle sähe jede Länge, die zufällig aufgeht, wie ein Befund aus.
 *  4. **Eindeutiges Maximum.** Erreichen mehrere Längen dieselbe beste Quote,
 *     ist der Vorschlag eine Münze, kein Messwert — er wird verworfen. Der
 *     Abstieg selbst kann das nicht sehen: er nimmt bei Gleichstand einfach den
 *     erstbesten.
 *
 * **Die O9-Lehre bleibt bindend:** Ein freier Abstieg über alle 256 Opcodes
 * überfittet nachweislich (er verbog damals REQ von 2 auf 0 und MUL von 3 auf
 * 0). Alle implementierten Opcodes sind eingefroren.
 *
 * Urheberrecht: ausschließlich Zähler und Quoten über die Daten des Nutzers.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const MAX_LEN = 16;

interface Feld {
  name: string;
  code: Uint8Array;
  spans: Array<{ start: number; end: number }>;
}

interface Befund {
  geschlossen: number;
  overrun: number;
  abbruch: number;
  gesamt: number;
}

const hex = (n: number): string => `0x${n.toString(16).padStart(2, '0')}`;

function laufe(
  code: Uint8Array,
  s: { start: number; end: number },
  len: number[],
): 'geschlossen' | 'overrun' | 'abbruch' {
  let pc = s.start;
  let guard = 0;
  while (pc < s.end && ++guard < 100_000) {
    const op = code[pc]!;
    let schritt: number;
    if (op === OP_KAWAI) {
      const total = code[pc + 1];
      if (total === undefined || total < 2) return 'abbruch';
      schritt = total;
    } else {
      const l = len[op] ?? -1;
      if (l < 0) return 'abbruch';
      schritt = 1 + l;
    }
    pc += schritt;
  }
  return pc === s.end ? 'geschlossen' : 'overrun';
}

function messe(felder: Feld[], len: number[], nur?: Set<string>): Befund {
  const b: Befund = { geschlossen: 0, overrun: 0, abbruch: 0, gesamt: 0 };
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      if (nur && !nur.has(`${f.name}:${s.start}:${s.end}`)) continue;
      b.gesamt++;
      const r = laufe(f.code, s, len);
      if (r === 'abbruch') b.abbruch++;
      else if (r === 'geschlossen') b.geschlossen++;
      else b.overrun++;
    }
  }
  return b;
}

/** Enthält die Spanne den Opcode, wenn man sie mit `len` durchläuft? */
function beruehrt(f: Feld, s: { start: number; end: number }, len: number[], op: number): boolean {
  let pc = s.start;
  let guard = 0;
  while (pc < s.end && ++guard < 100_000) {
    const o = f.code[pc]!;
    if (o === op) return true;
    let schritt: number;
    if (o === OP_KAWAI) {
      const total = f.code[pc + 1];
      if (total === undefined || total < 2) return false;
      schritt = total;
    } else {
      const l = len[o] ?? -1;
      if (l < 0) return false;
      schritt = 1 + l;
    }
    pc += schritt;
  }
  return false;
}

/** Alle Spannen, in denen der Opcode unter IRGENDEINER Länge 0…MAX_LEN auftaucht. */
function betroffeneSpannen(felder: Feld[], ist: number[], op: number): Set<string> {
  const tabellen: number[][] = [];
  for (let L = 0; L <= MAX_LEN; L++) {
    const t = [...ist];
    t[op] = L;
    tabellen.push(t);
  }
  const out = new Set<string>();
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      for (const t of tabellen) {
        if (beruehrt(f, s, t, op)) {
          out.add(`${f.name}:${s.start}:${s.end}`);
          break;
        }
      }
    }
  }
  return out;
}

/** Verankerte Vorkommen: erste Fundstelle je Spanne (längenunabhängig). */
function verankert(felder: Feld[], ist: number[], op: number): { n: number; fields: number } {
  let n = 0;
  const fields = new Set<string>();
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      let pc = s.start;
      let guard = 0;
      while (pc < s.end && ++guard < 100_000) {
        if (f.code[pc] === op) {
          n++;
          fields.add(f.name);
          break;
        }
        const o = f.code[pc]!;
        let schritt: number;
        if (o === OP_KAWAI) {
          const total = f.code[pc + 1];
          if (total === undefined || total < 2) break;
          schritt = total;
        } else {
          const l = ist[o] ?? -1;
          if (l < 0) break;
          schritt = 1 + l;
        }
        pc += schritt;
      }
    }
  }
  return { n, fields: fields.size };
}

/** Primär mehr Abschlüsse, sekundär weniger Overrun. */
const besser = (a: Befund, b: Befund): boolean =>
  a.geschlossen !== b.geschlossen ? a.geschlossen > b.geschlossen : a.overrun < b.overrun;

describe.skipIf(!available)('Realdaten: Koordinatenabstieg-Nachlese (Posten 3)', () => {
  it('fährt den Abstieg und prüft jeden Vorschlag einzeln gegen das O9-Kriterium', { timeout: 3_600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const felder: Feld[] = [];
    const byteCount = new Array<number>(256).fill(0);
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
      const code = b.rawSections[1]!;
      const spans = b.script.spans.filter((s) => s.end > s.start).map((s) => ({ start: s.start, end: s.end }));
      for (const s of spans) for (let i = s.start; i < s.end; i++) byteCount[code[i]!]!++;
      felder.push({ name: entry.name, code, spans });
    }
    await dir.closeAll();

    const ist = new Array<number>(256).fill(-1);
    for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) ist[Number(op)] = len;
    for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) ist[Number(op)] = len;

    const vorher = messe(felder, ist);

    // --- Der Abstieg (Mechanik identisch zu oplen-probe) ---------------------
    const frozen = new Set(Object.keys(IMPL_OPERAND_LEN).map(Number));
    const order = Array.from({ length: 256 }, (_, op) => op)
      .filter((op) => op !== OP_KAWAI && !frozen.has(op) && byteCount[op]! > 0)
      .sort((a, b) => byteCount[b]! - byteCount[a]!);
    const tabelle = [...ist];
    let bestOk = vorher.geschlossen;
    for (let pass = 0; pass < 3; pass++) {
      let veraendert = false;
      for (const op of order) {
        const keep = tabelle[op]!;
        let bestLen = keep;
        for (let L = 0; L <= MAX_LEN; L++) {
          if (L === keep) continue;
          tabelle[op] = L;
          const r = messe(felder, tabelle).geschlossen;
          if (r > bestOk) {
            bestOk = r;
            bestLen = L;
          }
        }
        tabelle[op] = bestLen;
        if (bestLen !== keep) veraendert = true;
      }
      if (!veraendert) break;
    }
    const nachAbstieg = messe(felder, tabelle);
    const vorschlaege = tabelle
      .map((neu, op) => ({ op, alt: ist[op]!, neu }))
      .filter((e) => e.neu !== e.alt);

    // --- Auflösungskalibrierung: was bedeutet ein Vorsprung von EINER Spanne?
    //
    // Ohne diese Zahl ist „50/50 gegen 49/50, eindeutiges Maximum" nicht
    // interpretierbar. Gemessen wird an den **eingefrorenen** Opcodes, deren
    // Länge unabhängig gedeckt ist (Fixture-Tests, Referenzübereinstimmung,
    // Struktursonde): Wie oft schlägt dort irgendeine FALSCHE Länge die richtige
    // auf derselben Teilmenge — und um wie viel? Ist ein Vorsprung von einer
    // Spanne bei nachweislich richtigen Längen alltäglich, dann belegt er
    // nirgends etwas, und die Probe muss ihn als Rauschen behandeln statt ihn
    // als Befund zu verbuchen.
    const kalibrierung: string[] = [];
    let frozenGeprueft = 0;
    let frozenGeschlagen = 0;
    let frozenNichtEindeutig = 0;
    const vorspruenge: number[] = [];
    for (const op of [...frozen].sort((a, b) => a - b)) {
      const wahr = ist[op]!;
      const vk = verankert(felder, ist, op);
      if (vk.n < 10) continue; // zu selten für einen Vergleich
      const teil = betroffeneSpannen(felder, ist, op);
      const proLaenge: number[] = [];
      for (let L = 0; L <= MAX_LEN; L++) {
        const t = [...ist];
        t[op] = L;
        proLaenge.push(messe(felder, t, teil).geschlossen);
      }
      const maxOk = Math.max(...proLaenge);
      const argmax = proLaenge.map((v, L) => ({ v, L })).filter((x) => x.v === maxOk).map((x) => x.L);
      frozenGeprueft++;
      const vorsprung = maxOk - proLaenge[wahr]!;
      if (vorsprung > 0) {
        frozenGeschlagen++;
        vorspruenge.push(vorsprung);
        kalibrierung.push(
          `${hex(op)} ${MAKOU_NAME[op] || '?'} (belegte Länge ${wahr}, n=${vk.n}): richtige Länge ${proLaenge[wahr]}/${teil.size}, ` +
            `bestes FALSCHES ${maxOk} bei Länge ${argmax.join('/')} — Vorsprung ${vorsprung} Spanne(n)`,
        );
      } else if (argmax.length > 1) {
        frozenNichtEindeutig++;
      }
    }
    /**
     * **Rauschschwelle**: der größte Vorsprung, den eine falsche Länge an einem
     * unabhängig gedeckten Opcode erreicht. Ein Vorschlag muss mehr bieten als
     * das, sonst behauptet er etwas, das die Gütefunktion nachweislich auch bei
     * richtigen Längen produziert.
     */
    const rauschSchwelle = vorspruenge.length ? Math.max(...vorspruenge) : 0;

    // --- Jeder Vorschlag EINZELN, isoliert, auf seiner Teilmenge -------------
    const urteile: Array<{
      op: number;
      alt: number;
      neu: number;
      strikt: boolean;
      zeile: string;
    }> = [];

    for (const v of vorschlaege) {
      const teil = betroffeneSpannen(felder, ist, v.op);
      const vk = verankert(felder, ist, v.op);
      const proLaenge: Befund[] = [];
      for (let L = 0; L <= MAX_LEN; L++) {
        const t = [...ist];
        t[v.op] = L;
        proLaenge.push(messe(felder, t, teil));
      }
      const maxOk = Math.max(...proLaenge.map((b) => b.geschlossen));
      const gleichstand = proLaenge.filter((b) => b.geschlossen === maxOk).length;
      const argmax = proLaenge.map((b, L) => ({ b, L })).filter((x) => x.b.geschlossen === maxOk).map((x) => x.L);
      const A = proLaenge[v.alt]!;
      const N = proLaenge[v.neu]!;
      const links = v.neu - 1 >= 0 ? proLaenge[v.neu - 1]! : null;
      const rechts = v.neu + 1 <= MAX_LEN ? proLaenge[v.neu + 1]! : null;
      const o9 =
        besser(N, A) &&
        (links === null || besser(N, links)) &&
        (rechts === null || besser(N, rechts)) &&
        gleichstand === 1;
      // Zusätzlich zum O9-Kriterium: der Vorsprung muss über der gemessenen
      // Rauschschwelle liegen.
      const vorsprung = N.geschlossen - A.geschlossen;
      const strikt = o9 && vorsprung > rauschSchwelle;
      urteile.push({
        op: v.op,
        alt: v.alt,
        neu: v.neu,
        strikt,
        zeile:
          `${hex(v.op)} ${MAKOU_NAME[v.op] || '?'} ${v.alt} → ${v.neu} (Referenz ${(MAKOU_TOTAL_LEN[v.op] ?? 0) - 1}): ` +
          `verankert n=${vk.n} in ${vk.fields} Fields, Teilmenge ${teil.size} Spannen | ` +
          `ist(${v.alt}) ${A.geschlossen}/${A.gesamt}, neu(${v.neu}) ${N.geschlossen}/${N.gesamt}, ` +
          `Nachbar ${v.neu - 1}→${links ? links.geschlossen : '—'}, ${v.neu + 1}→${rechts ? rechts.geschlossen : '—'} | ` +
          `Maximum ${maxOk} bei Länge ${argmax.join('/')} (${gleichstand === 1 ? 'eindeutig' : `${gleichstand}-fach mehrdeutig`}) | ` +
          `alle Längen 0…${MAX_LEN}: ${proLaenge.map((b) => b.geschlossen).join(',')} | ` +
          `Vorsprung gegen Ist ${vorsprung} Spanne(n), Rauschschwelle ${rauschSchwelle} | ` +
          `O9-Kriterium ${o9 ? 'bestanden' : 'nicht bestanden'} · ${strikt ? 'ÜBERNOMMEN' : 'VERWORFEN'}`,
      });
    }

    // --- Bündel aus den übernommenen Vorschlägen ----------------------------
    const uebernommen = urteile.filter((u) => u.strikt);
    const buendel = [...ist];
    for (const u of uebernommen) buendel[u.op] = u.neu;
    const B = messe(felder, buendel);
    // Kontrolle: dasselbe Bündel je ein Byte zu weit. Gewinnt auch das, misst
    // die Gütefunktion nur „länger ist besser" und belegt nichts.
    const buendelZuWeit = [...ist];
    for (const u of uebernommen) buendelZuWeit[u.op] = u.neu + 1;
    const BK = messe(felder, buendelZuWeit);
    const buendelZuKurz = [...ist];
    for (const u of uebernommen) buendelZuKurz[u.op] = Math.max(0, u.neu - 1);
    const BKK = messe(felder, buendelZuKurz);

    const pct = (b: Befund): string =>
      `${((b.geschlossen / b.gesamt) * 100).toFixed(4)}% (${b.geschlossen}/${b.gesamt}), Overrun ${b.overrun}, Abbruch ${b.abbruch}`;

    console.log(
      'Koordinatenabstieg-Nachlese:',
      JSON.stringify(
        {
          Fields: felder.length,
          Spannen: vorher.gesamt,
          'Ist-Tabelle': pct(vorher),
          'nach freiem Abstieg (nur eingefrorene Ops ausgenommen)': pct(nachAbstieg),
          'Vorschläge des Abstiegs': vorschlaege.length,
          Einzelurteile: urteile.map((u) => u.zeile),
          '— Auflösungskalibrierung an den eingefrorenen (unabhängig gedeckten) Opcodes —': '',
          'geprüfte eingefrorene Opcodes (n ≥ 10 verankert)': frozenGeprueft,
          'davon von einer FALSCHEN Länge geschlagen': `${frozenGeschlagen} (${((frozenGeschlagen / Math.max(1, frozenGeprueft)) * 100).toFixed(1)}%)`,
          'davon nur gleichauf (mehrdeutiges Maximum)': frozenNichtEindeutig,
          'Vorsprünge falscher Längen (Spannen)': vorspruenge.length
            ? `min ${Math.min(...vorspruenge)}, median ${vorspruenge.slice().sort((a, b) => a - b)[Math.floor(vorspruenge.length / 2)]}, max ${Math.max(...vorspruenge)}`
            : '—',
          Rauschschwelle: `${rauschSchwelle} Spanne(n) — ein Vorschlag muss STRIKT mehr Vorsprung bieten`,
          Kalibrierungsfälle: kalibrierung,
          'übernommen': uebernommen.map((u) => `${hex(u.op)} ${u.alt} → ${u.neu}`),
          'Bündel-Abschluss': pct(B),
          'Kontrolle Bündel je +1': pct(BK),
          'Kontrolle Bündel je −1': pct(BKK),
        },
        null,
        1,
      ),
    );

    expect(vorher.gesamt).toBeGreaterThan(1000);
    // Das Bündel darf die Ausgangslage nie verschlechtern …
    expect(B.geschlossen).toBeGreaterThanOrEqual(vorher.geschlossen);
    // … und „ein Byte zu weit" darf nicht gewinnen.
    expect(BK.geschlossen).toBeLessThanOrEqual(B.geschlossen);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
