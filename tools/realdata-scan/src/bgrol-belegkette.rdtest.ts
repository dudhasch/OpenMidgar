import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { MAKOU_NAME, MAKOU_TOTAL_LEN } from './makou-lengths.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * **Dauerprobe: die Belegkette für BGROL (0xE2) / BGROL2 (0xE3).**
 *
 * Sie ersetzt fünfzehn Wegwerfsonden eines einzigen Tages. Nachgerechnet wird
 * genau das, worauf die Entscheidung steht — nicht mehr:
 *
 *  **A — Das kostenfreie Referenzbündel.** Für jede Abweichung zwischen
 *  unserer Längentabelle und der Referenz wird der Referenzwert isoliert
 *  gesetzt und der Spannen-Abschluss über alle Spannen gemessen. Belegt
 *  einzeln, dass 0x42 MPRA2 (0 → 5) und 0xCE MMBLK (0 → 1) den Abschluss
 *  **bitgleich** lassen, und dass das ganze übernommene Bündel ihn nicht
 *  verschlechtert. ⚠️ Kostenfreiheit ist KEIN Beleg für Richtigkeit — sie
 *  senkt nur die Phantomrate. Die Probe sagt das mit Zahlen, indem sie zeigt,
 *  wie viele der Kandidaten den Abschluss überhaupt bewegen könnten.
 *
 *  **B — Die Phantomrate selbst.** Wie viele 0xE2-Fundstellen bleiben vor und
 *  nach den Korrekturen übrig, und in welchen Fields? Das ist die Zahl, an
 *  der die alte Auswertung gescheitert ist: Sie zählte Phantome, die ihre
 *  eigene Längentabelle an ganz anderer Stelle erzeugt hatte.
 *
 *  **C — Der eigentliche Beleg: die Struktur der Spanne `hyou4`
 *  [2137, 2213).** Fünf 0xE2- und vier 0xE3-Blöcke, byteidentisch gebaut.
 *  Unter Länge 1 zerfällt die e2-Hälfte, unter Länge 2 lesen beide gleich.
 *  Statistikfrei, n=1 — und genau deshalb tragfähig: Es ist kein Stichproben-,
 *  sondern ein Konstruktionsargument.
 *
 *  **D — Die Semantikfrage, die die Daten NICHT hergeben.** Rotiert BGROL die
 *  Maske um ein Bit (a) oder springt es auf den nächsten tatsächlich
 *  vorkommenden Zustand (b)? Entscheidbar wäre das nur an einem Field mit
 *  Zustandslücke, das BGROL benutzt. Die Probe zählt, wie viele Gruppen
 *  Lücken haben und ob eine davon in einem BGROL-Field liegt.
 *
 *  **E — Die Rotationsbreite.** Der Zustandsoperand von BGON/BGOFF und die
 *  Kachelzustände geben die Breite des Zustandsraums vor.
 *
 * Zwei **Sanity-Zusicherungen** aus der abgelösten Nachlese bleiben scharf:
 * Die BGON-Eichung muss über 90 % treffen (sie ist tautologisch — genau
 * deshalb taugt sie als Selbsttest der Messanlage), und die Verteilungen von
 * echten Instruktionsanfängen und Operandenbytes müssen sich um mehr als 20
 * Punkte trennen. Reißt eine davon, misst die Anlage nicht mehr, was sie soll.
 *
 * Urheberrecht: ausschließlich Zähler und Quoten über die Daten des Nutzers.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(REAL_DIR);
const hex = (n: number): string => `0x${n.toString(16).padStart(2, '0')}`;

interface Feld {
  name: string;
  code: Uint8Array;
  spans: Array<{ start: number; end: number }>;
  kacheln: Array<{ param: number; state: number }>;
}

interface Abschluss {
  zu: number;
  n: number;
  over: number;
  unb: number;
}

/** Die heutige Tabelle des Interpreters (beide Hälften vereinigt). */
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

/**
 * Spannen-Abschluss: Jede Spanne ist ein zusammenhängender Instruktionsstrom
 * und muss beim linearen Durchlaufen exakt auf ihrem Ende landen.
 */
function abschluss(felder: Feld[], len: number[]): Abschluss {
  let zu = 0;
  let n = 0;
  let over = 0;
  let unb = 0;
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      n++;
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
  return { zu, n, over, unb };
}

