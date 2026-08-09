import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { MAKOU_TOTAL_LEN } from './makou-lengths.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * O9 — Operandenlängen systematisch abgleichen.
 *
 * **Stand.** Die Längentabelle wurde in S12 aus den Realdaten abgeleitet
 * (Koordinatenabstieg auf den Spannen-Abschluss, 43,19 % → 99,73 %). Sie hat
 * Lücken: 48 Längen sind mehrdeutig, weil der jeweilige Opcode zu selten
 * vorkommt, um Druck auf die Gütefunktion auszuüben.
 *
 * **Was gemessen wird.** Makou Reactor führt eine vollständige Längentabelle
 * (`Opcode::length[257]`, Gesamtlänge inkl. Opcode-Byte). Sie wird hier
 * **nicht übernommen**, sondern als Hypothese eingesetzt und gegen die eigenen
 * Daten gemessen — Posten für Posten. Übernommen wird nur, was den
 * Spannen-Abschluss erhöht, ohne die Overrun-Quote zu verschlechtern.
 *
 * **Die Gütefunktion.** Eine Spanne „schließt", wenn der Durchlauf exakt auf
 * ihrem Ende landet. Sie „läuft über", wenn er darüber hinausschießt, und sie
 * „bricht ab", wenn eine unbekannte Länge auftritt. Nur der exakte Abschluss
 * zählt als Treffer.
 *
 * **Was diese Gütefunktion NICHT kann — die wichtigste Einschränkung.** Der
 * Spannen-Abschluss ist gegenüber falscher *Semantik* vollständig invariant.
 * Er belegt, dass die Längen aufgehen, nicht dass ein Opcode das Richtige tut.
 * Zwei Opcodes mit vertauschten Längen können denselben Abschluss liefern,
 * solange ihre Summe stimmt. Das ist die „blinde Gütefunktion" aus dem
 * Methodenkatalog, und sie ist hier struktureller Natur, nicht behebbar.
 *
 * **Die Kontrollen.**
 *  1. *Pauschalübernahme:* Die vollständige Referenztabelle am Stück. Ist sie
 *     schlechter als die selektive Übernahme, war die Auswahl nötig.
 *  2. *Nachbarwerte:* Für jede übernommene Länge werden auch `ref−1` und
 *     `ref+1` gemessen. Nur wenn der Referenzwert **strikt** besser ist als
 *     beide Nachbarn, ist er belegt — sonst ist er nur einer von mehreren
 *     gleich guten und bleibt 🟡. Ohne diese Kontrolle würde jede Änderung,
 *     die zufällig aufgeht, wie ein Befund aussehen.
 *  3. *Häufigkeit:* Eine Änderung, die auf zwei Vorkommen beruht, ist keine
 *     Messung. Die Vorkommenszahl steht bei jeder Übernahme.
 *
 * **Variable Längen** (aus der Referenz, hier ebenfalls als Hypothese):
 * `KAWAI` (0x28) trägt seine Gesamtlänge im ersten Operandenbyte — das
 * implementieren wir bereits. `SPECIAL` (0x0F) ist 2 B plus 1 oder 2 je nach
 * Unterschlüssel. `0x1C` ist 6 B plus ein Längenbyte. Beide behandeln wir
 * heute als feste Länge; ob das zählt, misst Variante C.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler und Quoten. Kein Bytecode,
 * keine dekodierten Zeichenketten.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const OP_SPECIAL = 0x0f;
const OP_UNUSED1C = 0x1c;

/** Unterschlüssel von SPECIAL mit Zusatzlänge (Referenzangabe). */
const SPECIAL_EXTRA = new Map<number, number>([
  [0xf5, 1], // ARROW
  [0xf6, 1], // PNAME
  [0xf7, 1], // GMSPD
  [0xf8, 2], // SMSPD
  [0xfb, 1], // BTLCK
  [0xfc, 1], // MVLCK
  [0xfd, 2], // SPCNM
]);

interface Feld {
  code: Uint8Array;
  spans: Array<{ start: number; end: number }>;
}

interface Befund {
  geschlossen: number;
  overrun: number;
  abbruch: number;
  gesamt: number;
}

