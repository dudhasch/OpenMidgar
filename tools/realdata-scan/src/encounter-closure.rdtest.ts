import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, splitFormationId, type FieldBundle } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * O3b-Probe II — **Referenzschluss** und die Frage, WO die Encounter-Daten
 * liegen.
 *
 * Ausgesprochene Suchmengen-Annahme: Die Zufallskampf-Information ist auf
 * **zwei** Dateien verteilt. Field-Sektion 7 hält *welche* Kämpfe *wie oft*
 * vorkommen; `data/battle/scene.bin` hält, *was* ein Kampf ist (Gegner,
 * Formation, Kampfort, KI). Diese Annahme wird nicht behauptet, sondern
 * gemessen — über eine Eigenschaft, die eine falsche Auslegung nicht erfüllen
 * kann.
 *
 * **Der starke Test ist NICHT „die ID zeigt auf eine existierende Formation".**
 * Das bestehen 1083/1083 Vorkommen — aber auch jede um 1, 4 oder 64
 * verschobene Kontrollmenge, weil 1000 der 1024 Formationen belegt sind. Die
 * Messung wäre wertlos. Der scharfe Test nutzt stattdessen den **Kampfort**
 * (u16@0 des 20-B-Setup-Records einer Formation): Die Zufallskämpfe EINES
 * Fields müssen alle am selben Ort spielen. Diese Vorhersage fällt vor der
 * Messung und trennt messbar.
 *
 * Nullwert-Zweitrechnung: Nur die 197 belegten Tabellen gehen ein; die 1207
 * genullten (520 Fields ganz ohne Zufallskämpfe) sind ausgeschlossen und
 * werden getrennt berichtet.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten, Wertebereiche.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(join(REAL_DIR, 'data', 'battle', 'scene.bin'));

const BLOCK = 0x2000;
const SCENE_LEN = 0x1e80;
const SETUP = 0x08;
const SETUP_LEN = 20;
const FORMATION = 0x118;
const FORMATION_SLOT_LEN = 16;
const FORMATION_SLOTS = 6;
const EMPTY = 0xffff;

