import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { MAKOU_TOTAL_LEN, MAKOU_NAME } from './makou-lengths.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * **Längentabellen-Bündel** — sieben Restposten in EINEM Durchgang.
 *
 * Warum gebündelt: Jede einzelne Längenänderung verschiebt den Instruktions-
 * strom und entwertet damit die Häufigkeitszahlen aller anderen laufenden
 * Messungen. Wer sieben Posten nacheinander übernimmt, misst sechsmal gegen
 * eine Tabelle, die er selbst schon verändert hat, und erzwingt sieben
 * engineCompat-Schritte. Darum: alle zusammen messen, alle zusammen übernehmen
 * oder verwerfen, EIN engineCompat-Schritt.
 *
 * **Gütefunktion** ist wie in O9 der Spannen-Abschluss: Jede der 48.041
 * Script-Spannen ist ein zusammenhängender Instruktionsstrom, der beim linearen
 * Durchlaufen exakt auf seinem Ende landen muss.
 *
 * **Übernahmekriterium (O9-Standard).** Der Referenzwert wird nur übernommen,
 * wenn er STRIKT besser ist als der Ist-Wert UND strikt besser als beide
 * Nachbarn `ref−1` und `ref+1`. Ohne die Nachbarkontrolle sähe jede Änderung,
 * die zufällig aufgeht, wie ein Befund aus.
 *
 * **Vorkommenszahlen.** Für jeden Posten wird die absolute Zahl der Vorkommen
 * über alle Fields berichtet — einmal unter der Ist-Tabelle, einmal unter der
 * Bündeltabelle. Beide Zahlen sind tabellenabhängig: Ein Opcode kann unter der
 * falschen Tabelle nur deshalb häufig aussehen, weil der Durchlauf in fremde
 * Operandenbytes hineinläuft (Phantomvorkommen). Kommt ein Posten gar nicht
 * vor, ist das ein eigenständiger Befund und wird als solcher gemeldet — eine
 * Länge ohne Vorkommen ist durch diese Gütefunktion nicht belegbar.
 *
 * Urheberrecht: ausschließlich Zähler und Quoten über die Daten des Nutzers.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Die sieben Posten des Bündels. */
const POSTEN: readonly number[] = [0x20, 0x27, 0xfb, 0xe2, 0xe3, 0xa6, 0xa7];

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

function unsereTabelle(): number[] {
  const t = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) t[Number(op)] = len;
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) t[Number(op)] = len;
  return t;
}

/** Referenz-Operandenlänge = Gesamtlänge − 1; −1 heißt „nicht belegt". */
function refOperand(op: number): number {
  const total = MAKOU_TOTAL_LEN[op] ?? 0;
  return total > 0 ? total - 1 : -1;
}

/** Ein Spannen-Durchlauf. `treffer` sammelt, welche Opcodes berührt wurden. */
function laufe(
  code: Uint8Array,
  s: { start: number; end: number },
  len: number[],
  treffer?: Set<number>,
): 'geschlossen' | 'overrun' | 'abbruch' {
  let pc = s.start;
  let guard = 0;
  while (pc < s.end && ++guard < 100_000) {
    const op = code[pc]!;
    treffer?.add(op);
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

function messe(felder: Feld[], len: number[], nurSpannen?: Set<string>): Befund {
  const b: Befund = { geschlossen: 0, overrun: 0, abbruch: 0, gesamt: 0 };
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      if (nurSpannen && !nurSpannen.has(`${f.name}:${s.start}:${s.end}`)) continue;
      b.gesamt++;
      const r = laufe(f.code, s, len);
      if (r === 'abbruch') b.abbruch++;
      else if (r === 'geschlossen') b.geschlossen++;
      else b.overrun++;
    }
  }
  return b;
}

/**
 * Die Spannen, in denen ein Opcode unter IRGENDEINER der geprüften Längen
 * vorkommt. Nur auf dieser Teilmenge ist der Spannen-Abschluss überhaupt
 * empfindlich — über alle 48.041 Spannen verschwinden 32 Vorkommen im Rauschen
 * und die Probe meldet fälschlich „kein Unterschied".
 */