/** Instruktionsanfänge einer Spanne unter `len`. */
function grenzen(code: Uint8Array, s: { start: number; end: number }, len: number[]): number[] {
  const out: number[] = [];
  let pc = s.start;
  let guard = 0;
  while (pc < s.end && ++guard < 100_000) {
    out.push(pc);
    const sch = schritt(code, pc, len);
    if (sch < 0) return out;
    pc += sch;
  }
  return out;
}

/** Alle Vorkommen von `op` im gelaufenen Strom, mit Field und Position. */
function fundstellen(felder: Feld[], len: number[], op: number): Array<{ f: Feld; pos: number }> {
  const out: Array<{ f: Feld; pos: number }> = [];
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      for (const pc of grenzen(f.code, s, len)) if (f.code[pc] === op) out.push({ f, pos: pc });
    }
  }
  return out;
}

function disasm(code: Uint8Array, s: { start: number; end: number }, len: number[]): string[] {
  const out: string[] = [];
  let pc = s.start;
  let guard = 0;
  while (pc < s.end && ++guard < 100_000) {
    const op = code[pc]!;
    const l = op === OP_KAWAI ? (code[pc + 1] ?? 2) - 1 : len[op] ?? -1;
    if (l < 0) {
      out.push(`${pc}: ${op.toString(16)} <UNBEKANNT> → Abbruch`);
      return out;
    }
    out.push(
      `${pc}: ${op.toString(16).padStart(2, '0')} ${(MAKOU_NAME[op] || '?').padEnd(8)} ${[
        ...code.slice(pc + 1, Math.min(pc + 1 + l, s.end)),
      ]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')}`,
    );
    pc += 1 + l;
  }
  out.push(pc === s.end ? '— geschlossen —' : `— Überlauf +${pc - s.end} —`);
  return out;
}

