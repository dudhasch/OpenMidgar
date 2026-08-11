import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, type Walkmesh } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * **Struktursonde für XYI/XYZ und BGROL** — der Beleg, den der Spannen-
 * Abschluss nicht liefern kann.
 *
 * Vorgeschichte: Der Spannen-Abschluss ist bei diesen Opcodes blind, weil sich
 * der Instruktionsstrom nach einer falschen Länge binnen weniger Instruktionen
 * selbst resynchronisiert (gemessen: 32 von 32 Spannen schließen mit `XYI`-
 * Länge 2 UND mit Länge 8). Eine Gütefunktion, die zwischen richtig und falsch
 * nicht unterscheidet, belegt nichts.
 *
 * Diese Sonde prüft stattdessen den **Inhalt** der Operanden gegen eine
 * unabhängige Sektion desselben Fields:
 *
 *  - `XYZI` (0xA5) ist die **Eichung**: Seine Aufteilung ist bekannt und
 *    implementiert. Was die Sonde dort misst, ist das Niveau „richtige
 *    Aufteilung". Ohne diese Eichung wäre jede Trefferquote bei XYI/XYZ eine
 *    Zahl ohne Maßstab.
 *  - `XYI` (0xA6) und `XYZ` (0xA7) werden mit derselben Sonde gemessen.
 *
 * **Kontrollen** (drei, alle nötig):
 *  1. *Versatz* — dieselben Bytes um ein Byte verschoben gelesen. Trifft das
 *     genauso gut, misst die Sonde nur „kleine Zahlen sind häufig".
 *  2. *Vertauscht* — die Werte gegen das Walkmesh eines **anderen** Fields
 *     geprüft. Trifft das genauso gut, ist die Prüfung feldunspezifisch und
 *     damit wertlos.
 *  3. *Nullwerte getrennt* — Operanden, die vollständig 0 sind, bestehen jeden
 *     Bereichstest trivial und werden separat ausgewiesen.
 *
 * Urheberrecht: nur Zähler und Quoten über die Daten des Nutzers.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

interface Feld {
  name: string;
  code: Uint8Array;
  spans: Array<{ start: number; end: number }>;
  walkmesh: Walkmesh | undefined;
  /** Alle `param`-Werte der Hintergrund-Tiles dieses Fields. */
  bgParams: Set<number>;
}

interface Grenzen {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  dreiecke: number;
}

function grenzenVon(w: Walkmesh | undefined): Grenzen | null {
  if (!w || w.triangles.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of w.triangles) {
    for (const v of t.vertices) {
      minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
      minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
    }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, dreiecke: w.triangleCount };
}

function tabelle(): number[] {
  const t = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) t[Number(op)] = len;
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) t[Number(op)] = len;
  return t;
}

/** Erste Fundstelle je Spanne — die einzige, die von der Länge unabhängig ist. */
function fundstellen(felder: Feld[], len: number[], op: number): Array<{ f: Feld; pos: number }> {
  const out: Array<{ f: Feld; pos: number }> = [];
  for (const f of felder) {
    for (const s of f.spans) {
      if (s.end <= s.start) continue;
      let pc = s.start;
      let guard = 0;
      while (pc < s.end && ++guard < 100_000) {
        if (f.code[pc] === op) { out.push({ f, pos: pc }); break; }
        const o = f.code[pc]!;
        const l = o === OP_KAWAI ? (f.code[pc + 1] ?? 2) - 1 : len[o]!;
        if (l < 0) break;
        pc += 1 + l;
      }
    }
  }
  return out;
}

const i16 = (c: Uint8Array, at: number): number => (((c[at]! | (c[at + 1]! << 8)) << 16) >> 16);
const u16 = (c: Uint8Array, at: number): number => c[at]! | (c[at + 1]! << 8);

interface Quote { treffer: number; gesamt: number; nullwerte: number }
const q = (x: Quote): string =>
  `${x.gesamt === 0 ? '—' : ((x.treffer / x.gesamt) * 100).toFixed(1) + '%'} (${x.treffer}/${x.gesamt}${x.nullwerte ? `, davon ${x.nullwerte} Nullwerte` : ''})`;

