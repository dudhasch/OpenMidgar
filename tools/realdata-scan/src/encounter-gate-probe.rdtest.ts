import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, ENC_SECTION_LEN, type FieldBundle } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { FieldSession, type FieldInput } from '@webmidgar/field-runtime';
import { NodeDirectorySource } from './node-source.js';

/**
 * F14-Probe — **Wer schaltet die Zufallskämpfe eines Fields scharf?**
 *
 * Befund aus der Demo (F14): md1stin (Bahnhofsvorplatz, im Original
 * kampffrei) feuert Encounter — die Sektion-7-Tabelle enthält dort also IDs.
 * O3b hat bereits belegt: `enabled == 1 ⇔ Tabelle belegt` (1404/1404). Das
 * Enable-Byte KANN darum nicht das Gating sein, das Städte von Dungeons
 * trennt, WENN Stadtfields belegte Tabellen tragen.
 *
 * Kandidaten (vor der Messung ausgesprochen):
 *  (a) `enabled`-Byte je Tabelle;
 *  (b) `rate == 0` als Deaktivierung;
 *  (c) kein Daten-Gate in Sektion 7 — der Schalter ist das Skript
 *      (BTLON, 0x71), und sein Zustand überdauert den Field-Wechsel.
 *
 * Gütefunktion: harte Referenzlisten. Kampffreie Anfangs-Fields (md1stin,
 * md1_1, md8_1) müssen „aus", Reaktor-1-Innenräume (nmkin_1..5, elevtr1)
 * „an" klassifiziert werden — mit der Einschränkung, dass die Reaktor-Fields
 * ihre Kämpfe im Original erst in der Fluchtphase zeigen.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten, Wertebereiche.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const TABLE_LEN = 24;
const OP_BTLON = 0x71;
const u16 = (d: Uint8Array, o: number): number => d[o]! | (d[o + 1]! << 8);

interface BtlonFund {
  /** Byteposition in Sektion 1 (sektionsrelativ). */
  pos: number;
  operand: number;
  /** Entität/Slot, deren Entry-Span die Position enthält. */
  wo: string[];
}

interface FieldSicht {
  field: string;
  bundle: FieldBundle;
  /** Je Tabelle: enabled/rate/Belegung. */
  tables: { enabled: number; rate: number; nStd: number; ids: number[] }[];
  btlon: BtlonFund[];
}