function betroffeneSpannen(felder: Feld[], op: number, tabellen: number[][]): Set<string> {
  const out = new Set<string>();
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      for (const t of tabellen) {
        const treffer = new Set<number>();
        laufe(f.code, s, t, treffer);
        if (treffer.has(op)) {
          out.add(`${f.name}:${s.start}:${s.end}`);
          break;
        }
      }
    }
  }
  return out;
}

/** Vorkommen je Opcode + Anzahl der Fields, in denen er auftaucht. */
function zaehle(felder: Feld[], len: number[]): { n: number[]; fields: number[]; beispiele: Map<number, string[]> } {
  const n = new Array<number>(256).fill(0);
  const fields = new Array<number>(256).fill(0);
  const beispiele = new Map<number, string[]>();
  for (const f of felder) {
    const lokal = new Array<number>(256).fill(0);
    const code = f.code;
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      let pc = s.start;
      let guard = 0;
      while (pc < s.end && ++guard < 100_000) {
        const op = code[pc]!;
        n[op]!++;
        lokal[op]!++;
        let schritt: number;
        if (op === OP_KAWAI) {
          const total = code[pc + 1];
          if (total === undefined || total < 2) break;
          schritt = total;
        } else {
          const l = len[op] ?? -1;
          if (l < 0) break;
          schritt = 1 + l;
        }
        pc += schritt;
      }
    }
    for (const op of POSTEN) {
      if (lokal[op]! > 0) {
        fields[op]!++;
        const liste = beispiele.get(op) ?? [];
        if (liste.length < 6) liste.push(`${f.name}×${lokal[op]}`);
        beispiele.set(op, liste);
      }
    }
  }
  return { n, fields, beispiele };
}

/**
 * **Grenzplausibilität** — die zweite, schärfere Gütefunktion.
 *
 * Der Spannen-Abschluss versagt bei seltenen Opcodes aus einem messbaren
 * Grund: Der Instruktionsstrom **resynchronisiert sich selbst**. Setzt man die
 * Länge von `XYI` von 2 auf 8, landet der Durchlauf sechs Byte weiter, findet
 * aber nach wenigen Instruktionen wieder auf dasselbe Raster zurück und
 * schließt die Spanne trotzdem exakt — in allen 32 betroffenen Spannen. Das
 * ist keine Eigenheit dieses Bestands, sondern das bekannte Verhalten
 * variabler Befehlsformate.
 *
 * Deshalb wird zusätzlich gemessen, ob die Stelle **direkt hinter** den
 * Operanden überhaupt wie ein Instruktionsanfang aussieht. Grundlage sind zwei
 * empirische Byteverteilungen über alle 702 Fields:
 *
 *  - `Pgrenze` — Bytes an echten Instruktionsanfängen (verankert durch den
 *    Spannenanfang, nur aus Spannen, die sauber schließen).
 *  - `Poperand` — Bytes, die innerhalb von Operanden liegen.
 *
 * Beide unterscheiden sich stark: Opcodes häufen sich auf wenige Werte
 * (RET, REQ, IFUB, JMPF), Operandenbytes streuen breit. Der Log-Quotient
 * `log(Pgrenze/Poperand)` ist damit ein Maß dafür, wie sehr eine Position nach
 * Instruktionsanfang aussieht.
 *
 * **Kontrollniveaus** (ohne sie wäre die Zahl wertlos): Der Mittelwert über
 * ALLE echten Instruktionsanfänge ist das obere, der über alle Operandenbytes
 * das untere Niveau. Ein Kandidat zählt nur, wenn er sich vom unteren Niveau
 * deutlich abhebt und die Alternativen klar schlägt.
 */
interface Verteilungen {
  llr: Float64Array;
  obenNiveau: number;
  untenNiveau: number;
}