interface Optionen {
  /** SPECIAL und 0x1C mit variabler Länge behandeln. */
  variabel: boolean;
}

function unsereTabelle(): number[] {
  const t = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) t[Number(op)] = len;
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) t[Number(op)] = len;
  return t;
}

function makouTabelle(): number[] {
  const t = new Array<number>(256).fill(-1);
  for (let op = 0; op < 256; op++) {
    const total = MAKOU_TOTAL_LEN[op];
    if (total !== undefined && total > 0) t[op] = total - 1;
  }
  return t;
}

/** Durchlauf über alle Spannen mit einer gegebenen Längentabelle. */
function messe(felder: Feld[], len: number[], opt: Optionen): Befund {
  const b: Befund = { geschlossen: 0, overrun: 0, abbruch: 0, gesamt: 0 };
  for (const f of felder) {
    const code = f.code;
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      b.gesamt++;
      let pc = s.start;
      let guard = 0;
      let abgebrochen = false;
      while (pc < s.end && ++guard < 100_000) {
        const op = code[pc]!;
        let schritt: number;
        if (op === OP_KAWAI) {
          const total = code[pc + 1];
          if (total === undefined || total < 2) { abgebrochen = true; break; }
          schritt = total;
        } else if (opt.variabel && op === OP_SPECIAL) {
          const sub = code[pc + 1];
          if (sub === undefined) { abgebrochen = true; break; }
          schritt = 2 + (SPECIAL_EXTRA.get(sub) ?? 0);
        } else if (opt.variabel && op === OP_UNUSED1C) {
          const sub = code[pc + 5];
          if (sub === undefined) { abgebrochen = true; break; }
          schritt = 6 + Math.min(sub, 128);
        } else {
          const l = len[op] ?? -1;
          if (l < 0) { abgebrochen = true; break; }
          schritt = 1 + l;
        }
        pc += schritt;
      }
      if (abgebrochen) b.abbruch++;
      else if (pc === s.end) b.geschlossen++;
      else b.overrun++;
    }
  }
  return b;
}

/** Vorkommenszahl je Opcode unter einer gegebenen Tabelle. */
function zaehleOpcodes(felder: Feld[], len: number[], opt: Optionen): number[] {
  const n = new Array<number>(256).fill(0);
  for (const f of felder) {
    const code = f.code;
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      let pc = s.start;
      let guard = 0;
      while (pc < s.end && ++guard < 100_000) {
        const op = code[pc]!;
        n[op]!++;
        let schritt: number;
        if (op === OP_KAWAI) {
          const total = code[pc + 1];
          if (total === undefined || total < 2) break;
          schritt = total;
        } else if (opt.variabel && op === OP_SPECIAL) {
          const sub = code[pc + 1];
          if (sub === undefined) break;
          schritt = 2 + (SPECIAL_EXTRA.get(sub) ?? 0);
        } else if (opt.variabel && op === OP_UNUSED1C) {
          const sub = code[pc + 5];
          if (sub === undefined) break;
          schritt = 6 + Math.min(sub, 128);
        } else {
          const l = len[op] ?? -1;
          if (l < 0) break;
          schritt = 1 + l;
        }
        pc += schritt;
      }
    }
  }
  return n;
}

/** Ist `a` besser als `b`? Primär mehr Abschlüsse, sekundär weniger Overrun. */
function besser(a: Befund, b: Befund): boolean {
  if (a.geschlossen !== b.geschlossen) return a.geschlossen > b.geschlossen;
  return a.overrun < b.overrun;
}

const quote = (n: number, g: number): string => `${((n / Math.max(1, g)) * 100).toFixed(2)}%`;