/** Ordnet eine Bytecode-Position den Entry-Slots zu, deren Span sie enthält. */
function attribuiere(bundle: FieldBundle, pos: number): string[] {
  const script = bundle.script;
  if (!script) return [];
  const out: string[] = [];
  for (const [e, ent] of script.entities.entries()) {
    for (let s = 0; s < ent.entryPoints.length; s++) {
      const start = ent.entryPoints[s];
      if (start === null || start === undefined) continue;
      // Wiederholte Entry-Points sind der Sentinel für ungenutzte Slots.
      if (s > 0 && ent.entryPoints[s - 1] === start) continue;
      let end = script.stringTableOffset;
      for (const other of script.entities) {
        for (const ep of other.entryPoints) {
          if (ep !== null && ep !== undefined && ep > start && ep < end) end = ep;
        }
      }
      if (pos >= start && pos < end) out.push(`${ent.name || `#${e}`}/slot${s}`);
    }
  }
  return out;
}

async function ladeSicht(): Promise<{ sichten: FieldSicht[]; dir: NodeDirectorySource }> {
  const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
  const index = new IndexService();
  await index.openSource(dir, { deep: false });
  const len = new Array<number>(256).fill(-1);
  for (const [op, l] of Object.entries(IMPL_OPERAND_LEN)) len[Number(op)] = l;
  for (const [op, l] of Object.entries(SKIP_OPERAND_LEN)) len[Number(op)] = l;

  const sichten: FieldSicht[] = [];
  for (const entry of index.listEntries('flevel')) {
    if (entry.name.includes('.')) continue;
    let parsed;
    try {
      parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
    } catch {
      continue;
    }
    const b = parsed.bundle;
    const sec = b?.rawSections[7];
    if (!b || !sec || sec.length !== ENC_SECTION_LEN) continue;

    const tables = [0, 1].map((t) => {
      const d = sec.subarray(t * TABLE_LEN, (t + 1) * TABLE_LEN);
      const ids: number[] = [];
      let nStd = 0;
      for (let i = 0; i < 6; i++) {
        const raw = u16(d, 2 + i * 2);
        if (raw === 0) continue;
        nStd++;
        ids.push(raw & 0x03ff);
      }
      return { enabled: d[0]!, rate: d[1]!, nStd, ids };
    });

    // BTLON-Vorkommen samt Operand über die Skriptspannen (gleiches
    // Dekodierverfahren wie die O3b-Umschalter-Suche).
    const btlon: BtlonFund[] = [];
    const code = b.rawSections[1];
    if (code && b.script) {
      for (const span of b.script.spans) {
        let pc = span.start;
        let guard = 0;
        while (pc < span.end && ++guard < 100_000) {
          const op = code[pc]!;
          if (op === OP_KAWAI) {
            const total = code[pc + 1];
            if (total === undefined || total < 2) break;
            pc += total;
            continue;
          }
          const l = len[op] ?? -1;
          if (l < 0 || pc + 1 + l > code.length) break;
          if (op === OP_BTLON) btlon.push({ pos: pc, operand: code[pc + 1]!, wo: attribuiere(b, pc) });
          pc += 1 + l;
        }
      }
    }
    sichten.push({ field: entry.name, bundle: b, tables, btlon });
  }
  return { sichten, dir };
}

const REF_AUS = ['md1stin', 'md1_1', 'md8_1'];
const REF_AN = ['nmkin_1', 'nmkin_2', 'nmkin_3', 'nmkin_4', 'nmkin_5', 'elevtr1'];

/** Konstante Bewegung — jede Eingabe zählt als bewegter Takt, solange frei. */
function laufInputs(ticks: number): FieldInput[] {
  const out: FieldInput[] = [];
  for (let i = 0; i < ticks; i++) {
    // Richtung wechselt blockweise, damit die Figur nicht dauerhaft an einer
    // Wand steht (Bewegung im Mesh ist Voraussetzung für „bewegte Takte").
    const phase = Math.floor(i / 40) % 4;
    out.push({
      moveX: phase === 0 ? 1 : phase === 2 ? -1 : 0,
      moveY: phase === 1 ? 1 : phase === 3 ? -1 : 0,
      confirm: false,
      cancel: false,
    });
  }
  return out;
}

describe.skipIf(!available)('F14: Gating der Zufallskämpfe', () => {
  it('legt enabled/rate/BTLON neben die Referenzlisten', async () => {
    const { sichten, dir } = await ladeSicht();
    const byName = new Map(sichten.map((s) => [s.field, s]));

    // --- Referenzfields im Detail.
    const detail = (name: string): unknown => {
      const s = byName.get(name);
      if (!s) return `${name}: FEHLT`;
      return {
        field: name,
        tabellen: s.tables.map((t) => `enabled=${t.enabled} rate=${t.rate} std=${t.nStd} ids=[${t.ids.join(',')}]`),
        btlon: s.btlon.map((f) => `op=${f.operand} @${f.pos} in ${f.wo.join('+') || '?'}`),
      };
    };

    // --- Bestandsweite Kreuztabelle: enabled × rate.
    let belegtRate0 = 0;
    let belegtRatePos = 0;
    let genulltRatePos = 0;
    const rateWerteBelegt = new Map<number, number>();
    for (const s of sichten) {
      for (const t of s.tables) {
        if (t.enabled === 1) {
          rateWerteBelegt.set(t.rate, (rateWerteBelegt.get(t.rate) ?? 0) + 1);
          if (t.rate === 0) belegtRate0++;
          else belegtRatePos++;
        } else if (t.rate !== 0) {
          genulltRatePos++;
        }
      }
    }

    // --- Gate-Kandidaten als Klassifikatoren „Field hat Zufallskämpfe".
    const gateEnabled = (s: FieldSicht): boolean => s.tables.some((t) => t.enabled === 1);
    const gateRate = (s: FieldSicht): boolean => s.tables.some((t) => t.enabled === 1 && t.rate > 0);
    const trefferquote = (gate: (s: FieldSicht) => boolean): string => {
      const an = REF_AN.filter((n) => byName.has(n) && gate(byName.get(n)!)).length;
      const aus = REF_AUS.filter((n) => byName.has(n) && !gate(byName.get(n)!)).length;
      return `an ${an}/${REF_AN.length}, aus ${aus}/${REF_AUS.length}`;
    };

    // --- BTLON-Landkarte: alle Fields mit BTLON(0) („an") und die Verteilung
    //     der Operanden über Fields mit/ohne belegte Tabelle.
    const btlonAnFields: string[] = [];
    const btlonStat = { mitTabelle: new Map<number, number>(), ohneTabelle: new Map<number, number>() };
    for (const s of sichten) {
      if (s.btlon.some((f) => f.operand === 0)) btlonAnFields.push(`${s.field}${gateEnabled(s) ? '(T)' : ''}`);
      const ziel = gateEnabled(s) ? btlonStat.mitTabelle : btlonStat.ohneTabelle;
      for (const f of s.btlon) ziel.set(f.operand, (ziel.get(f.operand) ?? 0) + 1);
    }

    console.log(
      'F14 Gate-Probe:',
      JSON.stringify(
        {
          fields: sichten.length,
          referenzAus: REF_AUS.map(detail),
          referenzAn: REF_AN.map(detail),
          kreuztabelle: {
            'enabled=1 & rate==0': belegtRate0,
            'enabled=1 & rate>0': belegtRatePos,
            'enabled=0 & rate>0': genulltRatePos,
          },
          rateWerteBelegteTabellen: [...rateWerteBelegt.entries()].sort((a, b) => a[0] - b[0]),
          gateKandidaten: {
            '(a) enabled-Byte': trefferquote(gateEnabled),
            '(b) enabled && rate>0': trefferquote(gateRate),
          },
          btlonOperandVerteilung: {
            mitTabelle: [...btlonStat.mitTabelle.entries()].sort((a, b) => a[0] - b[0]),
            ohneTabelle: [...btlonStat.ohneTabelle.entries()].sort((a, b) => a[0] - b[0]),
          },
          'Fields mit BTLON(0), (T) = belegte Tabelle': btlonAnFields,
        },
        null,
        1,
      ),
    );

    expect(sichten.length).toBe(702);
    for (const n of [...REF_AUS, ...REF_AN]) expect(byName.has(n), n).toBe(true);
    // Sektion 7 selbst trägt KEIN weiteres Gate: enabled ⇔ belegt (O3b) und
    // rate > 0 in ausnahmslos allen belegten Tabellen.
    expect(belegtRate0).toBe(0);
    expect(genulltRatePos).toBe(0);

    await dir.closeAll();
  }, 900_000);

  it('Live-Sitzung: feuert md1stin, und greift BTLON?', async () => {
    const { sichten, dir } = await ladeSicht();
    const byName = new Map(sichten.map((s) => [s.field, s]));

    const lauf = (name: string, ticks = 2_000): unknown => {
      const s = byName.get(name);
      if (!s) return `${name}: FEHLT`;
      const session = new FieldSession(s.bundle, { seed: 7, dialogMode: 'auto' });
      let battles = 0;
      let ersterBattleTick: number | null = null;
      let disabledAb: number | null = null;
      for (const [i, input] of laufInputs(ticks).entries()) {
        const r = session.tick(input);
        for (const h of r.hostRequests) {
          if (h.kind === 'battle') {
            battles++;
            ersterBattleTick ??= i;
          }
        }
        if (disabledAb === null && session.runtime?.state.randomEncountersDisabled) disabledAb = i;
      }
      return {
        field: name,
        ticks,
        battleRequests: battles,
        ersterBattleTick,
        randomEncountersDisabledAbTick: disabledAb,
      };
    };

    const ergebnis = {
      md1stin: lauf('md1stin'),
      md1_1: lauf('md1_1'),
      nmkin_2: lauf('nmkin_2'),
    };
    console.log('F14 Live-Sitzung:', JSON.stringify(ergebnis, null, 1));

    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