/** Lokaler, nur lesender Zugriff auf scene.bin (Blockzerlegung wie S30). */
function ladeSzenen(): Uint8Array[] {
  const bin = new Uint8Array(readFileSync(join(REAL_DIR, 'data', 'battle', 'scene.bin')));
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out: Uint8Array[] = [];
  for (let b = 0; b < bin.length / BLOCK; b++) {
    const base = b * BLOCK;
    const ptrs: number[] = [];
    for (let i = 0; i < 16; i++) {
      const v = dv.getUint32(base + i * 4, true);
      if (v !== 0xffffffff) ptrs.push(v * 4);
    }
    for (let i = 0; i < ptrs.length; i++) {
      const start = base + ptrs[i]!;
      const end = i + 1 < ptrs.length ? base + ptrs[i + 1]! : base + BLOCK;
      let se = end;
      while (se > start && bin[se - 1] === 0xff) se--;
      const raw = inflateRawSync(bin.subarray(start + 10, se));
      out.push(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    }
  }
  return out;
}

/** Vom ersten Test gefüllt, vom zweiten für die Deckungsrechnung gelesen. */
const feldSeite = { sektion7: new Set<number>(), battle: new Set<number>(), unerreicht: [] as number[] };

describe.skipIf(!available)('O3b: Sektion 7 — Referenzschluss gegen scene.bin', () => {
  const szenen = available ? ladeSzenen() : [];
  const setupU16 = (formationId: number, off: number): number => {
    const { scene, formation } = splitFormationId(formationId);
    const s = szenen[scene]!;
    const b = SETUP + formation * SETUP_LEN + off;
    return s[b]! | (s[b + 1]! << 8);
  };
  const gegnerplaetze = (formationId: number): { id: number; z: number }[] => {
    const { scene, formation } = splitFormationId(formationId);
    const s = szenen[scene]!;
    const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    const out: { id: number; z: number }[] = [];
    for (let p = 0; p < FORMATION_SLOTS; p++) {
      const o = FORMATION + (formation * FORMATION_SLOTS + p) * FORMATION_SLOT_LEN;
      const id = dv.getUint16(o, true);
      if (id !== EMPTY) out.push({ id, z: dv.getInt16(o + 6, true) });
    }
    return out;
  };
  /** Formation belegt = mindestens ein Gegnerplatz besetzt (1000/1024). */
  const belegtGlobal = new Array<boolean>(1024).fill(false);
  if (available) for (let f = 0; f < 1024; f++) belegtGlobal[f] = gegnerplaetze(f).length > 0;

  it('löst jede Kampf-ID auf — und der Kampfort trennt gegen jede Kontrolle', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const bundles: FieldBundle[] = [];
    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      if (parsed.bundle) bundles.push(parsed.bundle);
    }

    interface Tab {
      field: string;
      index: number;
      standard: number[];
      special: { slot: number; id: number }[];
      /** Alle belegten Slots — die Menge, über die der Kampfort geprüft wird. */
      alle: number[];
    }
    const tabellen: Tab[] = [];
    let genullteTabellen = 0;
    for (const b of bundles) {
      const enc = b.encounters;
      if (!enc) continue;
      enc.tables.forEach((t, i) => {
        if (!t.enabled) {
          genullteTabellen++;
          return;
        }
        const standard = t.standard.filter((s) => s.raw !== 0).map((s) => s.formationId);
        const special = t.special
          .map((s, k) => ({ slot: k, id: s.formationId, raw: s.raw }))
          .filter((s) => s.raw !== 0)
          .map(({ slot, id }) => ({ slot, id }));
        tabellen.push({ field: b.fieldId, index: i, standard, special, alle: [...standard, ...special.map((s) => s.id)] });
      });
    }
    const alleVorkommen = tabellen.flatMap((t) => t.alle);
    const alleIds = new Set(alleVorkommen);

    // --- Schwacher Test (bewusst mitgemessen, um zu zeigen, dass er NICHT trennt).
    const belegt = belegtGlobal;
    const aufloesbar = (shift: number): number => alleVorkommen.filter((id) => belegt[(id + shift) & 0x3ff]).length;

    // --- Scharfer Test: Kampfort-Einheitlichkeit je Tabelle.
    const mehrfach = tabellen.filter((t) => new Set(t.alle).size > 1);
    const ortEinheitlich = (menge: Tab[], shift: number): number =>
      menge.filter((t) => new Set(t.alle.map((id) => setupU16((id + shift) & 0x3ff, 0))).size === 1).length;

    // --- Verschärfung: nur Tabellen, die mindestens eine Formation in einer
    //     Szene mit UNEINHEITLICHEM Kampfort referenzieren. Dort hängt das
    //     Ergebnis an den unteren zwei Bit — also am Formationsindex `id & 3`.
    const szeneEinheitlich = (scene: number): boolean =>
      new Set([0, 1, 2, 3].map((f) => setupU16(scene * 4 + f, 0))).size === 1;
    const scharf = mehrfach.filter((t) => t.alle.some((id) => !szeneEinheitlich(id >> 2)));

    // --- Zufallskontrolle: IDs aus derselben Grundgesamtheit neu gezogen.
    const pool = [...alleIds];
    let zufall = 0;
    for (const t of mehrfach) {
      const werte = new Set(t.alle.map(() => setupU16(pool[Math.floor(Math.random() * pool.length)]!, 0)));
      if (werte.size === 1) zufall++;
    }

    // --- Sonderslots: Anflugbit im Setup (u16@18), Bit 0/1/2.
    const anflug = (id: number): number => setupU16(id, 18) & 0x07;
    const stdIds = new Set(tabellen.flatMap((t) => t.standard));
    const spcIds = new Set(tabellen.flatMap((t) => t.special.map((s) => s.id)));
    const stdMitBit = [...stdIds].filter((id) => anflug(id) !== 0).length;
    const proSlot: Record<string, string> = {};
    for (let k = 0; k < 4; k++) {
      const menge = new Set(tabellen.flatMap((t) => t.special.filter((s) => s.slot === k).map((s) => s.id)));
      const bits = [0, 1, 2].map((b) => [...menge].filter((id) => anflug(id) & (1 << b)).length);
      proSlot[`special[${k}] (n=${menge.size})`] = `Bit0 ${bits[0]} · Bit1 ${bits[1]} · Bit2 ${bits[2]}`;
    }
    // Geometrieprobe: Rückenangriff = alle Gegner HINTER der Gruppe (z > 0).
    const zProfil = (menge: Iterable<number>): string => {
      const arr = [...menge].map((id) => gegnerplaetze(id)).filter((g) => g.length > 0);
      const hinten = arr.filter((g) => g.every((s) => s.z > 0)).length;
      const vorn = arr.filter((g) => g.every((s) => s.z < 0)).length;
      const beides = arr.filter((g) => g.some((s) => s.z < 0) && g.some((s) => s.z > 0)).length;
      return `n=${arr.length} vorn ${vorn} · hinten ${hinten} · beidseitig ${beides}`;
    };

    // --- Deckungsrechnung: Wer erreicht welche Formationen?
    const battleIds = new Set<number>();
    {
      const len = new Array<number>(256).fill(-1);
      for (const [op, l] of Object.entries(IMPL_OPERAND_LEN)) len[Number(op)] = l;
      for (const [op, l] of Object.entries(SKIP_OPERAND_LEN)) len[Number(op)] = l;
      for (const b of bundles) {
        const code = b.rawSections[1];
        if (!code || !b.script) continue;
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
            if (l < 0) break;
            if (pc + 1 + l > code.length) break;
            if (op === 0x70 && code[pc + 1] === 0) battleIds.add(code[pc + 2]! | (code[pc + 3]! << 8));
            pc += 1 + l;
          }
        }
      }
    }
    const vereinigung = new Set([...alleIds, ...[...battleIds].filter((i) => i < 1024)]);
    const unerreicht = [...Array(1024).keys()].filter((i) => belegt[i] && !vereinigung.has(i));
    feldSeite.sektion7 = alleIds;
    feldSeite.battle = battleIds;
    feldSeite.unerreicht = unerreicht;

    console.log(
      'O3b Sektion 7 — Referenzschluss und Ortsfrage:',
      JSON.stringify(
        {
          szenen: szenen.length,
          szenenlaengeEinheitlich: szenen.every((s) => s.length === SCENE_LEN),
          belegteFormationen: `${belegt.filter(Boolean).length}/1024`,
          belegteTabellen: tabellen.length,
          genullteTabellen,
          vorkommen: alleVorkommen.length,
          verschiedeneIds: alleIds.size,
          schwacherTest: {
            id: `${aufloesbar(0)}/${alleVorkommen.length}`,
            'id+1': `${aufloesbar(1)}/${alleVorkommen.length}`,
            'id+4': `${aufloesbar(4)}/${alleVorkommen.length}`,
            'id+64': `${aufloesbar(64)}/${alleVorkommen.length}`,
            bewertung: 'trennt NICHT — 97,7 % aller Formationen sind belegt',
          },
          scharferTest_Kampfort: {
            grundmenge: mehrfach.length,
            id: `${ortEinheitlich(mehrfach, 0)}/${mehrfach.length}`,
            'id+1': `${ortEinheitlich(mehrfach, 1)}/${mehrfach.length}`,
            'id-1': `${ortEinheitlich(mehrfach, 1023)}/${mehrfach.length}`,
            'id+4': `${ortEinheitlich(mehrfach, 4)}/${mehrfach.length}`,
            'id+64': `${ortEinheitlich(mehrfach, 64)}/${mehrfach.length}`,
            neuGezogen: `${zufall}/${mehrfach.length}`,
          },
          verschaerft_Formationsindex: {
            grundmenge: scharf.length,
            id: `${ortEinheitlich(scharf, 0)}/${scharf.length}`,
            'id+1': `${ortEinheitlich(scharf, 1)}/${scharf.length}`,
            'id+2': `${ortEinheitlich(scharf, 2)}/${scharf.length}`,
            'id+3': `${ortEinheitlich(scharf, 3)}/${scharf.length}`,
            'id-1': `${ortEinheitlich(scharf, 1023)}/${scharf.length}`,
          },
          sonderslots: {
            'Standard-IDs mit Anflugbit': `${stdMitBit}/${stdIds.size}`,
            ...proSlot,
            'z-Profil Standard': zProfil(stdIds),
            'z-Profil Sonder': zProfil(spcIds),
          },
          ortsfrage: {
            'von Sektion 7 erreicht': `${alleIds.size}/1024`,
            'Sektion-7-IDs unter 256': [...alleIds].filter((i) => i < 256).length,
            'Sektion-7-Szenenbereich': [Math.min(...alleIds) >> 2, Math.max(...alleIds) >> 2],
            'BATTLE-Opcode-Literale': battleIds.size,
            'Schnitt Sektion 7 ∩ BATTLE': [...alleIds].filter((i) => battleIds.has(i)).length,
            'belegte Formationen, die WEDER Sektion 7 NOCH BATTLE erreicht': unerreicht.length,
            'davon unter 256': unerreicht.filter((i) => i < 256).length,
          },
        },
        null,
        1,
      ),
    );

    // --- Abnahmen.
    // 1. Jede ID löst auf (notwendig, aber schwach — deshalb mit Kontrolle).
    expect(aufloesbar(0)).toBe(alleVorkommen.length);
    // 2. Der scharfe Test: Kampfort einheitlich in JEDER Tabelle …
    expect(ortEinheitlich(mehrfach, 0)).toBe(mehrfach.length);
    // … und jede Kontrolle fällt messbar ab.
    for (const shift of [1, 1023, 4, 64]) expect(ortEinheitlich(mehrfach, shift)).toBeLessThan(0.7 * mehrfach.length);
    expect(zufall).toBeLessThan(0.05 * mehrfach.length);
    // 3. Verschärfung — hier entscheidet `id & 3`, also der Formationsindex.
    expect(scharf.length).toBeGreaterThan(20);
    expect(ortEinheitlich(scharf, 0)).toBe(scharf.length);
    for (const shift of [1, 2, 3, 1023]) expect(ortEinheitlich(scharf, shift)).toBeLessThan(0.5 * scharf.length);
    // 4. Sonderslots: Standardkämpfe tragen praktisch nie ein Anflugbit
    //    (gemessen 1/328 — die eine Ausnahme ist dieselbe Formation, die auch
    //    im z-Profil als einzige beidseitig steht; sie bleibt 🟡).
    expect(stdMitBit).toBeLessThanOrEqual(1);
    expect(spcIds.size).toBeGreaterThan(100);
    // 5. Ortsfrage: Sektion 7 erreicht keine Formation unter 256.
    expect([...alleIds].filter((i) => i < 256).length).toBe(0);

    await dir.closeAll();
  }, 900_000);

  it('zeigt den Rest des Formationsbestands und wo er nicht steht', async () => {
    // Negativbefund als vollwertiges Ergebnis: Die Weltkarten-Zufallskämpfe
    // können nicht in Field-Sektion 7 stehen — es gibt kein Field für die
    // Weltkarte. Geprüft wird deshalb, ob im Weltkarten-Archiv überhaupt ein
    // Kandidat liegt. Das ist eine ORTS-, keine Layoutmessung.
    const dir = new NodeDirectorySource(REAL_DIR, ['data/wm']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const eintraege = [...index.listEntries('world_us')].map((e) => ({ name: e.name, id: e.canonicalId }));

    // Der Fund: `enc_w.bin`. Gegenprobe — trägt die Weltkartentabelle DASSELBE
    // Satzformat? Wenn ja, ist das eine unabhängige Zweitbestätigung des
    // 6/10-Layouts auf einer anderen Datei UND die Antwort auf die Ortsfrage.
    const encW = eintraege.find((e) => e.name.toLowerCase() === 'enc_w.bin');
    const weltkarte: Record<string, unknown> = {};
    if (encW) {
      const bytes = await index.readEntry(encW.id);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const REC = 24;
      const summen = new Map<number, number>();
      let saetze = 0;
      let genullteSaetze = 0;
      let idsAusserhalb = 0;
      const ids = new Set<number>();
      for (let o = 0; o + REC <= bytes.length; o += REC) {
        saetze++;
        if (bytes.subarray(o, o + REC).every((b) => b === 0)) {
          genullteSaetze++;
          continue;
        }
        let s = 0;
        for (let i = 0; i < 6; i++) s += dv.getUint16(o + 2 + i * 2, true) >> 10;
        summen.set(s, (summen.get(s) ?? 0) + 1);
        for (let i = 0; i < 10; i++) {
          const raw = dv.getUint16(o + 2 + i * 2, true);
          if (raw === 0) continue;
          const id = raw & 0x03ff;
          ids.add(id);
          if (!belegtGlobal[id]) idsAusserhalb++;
        }
      }
      weltkarte['enc_w.bin Größe'] = bytes.length;
      weltkarte['restlos in 24-B-Sätze teilbar'] = bytes.length % REC === 0;
      weltkarte['Sätze'] = saetze;
      weltkarte['genullte Sätze'] = genullteSaetze;
      weltkarte['Summe std[0..5] (belegte Sätze)'] = [...summen.entries()].sort((a, b) => a[0] - b[0]);
      weltkarte['verschiedene IDs'] = ids.size;
      weltkarte['IDs unter 256'] = [...ids].filter((i) => i < 256).length;
      weltkarte['IDs ohne belegte Formation'] = idsAusserhalb;
      weltkarte['Schnitt mit Sektion 7'] = [...ids].filter((i) => feldSeite.sektion7.has(i)).length;
      weltkarte['deckt von den 469 feldseitig unerreichten Formationen'] = feldSeite.unerreicht.filter((i) => ids.has(i)).length;
      const rest = feldSeite.unerreicht.filter((i) => !ids.has(i));
      weltkarte['danach noch unerreicht'] = rest.length;
      weltkarte['davon unter 256'] = rest.filter((i) => i < 256).length;
    }

    console.log(
      'O3b Ortsfrage — Weltkarten-Archiv:',
      JSON.stringify(
        {
          eintraege: eintraege.length,
          endungen: [...new Set(eintraege.map((e) => e.name.split('.').pop() ?? ''))].sort(),
          'Einträge ohne Modell-Endung': eintraege
            .filter((e) => !/\.(hrc|rsd|p|tex|a|lzs)$/i.test(e.name))
            .map((e) => e.name)
            .sort(),
          weltkarte,
        },
        null,
        1,
      ),
    );
    // Der Befund ist die DISJUNKTHEIT: Weltkarte und Fields teilen sich den
    // Formationsnummernraum, ohne sich zu überschneiden. Damit ist die
    // Ortsfrage beantwortet — und zugleich belegt, dass Sektion 7 die
    // Weltkarten-Zufallskämpfe nicht enthalten KANN.
    expect(encW).toBeDefined();
    expect(weltkarte['Schnitt mit Sektion 7']).toBe(0);
    expect(weltkarte['IDs ohne belegte Formation']).toBe(0);
    // Negativbefund: Das Satzformat ist NICHT das der Field-Sektion — die
    // Summenregel, die dort 197/197 hält, hält hier in 19 von 71 Sätzen.
    expect(eintraege.length).toBeGreaterThan(0);
    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