function baueVerteilungen(felder: Feld[], len: number[]): { v: Verteilungen; grenzen: Map<string, Uint8Array> } {
  const grenzeN = new Float64Array(256);
  const operandN = new Float64Array(256);
  const grenzen = new Map<string, Uint8Array>();
  for (const f of felder) {
    const mark = new Uint8Array(f.code.length);
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      if (laufe(f.code, s, len) !== 'geschlossen') continue;
      let pc = s.start;
      let guard = 0;
      while (pc < s.end && ++guard < 100_000) {
        mark[pc] = 1;
        const op = f.code[pc]!;
        const l = op === OP_KAWAI ? (f.code[pc + 1] ?? 2) - 1 : len[op]!;
        if (l < 0) break;
        for (let i = pc + 1; i < pc + 1 + l && i < s.end; i++) mark[i] = 2;
        pc += 1 + l;
      }
    }
    grenzen.set(f.name, mark);
    for (let i = 0; i < mark.length; i++) {
      if (mark[i] === 1) grenzeN[f.code[i]!]!++;
      else if (mark[i] === 2) operandN[f.code[i]!]!++;
    }
  }
  const gSum = grenzeN.reduce((a, b) => a + b, 0) + 256;
  const oSum = operandN.reduce((a, b) => a + b, 0) + 256;
  const llr = new Float64Array(256);
  for (let b = 0; b < 256; b++) {
    llr[b] = Math.log(((grenzeN[b]! + 1) / gSum) / ((operandN[b]! + 1) / oSum));
  }
  let oben = 0;
  let unten = 0;
  let gN = 0;
  let oN = 0;
  for (let b = 0; b < 256; b++) {
    oben += llr[b]! * grenzeN[b]!;
    gN += grenzeN[b]!;
    unten += llr[b]! * operandN[b]!;
    oN += operandN[b]!;
  }
  return { v: { llr, obenNiveau: oben / Math.max(1, gN), untenNiveau: unten / Math.max(1, oN) }, grenzen };
}

/**
 * Fundstellen eines Opcodes an **gesicherten** Instruktionsanfängen.
 *
 * Nur die ERSTE Fundstelle je Spanne zählt. Grund: Ist die geprüfte Länge
 * falsch, läuft der Strom ab der ersten Fundstelle aus dem Takt — jede weitere
 * „Fundstelle" derselben Spanne kann ein Phantom aus fremden Operandenbytes
 * sein. Die erste dagegen ist durch den Spannenanfang verankert und von der
 * geprüften Länge unabhängig. Ohne diese Einschränkung misst die Probe zum Teil
 * ihre eigene Fehlannahme.
 */
function fundstellen(felder: Feld[], len: number[], op: number): Array<{ f: Feld; pos: number }> {
  const out: Array<{ f: Feld; pos: number }> = [];
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      if (laufe(f.code, s, len) !== 'geschlossen') continue;
      let pc = s.start;
      let guard = 0;
      while (pc < s.end && ++guard < 100_000) {
        if (f.code[pc] === op) {
          out.push({ f, pos: pc });
          break;
        }
        const o = f.code[pc]!;
        const l = o === OP_KAWAI ? (f.code[pc + 1] ?? 2) - 1 : len[o]!;
        if (l < 0) break;
        pc += 1 + l;
      }
    }
  }
  return out;
}

/**
 * Mittlerer Log-Quotient an der Stelle hinter `laenge` Operandenbytes, mit
 * Standardfehler — ohne ihn ist ein Mittelwert über 13 Fundstellen keine
 * Messung, sondern eine Zahl.
 */
function grenzScore(
  stellen: Array<{ f: Feld; pos: number }>,
  v: Verteilungen,
  laenge: number,
): { mittel: number; fehler: number; n: number } {
  const werte: number[] = [];
  for (const { f, pos } of stellen) {
    const at = pos + 1 + laenge;
    if (at >= f.code.length) continue;
    werte.push(v.llr[f.code[at]!]!);
  }
  const n = werte.length;
  if (n === 0) return { mittel: Number.NaN, fehler: Number.NaN, n };
  const m = werte.reduce((a, b) => a + b, 0) / n;
  const varianz = n > 1 ? werte.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1) : 0;
  return { mittel: m, fehler: Math.sqrt(varianz / n), n };
}

/**
 * **Nahstellen-Test** — die dritte Gütefunktion, und die einzige, die den
 * Selbstresynchronisations-Einwand vollständig aushebelt.
 *
 * Liegt eine Fundstelle nur wenige Bytes vor dem Spannenende, hat der Strom
 * keinen Raum, sich nach einer falschen Länge wieder einzufangen: Entweder die
 * Länge passt und die Spanne schließt, oder sie schießt über das Ende hinaus.
 * Zusätzlich gilt hart: Die Operanden müssen in die Spanne passen, also
 * `Länge ≤ Abstand − 1`. Der kleinste beobachtete Abstand ist damit eine
 * **obere Schranke** für die Länge — unabhängig von jeder Statistik.
 */