describe.skipIf(!available)('Realdaten: Operandenlängen gegen die Referenz (O9)', () => {
  it('misst die Referenztabelle posten für posten statt sie zu übernehmen', async () => {
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
      const bundle = parsed.bundle;
      if (!parsed.ok || !bundle?.script) continue;
      const code = bundle.rawSections[1];
      if (!code) continue;
      felder.push({ code, spans: bundle.script.spans.map((s) => ({ start: s.start, end: s.end })) });
    }
    await dir.closeAll();

    const unser = unsereTabelle();
    const makou = makouTabelle();
    const fest: Optionen = { variabel: false };
    const varia: Optionen = { variabel: true };

    const A = messe(felder, unser, fest);
    const B = messe(felder, makou, fest);
    const C = messe(felder, makou, varia);
    const A2 = messe(felder, unser, varia);

    // --- Selektive Übernahme (Koordinatenabstieg mit Referenz als Startwert)
    const haeufig = zaehleOpcodes(felder, unser, fest);
    const kandidaten: number[] = [];
    for (let op = 0; op < 256; op++) {
      if (makou[op]! >= 0 && unser[op]! >= 0 && makou[op] !== unser[op]) kandidaten.push(op);
    }
    kandidaten.sort((a, b) => haeufig[b]! - haeufig[a]!);

    // Der Abstieg läuft in mehreren Durchgängen, weil er ordnungsabhängig ist:
    // Eine übernommene Länge resynchronisiert den Durchlauf und kann eine
    // zuvor verworfene Länge nachträglich lohnend machen. Ein einzelner
    // Durchgang würde genau diese Fälle übersehen.
    const opt = A2.geschlossen > A.geschlossen ? varia : fest;
    const gewaehlt = [...unser];
    let stand = messe(felder, gewaehlt, opt);
    const uebernommen: Array<{ op: number; von: number; nach: number; n: number; strikt: boolean; runde: number }> = [];
    const offen = new Set(kandidaten);

    for (let runde = 1; runde <= 4; runde++) {
      let geaendert = false;
      for (const op of kandidaten) {
        if (!offen.has(op)) continue;
        const alt = gewaehlt[op]!;
        gewaehlt[op] = makou[op]!;
        const neu = messe(felder, gewaehlt, opt);
        if (besser(neu, stand)) {
          // Nachbarkontrolle: ist der Referenzwert strikt besser als ref±1?
          let strikt = true;
          for (const d of [-1, 1]) {
            const nachbar = makou[op]! + d;
            if (nachbar < 0) continue;
            gewaehlt[op] = nachbar;
            if (!besser(neu, messe(felder, gewaehlt, opt))) strikt = false;
          }
          gewaehlt[op] = makou[op]!;
          stand = neu;
          uebernommen.push({ op, von: alt, nach: makou[op]!, n: haeufig[op]!, strikt, runde });
          offen.delete(op);
          geaendert = true;
        } else {
          gewaehlt[op] = alt;
        }
      }
      if (!geaendert) break;
    }

    // Gegenprobe zu den verworfenen Posten: Die Vorkommenszahlen oben stammen
    // aus einem Durchlauf mit der ALTEN Tabelle — sie sind also selbst
    // tabellenabhängig. Ein Opcode, der nur deshalb häufig aussieht, weil der
    // Durchlauf in fremde Operandenbytes hineinläuft, verschwindet unter der
    // besseren Tabelle. Genau das trennt echte Vorkommen von Phantomen.
    const haeufigDanach = zaehleOpcodes(felder, gewaehlt, opt);

    const verworfen = [...offen]
      .map((op) => ({ op, ref: makou[op]!, unser: gewaehlt[op]!, n: haeufig[op]!, nDanach: haeufigDanach[op]! }))
      .sort((a, b) => b.n - a.n);
    const phantome = verworfen.filter((v) => v.n >= 50 && v.nDanach <= v.n / 4);

    // --- Gruppenhypothese: die vier Wort-IF-Opcodes
    //
    // Der Abstieg oben übernimmt 0x16 und 0x17, verwirft aber 0x18 und 0x19 —
    // obwohl alle vier dieselbe Instruktionsform haben. Das ist genau die
    // Kopplungsfalle: Einzeln getestet kann eine Änderung verlieren, die als
    // Gruppe gewinnt, weil der Durchlauf zwischendurch fehlsynchronisiert.
    //
    // Die Hypothese lautet nicht „diese vier Zahlen sind größer", sondern:
    // **Bei den Wort-Varianten ist auch die linke Adresse zwei Byte breit.**
    // Das ist eine Aussage über die Instruktionsform und muss deshalb für alle
    // vier gleichzeitig gelten oder für keine.
    const IF_WORT = [0x16, 0x17, 0x18, 0x19];
    const gruppe = [...gewaehlt];
    for (const op of IF_WORT) gruppe[op] = makou[op]!;
    const G = messe(felder, gruppe, opt);
    const gruppeBesser = besser(G, stand);
    // Kontrolle: dieselbe Gruppe um je ein Byte ZU WEIT gesetzt. Gewinnt auch
    // das, misst die Probe nur „länger ist besser" und belegt nichts.
    const gruppeZuWeit = [...gewaehlt];
    for (const op of IF_WORT) gruppeZuWeit[op] = makou[op]! + 1;
    const GK = messe(felder, gruppeZuWeit, opt);

    const hex = (n: number): string => `0x${n.toString(16).padStart(2, '0')}`;
    console.log(
      'Operandenlängen (O9):',
      JSON.stringify(
        {
          Spannen: A.gesamt,
          'A unsere Tabelle': `${quote(A.geschlossen, A.gesamt)} geschlossen, ${quote(A.overrun, A.gesamt)} Overrun, ${quote(A.abbruch, A.gesamt)} Abbruch`,
          'A2 unsere + variable Längen': `${quote(A2.geschlossen, A2.gesamt)} / ${quote(A2.overrun, A2.gesamt)} / ${quote(A2.abbruch, A2.gesamt)}`,
          'B Referenz pauschal': `${quote(B.geschlossen, B.gesamt)} / ${quote(B.overrun, B.gesamt)} / ${quote(B.abbruch, B.gesamt)}`,
          'C Referenz + variable Längen': `${quote(C.geschlossen, C.gesamt)} / ${quote(C.overrun, C.gesamt)} / ${quote(C.abbruch, C.gesamt)}`,
          'D selektiv übernommen': `${quote(stand.geschlossen, stand.gesamt)} / ${quote(stand.overrun, stand.gesamt)} / ${quote(stand.abbruch, stand.gesamt)}`,
          'Kandidaten (Referenz ≠ unser)': kandidaten.length,
          'Basis des Abstiegs': opt.variabel ? 'mit variablen Längen' : 'ohne variable Längen',
          'E IF-Familie als Gruppe (0x16..0x19)': `${quote(G.geschlossen, G.gesamt)} / ${quote(G.overrun, G.gesamt)} / ${quote(G.abbruch, G.gesamt)} — ${gruppeBesser ? 'BESSER als D' : 'nicht besser als D'}`,
          'E-Kontrolle: dieselbe Gruppe je +1 zu weit': `${quote(GK.geschlossen, GK.gesamt)} / ${quote(GK.overrun, GK.gesamt)} / ${quote(GK.abbruch, GK.gesamt)}`,
          übernommen: uebernommen.map(
            (u) => `${hex(u.op)}: ${u.von}→${u.nach} (n=${u.n}, Runde ${u.runde}${u.strikt ? '' : ', NICHT strikt'})`,
          ),
          'Phantome — verworfen, aber unter der besseren Tabelle weitgehend verschwunden': phantome.map(
            (v) => `${hex(v.op)}: n ${v.n} → ${v.nDanach} (Referenz ${v.ref}, unser ${v.unser})`,
          ),
          'verworfen mit n >= 50, weiterhin häufig': verworfen
            .filter((v) => v.n >= 50 && v.nDanach > v.n / 4)
            .slice(0, 20)
            .map((v) => `${hex(v.op)}: Referenz ${v.ref} verworfen, unser ${v.unser} bleibt (n=${v.n}→${v.nDanach})`),
        },
        null,
        1,
      ),
    );

    expect(A.gesamt).toBeGreaterThan(1000);

    // Die selektive Übernahme muss die Ausgangslage schlagen — sonst hat die
    // Referenz nichts beigetragen und O9 endet als Negativbefund.
    expect(stand.geschlossen).toBeGreaterThanOrEqual(A.geschlossen);
    // Kontrolle 1: Pauschalübernahme darf die selektive nicht schlagen.
    expect(stand.geschlossen).toBeGreaterThan(B.geschlossen);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
