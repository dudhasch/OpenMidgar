import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, parseEncounterSection, ENC_SECTION_LEN, ENC_PROB_SUM } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * O3b-Probe I — **Layout und Accounting** der Encounter-Tabelle (Sektion 7).
 *
 * Ausgesprochene Suchmengen-Annahme (Methodikpflicht seit O3): Geprüft wird
 * die Annahme, dass die **Zufalls**kämpfe eines Fields vollständig in
 * Sektion 7 **dieses** Fields stehen und dort nichts anderes steht. Die
 * Annahme ist prüfbar, weil sie eine harte Vorhersage macht — das Layout muss
 * die Sektion **byteexakt aufbrauchen**, über alle 702 Fields. Der Ort der
 * *Formationen* (scene.bin) ist Gegenstand der zweiten Probe.
 *
 * Hypothese (Makou Reactor als HYPOTHESENGEBER, nicht als Autorität):
 * zwei Tabellen à 24 B — `u8 enabled · u8 rate · u16 standard[6] ·
 * u16 special[4] · u16 padding`, im Wort Wahrscheinlichkeit in den oberen
 * 6 Bit, Kampf-ID in den unteren 10.
 *
 * Der Wahrheitstest ist NICHT „die IDs sehen plausibel aus" (das bestand die
 * S17-Vorprobe schon, ohne irgendetwas zu belegen), sondern die
 * **Summenprobe**: Sind die oberen 6 Bit der sechs Standardwörter
 * Wahrscheinlichkeitsanteile, dann MUSS ihre Summe in jeder belegten Tabelle
 * denselben Wert haben. Diese Vorhersage fällt vor der Messung und kann von
 * einer falschen Auslegung nicht zufällig erfüllt werden.
 *
 * Kontrollen: Bit-Splits 8/9/11/12 statt 10, u16-Basis um 1 und 3 Byte
 * verschoben, Big-Endian, und die Tabelle-1-Zweitmessung über ALLE Fields.
 *
 * Nullwert-Zweitrechnung: Fields ohne Zufallskämpfe tragen eine genullte
 * Tabelle und bestehen jeden Wertebereichstest trivial. Jede Quote wird
 * deshalb zusätzlich **ohne** die genullten Tabellen gerechnet und deren
 * Anzahl berichtet.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten, Wertebereiche.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const TABLE_LEN = 24;
const u16 = (d: Uint8Array, o: number): number => d[o]! | (d[o + 1]! << 8);

interface Roh {
  field: string;
  data: Uint8Array;
}

async function ladeSektion7(): Promise<{ rohe: Roh[]; dir: NodeDirectorySource }> {
  const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
  const index = new IndexService();
  await index.openSource(dir, { deep: false });
  const rohe: Roh[] = [];
  for (const entry of index.listEntries('flevel')) {
    if (entry.name.includes('.')) continue;
    let parsed;
    try {
      parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
    } catch {
      continue;
    }
    const sec = parsed.bundle?.rawSections[7];
    if (!sec) continue;
    rohe.push({ field: entry.name, data: sec.slice() });
  }
  return { rohe, dir };
}