function nahstellenTest(
  felder: Feld[],
  ist: number[],
  op: number,
  maxAbstand: number,
): { schranke: number; abstaende: number[]; proLaenge: Map<number, { ok: number; n: number }> } {
  const stellen = fundstellen(felder, ist, op);
  const abstaende: number[] = [];
  const nah: Array<{ f: Feld; s: { start: number; end: number } }> = [];
  for (const { f, pos } of stellen) {
    const s = f.spans.find((x) => pos >= x.start && pos < x.end);
    if (!s) continue;
    abstaende.push(s.end - pos);
    if (s.end - pos <= maxAbstand) nah.push({ f, s });
  }
  const proLaenge = new Map<number, { ok: number; n: number }>();
  for (let L = 0; L <= 14; L++) {
    const t = [...ist];
    t[op] = L;
    let ok = 0;
    for (const { f, s } of nah) {
      if (laufe(f.code, s, t) === 'geschlossen') ok++;
    }
    proLaenge.set(L, { ok, n: nah.length });
  }
  return { schranke: abstaende.length ? Math.min(...abstaende) - 1 : -1, abstaende: abstaende.slice().sort((a, b) => a - b), proLaenge };
}

/** Primär mehr Abschlüsse, sekundär weniger Overrun. */
function besser(a: Befund, b: Befund): boolean {
  if (a.geschlossen !== b.geschlossen) return a.geschlossen > b.geschlossen;
  return a.overrun < b.overrun;
}

const quote = (n: number, g: number): string => `${((n / Math.max(1, g)) * 100).toFixed(4)}%`;
const hex = (n: number): string => `0x${n.toString(16).padStart(2, '0')}`;

export async function ladeFelder(): Promise<Feld[]> {
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
    felder.push({ name: entry.name, code, spans: bundle.script.spans.map((s) => ({ start: s.start, end: s.end })) });
  }
  await dir.closeAll();
  return felder;
}