describe.skipIf(!available)('Realdaten: Belegkette BGROL / BGROL2', () => {
  it('rechnet Bündel, Phantomrate, Spannenstruktur und Semantikfrage nach', { timeout: 1_800_000 }, async () => {
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
      const kacheln: Array<{ param: number; state: number }> = [];
      for (const layer of b.background?.layers ?? [])
        for (const t of layer.tiles) kacheln.push({ param: t.param, state: t.state });
      felder.push({
        name: entry.name,
        code: b.rawSections[1]!,
        spans: b.script.spans.map((s) => ({ start: s.start, end: s.end })),
        kacheln,
      });
    }
    await dir.closeAll();

    const ist = istTabelle();
    const heute = abschluss(felder, ist);

    // ── A ── Das Bündel: Stand VOR den Korrekturen rekonstruieren, dann jede
    // Korrektur isoliert und alle gemeinsam messen. „Vorher" ist die heutige
    // Tabelle mit den 53 Werten auf ihrem alten Stand.
    const VORHER: ReadonlyArray<readonly [number, number]> = [
      [0x1b, 0], [0x21, 0], [0x22, 1], [0x27, 0], [0x2f, 8], [0x38, 0], [0x3a, 4], [0x3b, 4],
      [0x41, 1], [0x42, 0], [0x45, 0], [0x4b, 0], [0x4c, 7], [0x4e, 14], [0x4f, 10], [0x51, 3],
      [0x55, 1], [0x56, 3], [0x57, 8], [0x59, 2], [0x5a, 1], [0x5c, 5], [0x5f, 1], [0x61, 10],
      [0x69, 6], [0x72, 1], [0x9b, 0], [0x9c, 1], [0x9d, 1], [0x9e, 0], [0xb5, 3], [0xb7, 2],
      [0xbe, 3], [0xc0, 9], [0xc3, 10], [0xcc, 0], [0xce, 0], [0xcf, 0], [0xd0, 13], [0xd4, 0],
      [0xd5, 1], [0xd6, 1], [0xd9, 2], [0xda, 0], [0xdb, 2], [0xe2, 1], [0xe8, 4], [0xea, 14],
      [0xeb, 1], [0xee, 0], [0xf3, 3], [0xf4, 3], [0xf7, 8],
    ];
    const vorher = ist.slice();
    for (const [op, l] of VORHER) vorher[op] = l;
    const basis = abschluss(felder, vorher);

    const einzeln: Array<Record<string, unknown>> = [];
    for (const [op, altwert] of VORHER) {
      const t = vorher.slice();
      t[op] = ist[op]!;
      const a = abschluss(felder, t);
      einzeln.push({
        op: `${hex(op)} ${MAKOU_NAME[op] || '?'}`,
        'alt → neu': `${altwert} → ${ist[op]}`,
        Abschluss: `${a.zu}/${a.over}/${a.unb} gegen Basis ${basis.zu}/${basis.over}/${basis.unb}`,
        Urteil:
          a.zu === basis.zu && a.over === basis.over && a.unb === basis.unb
            ? 'bitgleich'
            : a.zu >= basis.zu && a.unb <= basis.unb
              ? 'besser'
              : 'SCHLECHTER',
      });
    }
    const bitgleich = einzeln.filter((e) => e['Urteil'] === 'bitgleich').length;
    const schlechter = einzeln.filter((e) => e['Urteil'] === 'SCHLECHTER');

    // ── B ── Phantomrate.
    const e2Vorher = fundstellen(felder, vorher, 0xe2);
    const e2Heute = fundstellen(felder, ist, 0xe2);
    const e3Heute = fundstellen(felder, ist, 0xe3);
    const namen = (x: Array<{ f: Feld; pos: number }>): string[] => [...new Set(x.map((y) => y.f.name))].sort();

    // ── C ── hyou4.
    const hyou4 = felder.find((f) => f.name === 'hyou4');
    const span = hyou4?.spans.find((s) => s.start === 2137);
    const alteTabelle = ist.slice();
    alteTabelle[0xe2] = 1;
    const rollen = span ? grenzen(hyou4!.code, span, ist).filter((p) => hyou4!.code[p] === 0xe2 || hyou4!.code[p] === 0xe3) : [];
    // Der Schleifenrumpf ab 2145: Wo liegt das erste RET?
    const rumpf = { start: 2145, end: 2213 };
    const retNeu = hyou4 ? grenzen(hyou4.code, rumpf, ist).find((p) => hyou4.code[p] === 0x00) : undefined;
    const retAlt = hyou4 ? grenzen(hyou4.code, rumpf, alteTabelle).find((p) => hyou4.code[p] === 0x00) : undefined;

    // ── D ── Zustandslücken gegen BGROL-Nutzung.
    const bgrolFields = new Set([...namen(e2Heute), ...namen(e3Heute)]);
    let gruppen = 0;
    let gruppenLueckig = 0;
    const lueckigeFields = new Set<string>();
    const bgrolGruppen: Array<Record<string, unknown>> = [];
    for (const f of felder) {
      const m = new Map<number, Set<number>>();
      for (const k of f.kacheln) {
        if (k.param === 0 || k.state === 0) continue;
        if (!m.has(k.param)) m.set(k.param, new Set());
        m.get(k.param)!.add(k.state);
      }
      for (const [p, ss] of m) {
        gruppen++;
        const bits = [...ss]
          .map((x) => Math.log2(x))
          .filter((x) => Number.isInteger(x))
          .sort((a, b) => a - b);
        if (bits.length === 0) continue;
        const lueckig = bits[0] !== 0 || bits.length !== bits[bits.length - 1]! - bits[0]! + 1;
        if (lueckig) {
          gruppenLueckig++;
          lueckigeFields.add(f.name);
        }
        if (bgrolFields.has(f.name)) {
          bgrolGruppen.push({ field: f.name, param: p, Bits: bits.join(','), lueckig });
        }
      }
    }
    // Die Parameter, die BGROL/BGROL2 tatsächlich anspricht.
    const angesprochen: Array<Record<string, unknown>> = [];
    for (const { f, pos } of [...e2Heute, ...e3Heute]) {
      const param = f.code[pos + 2]!;
      const zust = new Set<number>();
      for (const k of f.kacheln) if (k.param === param) zust.add(k.state);
      angesprochen.push({
        stelle: `${f.name}@${pos}`,
        op: MAKOU_NAME[f.code[pos]!],
        Bankbyte: hex(f.code[pos + 1]!),
        param,
        'Zustände der Gruppe': [...zust].sort((a, b) => a - b).join(',') || '(keine Kachelgruppe)',
      });
    }
    const entscheidbar = angesprochen.some((a) => {
      const g = bgrolGruppen.find((x) => `${x['field']}` === `${a['stelle']}`.split('@')[0] && x['param'] === a['param']);
      return g?.['lueckig'] === true;
    });

    // ── E ── Breite des Zustandsraums.
    const kachelZustaende = new Map<number, number>();
    const opZustaende = new Map<number, number>();
    for (const f of felder) {
      for (const k of f.kacheln) kachelZustaende.set(k.state, (kachelZustaende.get(k.state) ?? 0) + 1);
      for (const s of f.spans) {
        if (s.end <= s.start) continue;
        for (const pc of grenzen(f.code, s, ist)) {
          const op = f.code[pc]!;
          if ((op === 0xe0 || op === 0xe1) && f.code[pc + 1] === 0) {
            const st = f.code[pc + 3]!;
            opZustaende.set(st, (opZustaende.get(st) ?? 0) + 1);
          }
        }
      }
    }
    const opMax = Math.max(...opZustaende.keys());
    const opN = [...opZustaende.values()].reduce((a, b) => a + b, 0);

    // ── Sanity 1 ── BGON-Eichung: Trifft BGON@+2 die BGON/BGOFF-Parametermenge
    // des eigenen Fields? Das MUSS es, per Konstruktion — die Zusicherung ist
    // der Selbsttest der Messanlage, nicht ihr Ergebnis.
    let eichTreffer = 0;
    let eichGesamt = 0;
    for (const f of felder) {
      const menge = new Set<number>();
      for (const s of f.spans) {
        if (s.end <= s.start) continue;
        for (const pc of grenzen(f.code, s, ist)) {
          const op = f.code[pc]!;
          if ((op === 0xe0 || op === 0xe1) && f.code[pc + 1] === 0) menge.add(f.code[pc + 2]!);
        }
      }
      for (const s of f.spans) {
        if (s.end <= s.start) continue;
        for (const pc of grenzen(f.code, s, ist)) {
          if (f.code[pc] !== 0xe0 || f.code[pc + 1] !== 0) continue;
          eichGesamt++;
          if (menge.has(f.code[pc + 2]!)) eichTreffer++;
        }
      }
    }

    // ── Sanity 2 ── Trennen sich die Verteilungen? Anteil häufiger Opcodes an
    // echten Instruktionsanfängen (oben) gegen Operandenbytes (unten).
    const haeufigkeit = new Map<number, number>();
    let anfaengeN = 0;
    const operandBytes: number[] = [];
    for (const f of felder) {
      for (const s of f.spans) {
        if (s.end <= s.start) continue;
        const g = grenzen(f.code, s, ist);
        const gset = new Set(g);
        for (const p of g) {
          haeufigkeit.set(f.code[p]!, (haeufigkeit.get(f.code[p]!) ?? 0) + 1);
          anfaengeN++;
        }
        for (let i = s.start; i < s.end; i++) if (!gset.has(i)) operandBytes.push(f.code[i]!);
      }
    }
    // Kleinste Opcode-Menge, die 90 % aller echten Instruktionsanfänge deckt.
    const haeufige = new Set<number>();
    let kumuliert = 0;
    for (const [op, n] of [...haeufigkeit.entries()].sort((a, b) => b[1] - a[1])) {
      if (kumuliert / anfaengeN >= 0.9) break;
      haeufige.add(op);
      kumuliert += n;
    }
    const niveauOben = kumuliert / Math.max(1, anfaengeN);
    const niveauUnten = operandBytes.filter((b) => haeufige.has(b)).length / Math.max(1, operandBytes.length);

    console.log(
      'Belegkette BGROL:',
      JSON.stringify(
        {
          Fields: felder.length,
          '=== A — kostenfreies Referenzbündel ===': '',
          'Abschluss VOR dem Bündel': basis,
          'Abschluss HEUTE (Bündel angewandt)': heute,
          'davon isoliert bitgleich': `${bitgleich} von ${VORHER.length}`,
          'davon isoliert schlechter': schlechter,
          Einzelwirkung: einzeln,
          '=== B — Phantomrate 0xE2 ===': '',
          'Fundstellen VOR dem Bündel': `${e2Vorher.length} in ${namen(e2Vorher).length} Fields: ${namen(e2Vorher).join(', ')}`,
          'Fundstellen HEUTE': `${e2Heute.length} in ${namen(e2Heute).length} Fields: ${namen(e2Heute).join(', ')}`,
          'Fundstellen 0xE3 HEUTE': `${e3Heute.length} in ${namen(e3Heute).length} Fields: ${namen(e3Heute).join(', ')}`,
          '=== C — hyou4 [2137, 2213) ===': '',
          Rohbytes: span
            ? [...hyou4!.code.slice(span.start, span.end)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
            : '(Spanne nicht gefunden)',
          'Lesart HEUTE (0xE2 = 2)': span ? disasm(hyou4!.code, span, ist) : [],
          'Lesart ALT (0xE2 = 1)': span ? disasm(hyou4!.code, span, alteTabelle) : [],
          Rollblöcke: `${rollen.length} (0xE2: ${rollen.filter((p) => hyou4!.code[p] === 0xe2).length}, 0xE3: ${rollen.filter((p) => hyou4!.code[p] === 0xe3).length})`,
          'erstes RET im Schleifenrumpf ab 2145 — NEU': retNeu,
          'erstes RET im Schleifenrumpf ab 2145 — ALT': retAlt,
          '=== D — Semantikfrage (a) Rotation gegen (b) nächster vorkommender Zustand ===': '',
          'Kachelgruppen gesamt': gruppen,
          'davon mit Bitlücke oder ohne Bit 0': `${gruppenLueckig} in ${lueckigeFields.size} Fields`,
          'Gruppen der BGROL-Fields': bgrolGruppen,
          'von BGROL/BGROL2 angesprochene Parameter': angesprochen,
          'Frage an diesem Bestand entscheidbar': entscheidbar,
          '=== E — Breite des Zustandsraums ===': '',
          Kachelzustände: Object.fromEntries([...kachelZustaende].sort((a, b) => a[0] - b[0])),
          'BGON/BGOFF-Zustandsoperand (Literal)': Object.fromEntries([...opZustaende].sort((a, b) => a[0] - b[0])),
          '=== Sanity ===': '',
          'BGON-Eichung (tautologisch, muss > 90 % sein)': `${((eichTreffer / eichGesamt) * 100).toFixed(1)}% (${eichTreffer}/${eichGesamt})`,
          'Trennung der Verteilungen': `${haeufige.size} Opcodes decken oben ${(niveauOben * 100).toFixed(1)}%, unten (Operandenbytes) ${(niveauUnten * 100).toFixed(1)}%`,
        },
        null,
        1,
      ),
    );

    expect(felder.length).toBeGreaterThan(500);

    // ── A: Das Bündel darf den Abschluss nicht verschlechtern.
    expect(heute.zu).toBeGreaterThanOrEqual(basis.zu);
    expect(heute.unb).toBeLessThanOrEqual(basis.unb);
    expect(schlechter).toEqual([]);
    // Die beiden namentlich geprüften Einzelfälle sind bitgleich.
    for (const op of [0x42, 0xce]) {
      const t = vorher.slice();
      t[op] = ist[op]!;
      expect(abschluss(felder, t)).toEqual(basis);
    }

    // ── B: Das Bündel senkt die Phantomrate.
    expect(e2Heute.length).toBeLessThan(e2Vorher.length);

    // ── C: Die Abnahme. Neun byteidentisch gebaute Rollblöcke, alle mit
    // Operanden (00, 01) — das ist die Gleichheit der beiden Lesarten.
    expect(rollen).toHaveLength(9);
    for (const p of rollen) {
      expect([hyou4!.code[p + 1], hyou4!.code[p + 2]]).toEqual([0x00, 0x01]);
    }
    // Unter der neuen Länge schließt der Schleifenrumpf hinter dem JMPB;
    // unter der alten stirbt er im ersten Durchlauf.
    expect(retNeu).toBe(2212);
    expect(retAlt).toBe(2161);

    // ── E: Der Zustandsraum ist genau ein Byte breit.
    expect(opMax).toBeLessThanOrEqual(7);
    expect(opN).toBeGreaterThan(1000);

    // ── Sanity (aus der abgelösten Nachlese übernommen).
    expect(eichTreffer / eichGesamt).toBeGreaterThan(0.9);
    expect(niveauOben).toBeGreaterThan(niveauUnten + 0.2);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