describe.skipIf(!available)('O3b: Sektion 7 — Layout und Accounting', () => {
  it('braucht die Sektion byteexakt auf und hält die Summenprobe', async () => {
    const { rohe, dir } = await ladeSektion7();

    // --- Accounting I: Sektionsgröße.
    const groessen = new Map<number, number>();
    for (const r of rohe) groessen.set(r.data.length, (groessen.get(r.data.length) ?? 0) + 1);

    // --- Strukturkarte: Wertevielfalt je Byteposition (das Verfahren, das bei
    //     `audio.fmt` die Eintragsgröße freigelegt hat). Zweimal gerechnet:
    //     über alle Tabellen und ohne die genullten.
    const tabellen: { field: string; t: number; d: Uint8Array }[] = [];
    for (const r of rohe) {
      if (r.data.length !== ENC_SECTION_LEN) continue;
      for (const t of [0, 1]) tabellen.push({ field: r.field, t, d: r.data.subarray(t * TABLE_LEN, (t + 1) * TABLE_LEN) });
    }
    const genullt = tabellen.filter((x) => x.d.every((b) => b === 0));
    const belegt = tabellen.filter((x) => !x.d.every((b) => b === 0));
    const vielfalt = (menge: typeof tabellen): number[] => {
      const out: number[] = [];
      for (let p = 0; p < TABLE_LEN; p++) out.push(new Set(menge.map((x) => x.d[p]!)).size);
      return out;
    };

    // --- Accounting II: enabled ⇔ Tabelle belegt, Padding genullt.
    const enabledWerte = new Map<number, number>();
    let paddingNull = 0;
    for (const x of tabellen) {
      enabledWerte.set(x.d[0]!, (enabledWerte.get(x.d[0]!) ?? 0) + 1);
      if (u16(x.d, 22) === 0) paddingNull++;
    }
    const enabledKonsistent = tabellen.filter((x) => (x.d[0] === 1) === !x.d.every((b) => b === 0)).length;

    // --- Der eigentliche Wahrheitstest: Summe der oberen 6 Bit über std[0..5].
    const summeMit = (menge: typeof tabellen, shift: number, basis: number, be = false): Map<number, number> => {
      const m = new Map<number, number>();
      for (const x of menge) {
        let s = 0;
        for (let i = 0; i < 6; i++) {
          const raw = be ? (x.d[basis + i * 2]! << 8) | x.d[basis + i * 2 + 1]! : u16(x.d, basis + i * 2);
          s += raw >> shift;
        }
        m.set(s, (m.get(s) ?? 0) + 1);
      }
      return m;
    };
    const beste = (m: Map<number, number>): [number, number] =>
      [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];

    const kandidat = summeMit(belegt, 10, 2);
    const kontrollen: Record<string, string> = {};
    for (const sh of [8, 9, 11, 12]) {
      const [wert, n] = beste(summeMit(belegt, sh, 2));
      kontrollen[`Bit-Split >>${sh}`] = `häufigste Summe ${wert}: ${n}/${belegt.length} = ${((100 * n) / belegt.length).toFixed(1)}%`;
    }
    for (const basis of [1, 3]) {
      const m = summeMit(belegt, 10, basis);
      const [wert, n] = beste(m);
      kontrollen[`u16-Basis @${basis}`] = `${m.size} verschiedene Summen, häufigste ${wert}: ${n}/${belegt.length}`;
    }
    {
      const m = summeMit(belegt, 10, 2, true);
      const [wert, n] = beste(m);
      kontrollen['Big-Endian'] = `${m.size} verschiedene Summen, häufigste ${wert}: ${n}/${belegt.length}`;
    }
    // Nachbarrecord-Kontrolle: dieselbe Rechnung auf Tabelle 1 über ALLE
    // Fields, also inklusive der genullten — zeigt, dass die Regel
    // „Summe == 64 ODER Tabelle genullt" ausnahmslos gilt.
    const tab1Alle = summeMit(
      tabellen.filter((x) => x.t === 1),
      10,
      2,
    );

    // --- Aus der Summenregel ERZWUNGENE Zweitvorhersage: 6 Bit fassen
    //     höchstens 63, die Summe muss 64 sein — also kann keine belegte
    //     Tabelle mit einem einzigen Standardkampf auskommen. Diese Vorhersage
    //     folgt aus dem Layout und wurde vor der Messung ausgesprochen.
    const mindestensZwei = belegt.filter((x) => {
      let n = 0;
      for (let i = 0; i < 6; i++) if (u16(x.d, 2 + i * 2) >> 10 > 0) n++;
      return n >= 2;
    }).length;

    // --- Slots und IDs.
    const ids = new Set<number>();
    let slotsBelegt = 0;
    let idsUeber1023 = 0;
    let probNullMitId = 0;
    const rateWerte = new Map<number, number>();
    for (const x of belegt) {
      rateWerte.set(x.d[1]!, (rateWerte.get(x.d[1]!) ?? 0) + 1);
      for (let i = 0; i < 10; i++) {
        const raw = u16(x.d, 2 + i * 2);
        if (raw === 0) continue;
        slotsBelegt++;
        const id = raw & 0x03ff;
        if (id > 1023) idsUeber1023++;
        if (raw >> 10 === 0) probNullMitId++;
        ids.add(id);
      }
    }

    // --- Zweitimplementierung: der Parser des Pakets muss dieselbe Sicht
    //     liefern und darf über den Gesamtbestand keine Diagnose melden.
    let parserOk = 0;
    let parserDiagnosen = 0;
    let parserSlots = 0;
    for (const r of rohe) {
      const diag: import('@webmidgar/formats-field').FieldDiagnostic[] = [];
      const enc = parseEncounterSection(r.data, r.field, diag);
      if (enc) parserOk++;
      parserDiagnosen += diag.length;
      for (const t of enc?.tables ?? []) {
        if (!t.enabled) continue;
        parserSlots += [...t.standard, ...t.special].filter((s) => s.raw !== 0).length;
      }
    }

    console.log(
      'O3b Sektion 7 — Layout/Accounting:',
      JSON.stringify(
        {
          fields: rohe.length,
          sektionsgroessen: [...groessen.entries()],
          tabellen: tabellen.length,
          genullteTabellen: genullt.length,
          belegteTabellen: belegt.length,
          fieldsOhneZufallskampf: rohe.filter((r) => r.data.every((b) => b === 0)).length,
          enabledWerte: [...enabledWerte.entries()],
          'enabled==1 ⇔ Tabelle belegt': `${enabledKonsistent}/${tabellen.length}`,
          paddingGenullt: `${paddingNull}/${tabellen.length}`,
          bytevielfaltAlle: vielfalt(tabellen).join(' '),
          bytevielfaltNurBelegte: vielfalt(belegt).join(' '),
          summeStdKandidat: [...kandidat.entries()],
          kontrollen,
          'Tabelle 1 über alle Fields': [...tab1Alle.entries()],
          rateWerte: [...rateWerte.entries()].sort((a, b) => a[0] - b[0]),
          slotsBelegt,
          verschiedeneIds: ids.size,
          idBereich: [Math.min(...ids), Math.max(...ids)],
          idsUeber1023,
          'prob==0 trotz gesetzter ID': probNullMitId,
          'Tabellen mit >= 2 Standardslots': `${mindestensZwei}/${belegt.length}`,
          parser: { ok: `${parserOk}/${rohe.length}`, diagnosen: parserDiagnosen, slots: parserSlots },
        },
        null,
        1,
      ),
    );

    // --- Abnahmen.
    // 1. Accounting: 48 B in ALLEN Fields — das Layout braucht die Sektion auf.
    expect(rohe.length).toBe(702);
    expect(groessen.get(ENC_SECTION_LEN)).toBe(rohe.length);
    // 2. Padding genullt in allen 1404 Tabellen.
    expect(paddingNull).toBe(tabellen.length);
    // 3. `enabled` ist genau dann 1, wenn die Tabelle Inhalt hat.
    expect(enabledKonsistent).toBe(tabellen.length);
    expect([...enabledWerte.keys()].sort()).toEqual([0, 1]);
    // 4. Summenprobe: EIN Wert, und zwar 64 — in allen belegten Tabellen.
    expect(kandidat.size).toBe(1);
    expect([...kandidat.keys()][0]).toBe(ENC_PROB_SUM);
    expect([...kandidat.values()][0]).toBe(belegt.length);
    // 5. Nullwert-Zweitrechnung: die genullten Tabellen sind die Mehrheit,
    //    die Quote oben ist ohne sie gerechnet.
    expect(genullt.length).toBeGreaterThan(belegt.length);
    // 6. Kontrollen fallen durch: kein anderer Bit-Split liefert eine
    //    konstante Summe.
    for (const sh of [8, 9, 11, 12]) expect(summeMit(belegt, sh, 2).size).toBeGreaterThan(1);
    for (const basis of [1, 3]) expect(summeMit(belegt, 10, basis).size).toBeGreaterThan(10);
    expect(summeMit(belegt, 10, 2, true).size).toBeGreaterThan(10);
    // 7. Tabelle 1 über alle Fields: nur 0 (genullt) oder 64.
    expect([...tab1Alle.keys()].sort((a, b) => a - b)).toEqual([0, ENC_PROB_SUM]);
    // 8. Die erzwungene Zweitvorhersage hält ausnahmslos.
    expect(mindestensZwei).toBe(belegt.length);
    // 9. IDs im 10-Bit-Bereich.
    expect(idsUeber1023).toBe(0);
    // 9. Der Paketparser sieht dasselbe und meldet über 702 Fields nichts.
    expect(parserOk).toBe(rohe.length);
    expect(parserDiagnosen).toBe(0);
    expect(parserSlots).toBe(slotsBelegt);

    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(!available)('O3b: Wer schaltet auf Tabelle 1?', () => {
  it('sucht den Umschalter über differenzielle Opcode-Häufigkeit', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const len = new Array<number>(256).fill(-1);
    for (const [op, l] of Object.entries(IMPL_OPERAND_LEN)) len[Number(op)] = l;
    for (const [op, l] of Object.entries(SKIP_OPERAND_LEN)) len[Number(op)] = l;

    // Klassen: 2 belegte Tabellen · 1 belegte · keine.
    const klasse: Record<'zwei' | 'eine' | 'keine', Set<number>[]> = { zwei: [], eine: [], keine: [] };
    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const b = parsed.bundle;
      if (!b?.encounters || !b.script) continue;
      const n = b.encounters.tables.filter((t) => t.enabled).length;
      const code = b.rawSections[1];
      const ops = new Set<number>();
      if (code) {
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
            ops.add(op);
            pc += 1 + l;
          }
        }
      }
      klasse[n === 2 ? 'zwei' : n === 1 ? 'eine' : 'keine'].push(ops);
    }

    const anteil = (menge: Set<number>[], op: number): number =>
      menge.length === 0 ? 0 : menge.filter((s) => s.has(op)).length / menge.length;
    const kandidaten = [];
    for (let op = 0; op < 256; op++) {
      const a = anteil(klasse.zwei, op);
      const b = anteil(klasse.eine, op);
      if (a >= 0.8 && a - b > 0.3)
        kandidaten.push({
          op: `0x${op.toString(16)}`,
          operandLen: len[op],
          zwei: `${klasse.zwei.filter((s) => s.has(op)).length}/${klasse.zwei.length}`,
          eine: `${klasse.eine.filter((s) => s.has(op)).length}/${klasse.eine.length}`,
          keine: `${klasse.keine.filter((s) => s.has(op)).length}/${klasse.keine.length}`,
        });
    }

    console.log(
      'O3b Umschalter-Suche:',
      JSON.stringify(
        {
          fields: { zweiTabellen: klasse.zwei.length, eineTabelle: klasse.eine.length, keine: klasse.keine.length },
          'Opcodes in >=80 % der Zwei-Tabellen-Fields und >30 Prozentpunkte seltener sonst': kandidaten,
        },
        null,
        1,
      ),
    );

    // Die Klassenstärken sind der Befund, nicht die Kandidatenliste: 15 Fields
    // sind eine zu kleine Grundmenge, um einen Umschalter zu BELEGEN.
    expect(klasse.zwei.length).toBe(15);
    expect(klasse.eine.length + klasse.zwei.length + klasse.keine.length).toBe(702);

    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