describe.skipIf(!available)('Realdaten: Längentabellen-Bündel (7 Posten in einem Durchgang)', () => {
  it('misst jeden Posten gegen Ist und gegen ref±1 und bündelt die Übernahme', { timeout: 1_800_000 }, async () => {
    const felder = await ladeFelder();
    const ist = unsereTabelle();
    const A = messe(felder, ist);
    const vorher = zaehle(felder, ist);

    // --- Schritt 0: Grenzplausibilität (die schärfere Gütefunktion) ---------
    const { v } = baueVerteilungen(felder, ist);
    const grenzTabelle: string[] = [];
    const grenzUrteil = new Map<number, { bestL: number; best: number; fehler: number; refWert: number; istWert: number; n: number }>();
    for (const op of POSTEN) {
      const stellen = fundstellen(felder, ist, op);
      const werte: string[] = [];
      let bestL = -1;
      let best = -Infinity;
      let fehler = Number.NaN;
      for (let L = 0; L <= 12; L++) {
        const s = grenzScore(stellen, v, L);
        werte.push(`${L}:${s.mittel.toFixed(2)}`);
        if (s.mittel > best) {
          best = s.mittel;
          bestL = L;
          fehler = s.fehler;
        }
      }
      const istWert = grenzScore(stellen, v, ist[op]!).mittel;
      const refWert = grenzScore(stellen, v, refOperand(op)).mittel;
      grenzUrteil.set(op, { bestL, best, fehler, refWert, istWert, n: stellen.length });
      grenzTabelle.push(
        `${hex(op)} ${MAKOU_NAME[op]}: n=${stellen.length} (erste Fundstelle je Spanne) | ist ${ist[op]}→${istWert.toFixed(2)} · ref ${refOperand(op)}→${refWert.toFixed(2)} · Bestwert L=${bestL}→${best.toFixed(2)}±${fehler.toFixed(2)} | alle: ${werte.join(' ')}`,
      );
    }

    // --- Schritt 0b: Nahstellen-Test + harte obere Schranke -----------------
    const nahTabelle: string[] = [];
    for (const op of POSTEN) {
      const n = nahstellenTest(felder, ist, op, 20);
      const zeile = [...n.proLaenge.entries()].map(([L, r]) => `${L}:${r.ok}`).join(' ');
      const gesamt = n.proLaenge.get(0)!.n;
      nahTabelle.push(
        `${hex(op)} ${MAKOU_NAME[op]}: obere Schranke Länge ≤ ${n.schranke} (kleinster Abstand zum Spannenende ${n.schranke + 1}) | Abstände ${n.abstaende.slice(0, 10).join(',')} | Nahstellen (≤20 B) ${gesamt}, davon geschlossen je Länge: ${zeile}`,
      );
    }

    // --- Schritt 1: jeder Posten EINZELN gegen Ist und gegen ref±1 -----------
    const einzeln: Array<{
      op: number;
      name: string;
      istLen: number;
      refLen: number;
      n: number;
      fields: number;
      besserAlsIst: boolean;
      striktGegenNachbarn: boolean;
      abschluss: string;
      nachbarn: string;
    }> = [];

    for (const op of POSTEN) {
      const istLen = ist[op]!;
      const refLen = refOperand(op);
      // Teilmenge: alle Spannen, in denen der Opcode unter Ist- ODER
      // Referenzlänge auftaucht. Nur hier ist die Gütefunktion empfindlich.
      const probeRef = [...ist];
      probeRef[op] = refLen;
      const teil = betroffeneSpannen(felder, op, [ist, probeRef]);
      const AT = messe(felder, ist, teil);
      const probe = [...ist];
      probe[op] = refLen;
      const R = messe(felder, probe, teil);
      const nachbarwerte: string[] = [];
      let strikt = refLen !== istLen && besser(R, AT);
      for (const d of [-1, 1]) {
        const nb = refLen + d;
        if (nb < 0) continue;
        probe[op] = nb;
        const N = messe(felder, probe, teil);
        nachbarwerte.push(`${nb}→${N.geschlossen}/${N.gesamt}`);
        if (!besser(R, N)) strikt = false;
      }
      einzeln.push({
        op,
        name: MAKOU_NAME[op] ?? '?',
        istLen,
        refLen,
        n: vorher.n[op]!,
        fields: vorher.fields[op]!,
        besserAlsIst: besser(R, AT),
        striktGegenNachbarn: strikt,
        abschluss: `Teilmenge ${teil.size} Spannen: ist ${AT.geschlossen}/${AT.gesamt}, ref ${R.geschlossen}/${R.gesamt}`,
        nachbarn: nachbarwerte.join(', '),
      });
    }

    // --- Schritt 2: Bündel aus allen einzeln belegten Posten -----------------
    // Zusätzlich ein Gruppentest: XYI/XYZ haben dieselbe Instruktionsform wie
    // XYZI (Bankpaare + i16-Felder) — sie müssen beide dieselbe Länge tragen
    // oder keine. Einzeln kann eine Gruppenänderung verlieren, weil der
    // Durchlauf zwischendurch fehlsynchronisiert (O9-Kopplungsfalle).
    const XY_GRUPPE = [0xa6, 0xa7];
    const gruppe = [...ist];
    for (const op of XY_GRUPPE) gruppe[op] = refOperand(op);
    const xyTeil = new Set<string>([
      ...betroffeneSpannen(felder, 0xa6, [ist, gruppe]),
      ...betroffeneSpannen(felder, 0xa7, [ist, gruppe]),
    ]);
    const AXY = messe(felder, ist, xyTeil);
    const G = messe(felder, gruppe, xyTeil);
    const gruppeZuWeit = [...ist];
    for (const op of XY_GRUPPE) gruppeZuWeit[op] = refOperand(op) + 1;
    const GK = messe(felder, gruppeZuWeit, xyTeil);
    const gruppeZuKurz = [...ist];
    for (const op of XY_GRUPPE) gruppeZuKurz[op] = refOperand(op) - 1;
    const GKK = messe(felder, gruppeZuKurz, xyTeil);

    const belegt = einzeln
      .filter((e) => e.striktGegenNachbarn)
      .map((e) => e.op);
    // Die XY-Gruppe kommt hinzu, wenn sie als Gruppe strikt gewinnt.
    const gruppeBelegt = besser(G, AXY) && besser(G, GK) && besser(G, GKK);
    const buendelOps = new Set(belegt);
    if (gruppeBelegt) for (const op of XY_GRUPPE) buendelOps.add(op);

    const buendel = [...ist];
    for (const op of buendelOps) buendel[op] = refOperand(op);
    const B = messe(felder, buendel);
    const nachher = zaehle(felder, buendel);

    // Kontrolle: dasselbe Bündel, jede Länge um ein Byte zu weit. Gewinnt auch
    // das, misst die Probe nur „länger ist besser" und belegt nichts.
    const buendelZuWeit = [...ist];
    for (const op of buendelOps) buendelZuWeit[op] = refOperand(op) + 1;
    const BK = messe(felder, buendelZuWeit);

    console.log(
      'Längentabellen-Bündel:',
      JSON.stringify(
        {
          Fields: felder.length,
          Spannen: A.gesamt,
          'Ist-Tabelle': `${quote(A.geschlossen, A.gesamt)} geschlossen (${A.geschlossen}/${A.gesamt}), Overrun ${quote(A.overrun, A.gesamt)}, Abbruch ${quote(A.abbruch, A.gesamt)}`,
          'Grenzplausibilität — Kontrollniveaus': `echte Instruktionsanfänge ${v.obenNiveau.toFixed(2)} · Operandenbytes ${v.untenNiveau.toFixed(2)} (Log-Quotient; höher = sieht mehr nach Instruktionsanfang aus)`,
          'Grenzplausibilität je Posten': grenzTabelle,
          'Nahstellen-Test (kein Raum zum Resynchronisieren)': nahTabelle,
          Posten: einzeln.map(
            (e) =>
              `${hex(e.op)} ${e.name}: ist ${e.istLen} / ref ${e.refLen} — n=${e.n} in ${e.fields} Fields — ${e.abschluss}` +
              ` | Nachbarn ${e.nachbarn} | ${e.n === 0 ? 'KEIN VORKOMMEN' : e.striktGegenNachbarn ? 'STRIKT BELEGT' : e.besserAlsIst ? 'besser, aber nicht strikt' : 'nicht besser'}`,
          ),
          Beispielfields: Object.fromEntries(
            POSTEN.map((op) => [hex(op), (vorher.beispiele.get(op) ?? []).join(', ') || '—']),
          ),
          'XY-Gruppe (0xa6+0xa7 gemeinsam)': `Teilmenge ${xyTeil.size}: ist ${AXY.geschlossen}, ref ${G.geschlossen} — ${gruppeBelegt ? 'STRIKT BESSER als Ist und als ±1' : 'nicht strikt'}`,
          'XY-Gruppe Kontrolle +1': `${GK.geschlossen}/${GK.gesamt}`,
          'XY-Gruppe Kontrolle −1': `${GKK.geschlossen}/${GKK.gesamt}`,
          'Bündel übernommen': [...buendelOps].map((op) => `${hex(op)} ${ist[op]}→${refOperand(op)}`),
          'Bündel-Abschluss': `${quote(B.geschlossen, B.gesamt)} (${B.geschlossen}/${B.gesamt}), Overrun ${quote(B.overrun, B.gesamt)}, Abbruch ${quote(B.abbruch, B.gesamt)}`,
          'Bündel-Kontrolle je +1 zu weit': `${quote(BK.geschlossen, BK.gesamt)} (${BK.geschlossen}/${BK.gesamt})`,
          'Vorkommen nachher (Phantomkontrolle)': Object.fromEntries(
            POSTEN.map((op) => [hex(op), `${vorher.n[op]} → ${nachher.n[op]} (Fields ${vorher.fields[op]} → ${nachher.fields[op]})`]),
          ),
        },
        null,
        1,
      ),
    );

    expect(A.gesamt).toBeGreaterThan(1000);
    // Das Bündel darf die Ausgangslage nie verschlechtern.
    expect(B.geschlossen).toBeGreaterThanOrEqual(A.geschlossen);
    // Kontrolle: „ein Byte zu weit" darf nicht gewinnen.
    expect(BK.geschlossen).toBeLessThanOrEqual(B.geschlossen);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