/**
 * Ein Wertfeld der Instruktion: wo es steht, welche Bank-Nibbleposition es
 * benutzt und wogegen es geprüft wird.
 *
 * `nibble` zählt über beide Bankbytes hinweg: 0 = hohes Nibble des ersten
 * Bankbytes, 1 = niedriges, 2 = hohes des zweiten, 3 = niedriges.
 */
interface Wertfeld {
  at: number;
  nibble: number;
  art: 'x' | 'y' | 'z' | 'tri';
}

/**
 * Prüft eine Operandenaufteilung. Zwei Prüfarten je Wertfeld:
 *
 *  - **Literal** (Bank-Nibble 0): Der Wert selbst muss in den Bereich passen,
 *    den das Walkmesh des Fields aufspannt (bzw. der Dreiecksindex existieren).
 *  - **Bankoperand** (Nibble ≠ 0): Dann steht dort keine Koordinate, sondern
 *    eine Bankadresse. Bänke sind 256 Byte groß — das hohe Byte muss also 0
 *    sein. Diese Signatur ist scharf: Trifft man die Aufteilung um ein Byte
 *    daneben, zerfällt sie sofort.
 *
 * Ohne die Bankvariante wäre die Sonde bei XYI blind: von 32 Fundstellen
 * tragen 31 Bankoperanden.
 */
function pruefeAufteilung(
  stellen: Array<{ f: Feld; pos: number }>,
  gr: Map<string, Grenzen>,
  felder: Wertfeld[],
  opt: { versatz: number; fremd: boolean },
  fremdListe: string[],
): Quote {
  const out: Quote = { treffer: 0, gesamt: 0, nullwerte: 0 };
  let i = 0;
  for (const { f, pos } of stellen) {
    const eigen = gr.get(f.name);
    const g = opt.fremd ? gr.get(fremdListe[i++ % fremdListe.length]!) : eigen;
    if (!eigen || !g) continue;
    const c = f.code;
    const p = pos + opt.versatz;
    const maxAt = Math.max(...felder.map((w) => w.at));
    if (p + maxAt + 1 >= c.length) continue;
    out.gesamt++;
    const banks = [c[p + 1]!, c[p + 2]!];
    let alleNull = true;
    let ok = true;
    for (const w of felder) {
      const nib = w.nibble < 2 ? (banks[0]! >> (w.nibble === 0 ? 4 : 0)) & 0xf : (banks[1]! >> (w.nibble === 2 ? 4 : 0)) & 0xf;
      const roh = u16(c, p + w.at);
      if (roh !== 0) alleNull = false;
      if (nib !== 0) {
        // Bankoperand: Adresse innerhalb einer 256-B-Bank.
        if (roh > 0xff) { ok = false; break; }
        continue;
      }
      // Literal: gegen die Geometrie prüfen.
      const wert = w.art === 'tri' ? roh : i16(c, p + w.at);
      // Toleranz: 12,5 % der Ausdehnung — Skripte setzen Figuren gelegentlich
      // knapp außerhalb der begehbaren Fläche (Türen, Kanten).
      if (w.art === 'x') {
        const tol = (g.maxX - g.minX) * 0.125 + 1;
        if (wert < g.minX - tol || wert > g.maxX + tol) { ok = false; break; }
      } else if (w.art === 'y') {
        const tol = (g.maxY - g.minY) * 0.125 + 1;
        if (wert < g.minY - tol || wert > g.maxY + tol) { ok = false; break; }
      } else if (w.art === 'z') {
        const tol = (g.maxZ - g.minZ) * 0.25 + 64;
        if (wert < g.minZ - tol || wert > g.maxZ + tol) { ok = false; break; }
      } else if (wert >= g.dreiecke) { ok = false; break; }
    }
    if (alleNull) out.nullwerte++;
    if (ok) out.treffer++;
  }
  return out;
}

describe.skipIf(!available)('Realdaten: Operandenaufteilung von XYI/XYZ und BGROL', () => {
  it('misst die Aufteilung gegen Walkmesh und Hintergrundparameter', { timeout: 1_800_000 }, async () => {
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
      const bgParams = new Set<number>();
      for (const layer of b.background?.layers ?? []) {
        for (const t of layer.tiles) bgParams.add(t.param);
      }
      felder.push({
        name: entry.name,
        code: b.rawSections[1]!,
        spans: b.script.spans.map((s) => ({ ...s })),
        walkmesh: b.walkmesh,
        bgParams,
      });
    }
    await dir.closeAll();

    const len = tabelle();
    const gr = new Map<string, Grenzen>();
    for (const f of felder) {
      const g = grenzenVon(f.walkmesh);
      if (g) gr.set(f.name, g);
    }
    const fremdListe = [...gr.keys()];

    // --- Eichung: XYZI (0xA5), bekannte Aufteilung, Operandenlänge 10 ------
    const XYZI: Wertfeld[] = [
      { at: 3, nibble: 0, art: 'x' },
      { at: 5, nibble: 1, art: 'y' },
      { at: 7, nibble: 2, art: 'z' },
      { at: 9, nibble: 3, art: 'tri' },
    ];
    const a5 = fundstellen(felder, len, 0xa5);
    const a5Voll = pruefeAufteilung(a5, gr, XYZI, { versatz: 0, fremd: false }, fremdListe);
    const a5Versatz = pruefeAufteilung(a5, gr, XYZI, { versatz: 1, fremd: false }, fremdListe);
    const a5Fremd = pruefeAufteilung(a5, gr, XYZI, { versatz: 0, fremd: true }, fremdListe);

    // --- XYI (0xA6): Hypothese banks,banks,x,y,tri (Operandenlänge 8) ------
    const XYI: Wertfeld[] = [
      { at: 3, nibble: 0, art: 'x' },
      { at: 5, nibble: 1, art: 'y' },
      { at: 7, nibble: 2, art: 'tri' },
    ];
    const a6 = fundstellen(felder, len, 0xa6);
    const a6Voll = pruefeAufteilung(a6, gr, XYI, { versatz: 0, fremd: false }, fremdListe);
    const a6NurXY = pruefeAufteilung(a6, gr, XYI.slice(0, 2), { versatz: 0, fremd: false }, fremdListe);
    const a6Versatz = pruefeAufteilung(a6, gr, XYI, { versatz: 1, fremd: false }, fremdListe);
    const a6Fremd = pruefeAufteilung(a6, gr, XYI, { versatz: 0, fremd: true }, fremdListe);

    // --- XYZ (0xA7): Hypothese banks,banks,x,y,z (Operandenlänge 8) --------
    // Die Grenzplausibilität ließ zwischen Länge 4 und 8 offen. Der Unterschied
    // ist genau das dritte Wertfeld: Bei Länge 4 gehörten die Bytes @7/@8 schon
    // zur nächsten Instruktion und stünden nur zufällig im Höhenbereich bzw.
    // trügen zufällig ein hohes Byte 0.
    const XYZ: Wertfeld[] = [
      { at: 3, nibble: 0, art: 'x' },
      { at: 5, nibble: 1, art: 'y' },
      { at: 7, nibble: 2, art: 'z' },
    ];
    const a7 = fundstellen(felder, len, 0xa7);
    const a7NurXY = pruefeAufteilung(a7, gr, XYZ.slice(0, 2), { versatz: 0, fremd: false }, fremdListe);
    const a7MitZ = pruefeAufteilung(a7, gr, XYZ, { versatz: 0, fremd: false }, fremdListe);
    const a7Versatz = pruefeAufteilung(a7, gr, XYZ, { versatz: 1, fremd: false }, fremdListe);
    const a7Fremd = pruefeAufteilung(a7, gr, XYZ, { versatz: 0, fremd: true }, fremdListe);
    // Kontrolle für die Länge-4-Hypothese: Läge dort schon die nächste
    // Instruktion, wäre ein „z" an @9 nicht schlechter als eines an @7.
    const a7Z9 = pruefeAufteilung(
      a7, gr, [XYZ[0]!, XYZ[1]!, { at: 9, nibble: 2, art: 'z' }], { versatz: 0, fremd: false }, fremdListe,
    );

    // --- BGROL (0xE2/0xE3): trifft das Parameterbyte einen echten Parameter?
    const bgrol = (op: number, at: number, fremd: boolean): Quote => {
      const out: Quote = { treffer: 0, gesamt: 0, nullwerte: 0 };
      const stellen = fundstellen(felder, len, op);
      let i = 0;
      for (const { f, pos } of stellen) {
        const menge = fremd ? felder[i++ % felder.length]!.bgParams : f.bgParams;
        if (f.bgParams.size === 0) continue;
        const wert = f.code[pos + at];
        if (wert === undefined) continue;
        out.gesamt++;
        if (wert === 0) out.nullwerte++;
        if (menge.has(wert)) out.treffer++;
      }
      return out;
    };
    // Schärfere, skriptinterne Prüfung: BGROL rotiert eine Zustandsmaske, die
    // dasselbe Field auch mit BGON/BGOFF/BGCLR anfasst. Sein Parameterbyte muss
    // also unter den Parametern dieser Opcodes DESSELBEN Fields vorkommen. Das
    // ist schärfer als der Abgleich gegen alle Tile-Parameter, weil ein Field
    // typisch 1–3 geschaltete Parameter hat, aber deutlich mehr Tile-Parameter.
    const bgonParams = new Map<string, Set<number>>();
    for (const f of felder) {
      const menge = new Set<number>();
      for (const op of [0xe0, 0xe1, 0xe4]) {
        for (const s of f.spans) {
          if (s.end <= s.start) continue;
          let pc = s.start;
          let guard = 0;
          while (pc < s.end && ++guard < 100_000) {
            if (f.code[pc] === op && f.code[pc + 1] === 0) menge.add(f.code[pc + 2]!);
            const o = f.code[pc]!;
            const l = o === OP_KAWAI ? (f.code[pc + 1] ?? 2) - 1 : len[o]!;
            if (l < 0) break;
            pc += 1 + l;
          }
        }
      }
      bgonParams.set(f.name, menge);
    }
    const gegenBgon = (op: number, at: number, fremd: boolean): Quote => {
      const out: Quote = { treffer: 0, gesamt: 0, nullwerte: 0 };
      const stellen = fundstellen(felder, len, op);
      let i = 0;
      for (const { f, pos } of stellen) {
        const eigen = bgonParams.get(f.name)!;
        if (eigen.size === 0) continue;
        const menge = fremd ? [...bgonParams.values()].filter((m) => m.size > 0)[i++ % [...bgonParams.values()].filter((m) => m.size > 0).length]! : eigen;
        const wert = f.code[pos + at];
        if (wert === undefined) continue;
        out.gesamt++;
        if (wert === 0) out.nullwerte++;
        if (menge.has(wert)) out.treffer++;
      }
      return out;
    };
    const e2Bgon2 = gegenBgon(0xe2, 2, false);
    const e2Bgon1 = gegenBgon(0xe2, 1, false);
    const e2BgonFremd = gegenBgon(0xe2, 2, true);
    const e3Bgon2 = gegenBgon(0xe3, 2, false);

    // Vergleichsniveau: BGON (0xE0) ist implementiert und belegt — dort steht
    // der Parameter an derselben Stelle (+2, hinter dem Bankbyte).
    const e0 = bgrol(0xe0, 2, false);
    const e0Fremd = bgrol(0xe0, 2, true);
    const e0Versatz = bgrol(0xe0, 1, false);
    const e2At2 = bgrol(0xe2, 2, false);
    const e2At1 = bgrol(0xe2, 1, false);
    const e2Fremd = bgrol(0xe2, 2, true);
    const e3At2 = bgrol(0xe3, 2, false);
    const e3At1 = bgrol(0xe3, 1, false);

    // --- F35-1 (a): Wie oft trägt BGON/BGOFF/BGCLR überhaupt ein Bankbyte? --
    // Die Aufteilung `banks>>4` = Parameter, `banks&0xf` = Zustand wirkt NUR
    // bei Bankoperanden. Ist das Bankbyte praktisch immer 0, kann eine falsche
    // Aufteilung die F35-Maske gar nicht erklären — dann liegt die Ursache
    // woanders, und genau das muss die Probe zeigen, bevor jemand am Splitcode
    // dreht.
    const bankByte: Record<string, Record<number, number>> = {};
    for (const op of [0xe0, 0xe1, 0xe4]) {
      const zaehler: Record<number, number> = {};
      for (const f of felder) {
        for (const s of f.spans) {
          if (s.end <= s.start) continue;
          let pc = s.start;
          let guard = 0;
          while (pc < s.end && ++guard < 100_000) {
            if (f.code[pc] === op) zaehler[f.code[pc + 1]!] = (zaehler[f.code[pc + 1]!] ?? 0) + 1;
            const o = f.code[pc]!;
            const l = o === OP_KAWAI ? (f.code[pc + 1] ?? 2) - 1 : len[o]!;
            if (l < 0) break;
            pc += 1 + l;
          }
        }
      }
      bankByte[`0x${op.toString(16)}`] = zaehler;
    }

    console.log(
      'Operandenaufteilung (Struktursonde):',
      JSON.stringify(
        {
          Fields: felder.length,
          'mit Walkmesh': gr.size,
          '— EICHUNG: XYZI 0xA5 (bekannte Aufteilung, Länge 10) —': '',
          'A5 x,y in Grenzen + z + Dreiecksindex gültig': q(a5Voll),
          'A5 Kontrolle Versatz +1': q(a5Versatz),
          'A5 Kontrolle fremdes Walkmesh': q(a5Fremd),
          '— XYI 0xA6, Hypothese banks,banks,x,y,tri (Länge 8) —': '',
          'A6 nur x,y in Grenzen': q(a6NurXY),
          'A6 x,y + Dreiecksindex@7 gültig': q(a6Voll),
          'A6 Kontrolle Versatz +1': q(a6Versatz),
          'A6 Kontrolle fremdes Walkmesh': q(a6Fremd),
          '— XYZ 0xA7, Hypothese banks,banks,x,y,z (Länge 8) —': '',
          'A7 nur x,y in Grenzen': q(a7NurXY),
          'A7 x,y + z@7 in Höhenbereich': q(a7MitZ),
          'A7 Kontrolle z an @9 statt @7': q(a7Z9),
          'A7 Kontrolle Versatz +1': q(a7Versatz),
          'A7 Kontrolle fremdes Walkmesh': q(a7Fremd),
          '— BGROL: Parameterbyte gegen echte Hintergrundparameter —': '',
          'E0 BGON (belegt) Parameter@+2': q(e0),
          'E0 Kontrolle fremdes Field': q(e0Fremd),
          'E0 Kontrolle Versatz (@+1)': q(e0Versatz),
          'E2 BGROL Parameter@+2 (Länge 2)': q(e2At2),
          'E2 BGROL Parameter@+1 (Länge 1)': q(e2At1),
          'E2 Kontrolle fremdes Field': q(e2Fremd),
          'E3 BGROL2 Parameter@+2': q(e3At2),
          'E3 BGROL2 Parameter@+1': q(e3At1),
          '— BGROL gegen die BGON/BGOFF-Parameter DESSELBEN Fields —': '',
          'E2 BGROL Parameter@+2 vs. BGON-Parameter des Fields': q(e2Bgon2),
          'E2 BGROL Parameter@+1 vs. BGON-Parameter des Fields': q(e2Bgon1),
          'E2 Kontrolle: BGON-Parameter eines FREMDEN Fields': q(e2BgonFremd),
          'E3 BGROL2 Parameter@+2 vs. BGON-Parameter des Fields': q(e3Bgon2),
          '— F35-1(a): Bankbyte-Verteilung von BGON/BGOFF/BGCLR —': '',
          Bankbytes: Object.fromEntries(
            Object.entries(bankByte).map(([k, v]) => [
              k,
              Object.entries(v)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([wert, n]) => `0x${Number(wert).toString(16)}:${n}`)
                .join(' '),
            ]),
          ),
        },
        null,
        1,
      ),
    );

    expect(felder.length).toBeGreaterThan(500);
    // Die Eichung MUSS tragen — sonst misst die Sonde nichts und alle
    // nachfolgenden Zahlen sind bedeutungslos.
    expect(a5Voll.treffer / a5Voll.gesamt).toBeGreaterThan(0.8);
    expect(a5Voll.treffer / a5Voll.gesamt).toBeGreaterThan(a5Versatz.treffer / Math.max(1, a5Versatz.gesamt));
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
