import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, parseMaplist, type FieldDiagnostic, type FieldMaplist } from '@webmidgar/formats-field';

/**
 * F06/F11a — Probe VOR dem Parser (Methodik-Standard seit S7).
 *
 * Gegenstand 1: `field.tbl` aus `world_us.lgp` — die behauptete Quelle der
 * World→Field-Einstiegspunkte (docs/quellen/ff7-landscaper.md §3.1).
 * HYPOTHESE H-FTBL: 64 Datensätze à 24 B; Datensatz = 2 Einträge à 12 B
 * (default/alternative); Eintrag = i16 x · i16 y · u16 triangle · u16 fieldId
 * · u8 direction · 3 B Padding, wobei das Padding dreimal die Richtung
 * wiederholt.
 *
 * Belegt wird NICHT durch Übernahme, sondern durch drei unabhängige, je mit
 * KONTROLLE gemessene Vorhersagen:
 *  (K1) Vierfachwiederholung des Richtungsbytes — Kontrolle: dieselbe Regel
 *       an einer um 1..3 Byte verschobenen Feldposition im selben Eintrag.
 *  (K2) `fieldId` löst in die `maplist` auf (nicht leerer Name, der als
 *       flevel-Eintrag existiert) — Kontrolle: `fieldId` von der um ±1/±2 B
 *       verschobenen Position gelesen.
 *  (K3) `triangle` ist ein gültiger Dreiecksindex im Walkmesh GENAU DES
 *       Feldes, das (K2) liefert — Kontrolle: derselbe Dreiecksindex gegen
 *       ein zufälliges anderes Feld (Permutation der Zuordnung).
 *
 * Nullwert-Zweitrechnung: leere Datensätze (alle 24 B = 0) bestehen K1 und
 * K3 trivial. Sie werden separat gezählt und aus den Quoten herausgerechnet.
 *
 * Gegenstand 2: Belegung von `textureId = w & 0x1FF` und `locationId` im
 * Dreieckswort der wm*.MAP (Vorarbeit F11b).
 *
 * Urheberrecht: berichtet werden ausschließlich Zähler, Quoten und
 * Wertebereiche — keine Rohbytes, keine Tabelleninhalte.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ?? 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const WM_DIR = join(REAL_DIR, 'data', 'wm');
const available = existsSync(WM_DIR);

const REC_BYTES = 24;
const ENTRY_BYTES = 12;
const REC_COUNT = 64;

interface RohEintrag {
  x: number;
  y: number;
  triangle: number;
  fieldId: number;
  dir: number;
  pad: [number, number, number];
  allNull: boolean;
}

function leseEintrag(view: DataView, base: number): RohEintrag {
  let allNull = true;
  for (let i = 0; i < ENTRY_BYTES; i++) if (view.getUint8(base + i) !== 0) allNull = false;
  return {
    x: view.getInt16(base, true),
    y: view.getInt16(base + 2, true),
    triangle: view.getUint16(base + 4, true),
    fieldId: view.getUint16(base + 6, true),
    dir: view.getUint8(base + 8),
    pad: [view.getUint8(base + 9), view.getUint8(base + 10), view.getUint8(base + 11)],
    allNull,
  };
}

describe.skipIf(!available)('Realdaten: field.tbl (F06) und textureWord-Belegung (F11a)', () => {
  it('field.tbl: Accounting, Vierfachregel, fieldId→maplist, triangle→Walkmesh — je mit Kontrolle', async () => {
    const { NodeDirectorySource } = await import('./node-source.js');

    // --- field.tbl aus world_us.lgp holen -----------------------------------
    const wmDirSrc = new NodeDirectorySource(REAL_DIR, ['data/wm']);
    const wmIndex = new IndexService();
    await wmIndex.openSource(wmDirSrc, { deep: false });
    const eintraege = [...wmIndex.listEntries('world_us')];
    const tblEintrag = eintraege.find((e) => e.name.toLowerCase() === 'field.tbl');
    expect(tblEintrag, 'field.tbl liegt in world_us.lgp').toBeDefined();
    const tbl = await wmIndex.readEntry(tblEintrag!.canonicalId);
    await wmDirSrc.closeAll();

    // (A) Accounting — die harte Vorhersage: 64 × 24 == Dateilänge, Rest 0.
    const accounting = {
      laenge: tbl.length,
      erwartet: REC_COUNT * REC_BYTES,
      rest: tbl.length % REC_BYTES,
      datensaetze: Math.floor(tbl.length / REC_BYTES),
    };
    expect(accounting.laenge).toBe(accounting.erwartet);

    const view = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
    const alle: Array<{ rec: number; slot: 0 | 1; e: RohEintrag }> = [];
    for (let r = 0; r < REC_COUNT; r++) {
      for (const slot of [0, 1] as const) {
        alle.push({ rec: r, slot, e: leseEintrag(view, r * REC_BYTES + slot * ENTRY_BYTES) });
      }
    }
    const belegt = alle.filter((a) => !a.e.allNull);
    const leer = alle.length - belegt.length;

    // (K1) Vierfachregel: pad[0..2] == dir.
    const k1Treffer = belegt.filter((a) => a.e.pad.every((p) => p === a.e.dir)).length;
    // Kontrolle K1: dieselbe „vier gleiche Bytes"-Regel an verschobenen
    // Startpositionen im Eintrag (Byte 5..8, 6..9, 7..10) — dort dürfte sie
    // NICHT gelten, wenn die Feldgrenze bei Byte 8 richtig ist.
    const k1Kontrolle: number[] = [];
    for (const shift of [5, 6, 7]) {
      let treffer = 0;
      for (const a of belegt) {
        const base = a.rec * REC_BYTES + a.slot * ENTRY_BYTES;
        const b0 = view.getUint8(base + shift);
        if (
          view.getUint8(base + shift + 1) === b0 &&
          view.getUint8(base + shift + 2) === b0 &&
          view.getUint8(base + shift + 3) === b0
        ) {
          treffer++;
        }
      }
      k1Kontrolle.push(treffer);
    }

    // --- maplist + Fields laden ---------------------------------------------
    const fieldDir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const fIndex = new IndexService();
    await fIndex.openSource(fieldDir, { deep: false });
    const fdiag: FieldDiagnostic[] = [];
    let maplist: FieldMaplist | null = null;
    const flevelNamen = new Set<string>();
    const flevelIds = new Map<string, string>();
    for (const e of fIndex.listEntries('flevel')) {
      const n = e.name.toLowerCase();
      if (n === 'maplist') {
        maplist = parseMaplist(await fIndex.readEntry(e.canonicalId), 'maplist', fdiag);
        continue;
      }
      if (e.name.includes('.')) continue;
      flevelNamen.add(n);
      flevelIds.set(n, e.canonicalId);
    }
    expect(maplist).not.toBeNull();

    const aufloesbar = (id: number): string | null => {
      const n = maplist!.names[id];
      return n !== undefined && n.length > 0 && flevelNamen.has(n) ? n : null;
    };

    // (K2) fieldId → maplist → existierender flevel-Eintrag.
    const k2Treffer = belegt.filter((a) => aufloesbar(a.e.fieldId) !== null).length;
    // Kontrolle K2: fieldId von verschobener Byteposition (±1, ±2) lesen.
    const k2Kontrolle: Array<{ shift: number; treffer: number }> = [];
    for (const shift of [-2, -1, 1, 2]) {
      let treffer = 0;
      for (const a of belegt) {
        const base = a.rec * REC_BYTES + a.slot * ENTRY_BYTES + 6 + shift;
        if (base < 0 || base + 2 > tbl.length) continue;
        if (aufloesbar(view.getUint16(base, true)) !== null) treffer++;
      }
      k2Kontrolle.push({ shift, treffer });
    }
    // Zweite Kontrolle K2': Zufallswerte aus demselben Wertebereich.
    const maxId = Math.max(...belegt.map((a) => a.e.fieldId));
    let rng = 0x51ed_5eed >>> 0;
    const wuerfel = (m: number): number => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return (rng >>> 8) % m;
    };
    let k2Zufall = 0;
    for (let i = 0; i < belegt.length; i++) if (aufloesbar(wuerfel(maxId + 1)) !== null) k2Zufall++;

    // (K3) triangle < Dreiecksanzahl im Walkmesh des aufgelösten Feldes.
    const triCounts = new Map<string, number>();
    const namenGebraucht = new Set<string>();
    for (const a of belegt) {
      const n = aufloesbar(a.e.fieldId);
      if (n) namenGebraucht.add(n);
    }
    for (const n of namenGebraucht) {
      try {
        const parsed = parseFieldEntry(await fIndex.readEntry(flevelIds.get(n)!), n);
        const c = parsed.bundle?.walkmesh?.triangles.length ?? 0;
        if (c > 0) triCounts.set(n, c);
      } catch {
        /* nicht parsbar: zählt als „kein Walkmesh" */
      }
    }
    const mitZiel = belegt.filter((a) => {
      const n = aufloesbar(a.e.fieldId);
      return n !== null && triCounts.has(n);
    });
    const k3Treffer = mitZiel.filter((a) => a.e.triangle < triCounts.get(aufloesbar(a.e.fieldId)!)!).length;
    // Kontrolle K3: derselbe Dreiecksindex gegen ein VERSCHOBENES Ziel
    // (zyklische Permutation der Zuordnung Eintrag→Feld).
    const zielListe = mitZiel.map((a) => triCounts.get(aufloesbar(a.e.fieldId)!)!);
    let k3Kontrolle = 0;
    for (let i = 0; i < mitZiel.length; i++) {
      if (mitZiel[i]!.e.triangle < zielListe[(i + 1) % zielListe.length]!) k3Kontrolle++;
    }
    // Nullwert-Zweitrechnung: triangle === 0 besteht K3 fast immer trivial.
    const triNull = mitZiel.filter((a) => a.e.triangle === 0).length;
    const k3OhneNull = mitZiel.filter((a) => a.e.triangle > 0);
    const k3TrefferOhneNull = k3OhneNull.filter(
      (a) => a.e.triangle < triCounts.get(aufloesbar(a.e.fieldId)!)!,
    ).length;
    let k3KontrolleOhneNull = 0;
    const zielOhneNull = k3OhneNull.map((a) => triCounts.get(aufloesbar(a.e.fieldId)!)!);
    for (let i = 0; i < k3OhneNull.length; i++) {
      if (k3OhneNull[i]!.e.triangle < zielOhneNull[(i + 1) % zielOhneNull.length]!) k3KontrolleOhneNull++;
    }

    // (K4) DIE starke Gelenkvorhersage: der Ankunftspunkt (x, y) muss IM
    // Dreieck `triangle` des aufgelösten Feldes liegen. Das prüft x, y,
    // triangle und fieldId GEMEINSAM — ein falsches Layout kann das nicht
    // zufällig erfüllen. Kontrollen: (a) derselbe Punkt gegen ein zufälliges
    // ANDERES Dreieck desselben Feldes, (b) permutierte Feldzuordnung.
    const meshCache = new Map<string, Array<[number, number][]>>();
    for (const n of namenGebraucht) {
      try {
        const parsed = parseFieldEntry(await fIndex.readEntry(flevelIds.get(n)!), n);
        const tris = parsed.bundle?.walkmesh?.triangles;
        if (tris) meshCache.set(n, tris.map((t) => t.vertices.map((v) => [v[0], v[1]] as [number, number])));
      } catch {
        /* siehe oben */
      }
    }
    const imDreieck = (p: [number, number], tri: Array<[number, number]>): boolean => {
      const [a, b, c] = tri as [[number, number], [number, number], [number, number]];
      const kreuz = (u: [number, number], v: [number, number], w: [number, number]): number =>
        (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
      const d1 = kreuz(a, b, p);
      const d2 = kreuz(b, c, p);
      const d3 = kreuz(c, a, p);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      return !(neg && pos);
    };
    const k4Menge = mitZiel.filter((a) => {
      const n = aufloesbar(a.e.fieldId)!;
      const tris = meshCache.get(n);
      return tris !== undefined && a.e.triangle < tris.length;
    });
    let k4Treffer = 0;
    let k4KontrolleAnderesDreieck = 0;
    let k4KontrollePermutiert = 0;
    const k4Namen = k4Menge.map((a) => aufloesbar(a.e.fieldId)!);
    for (let i = 0; i < k4Menge.length; i++) {
      const a = k4Menge[i]!;
      const tris = meshCache.get(k4Namen[i]!)!;
      const p: [number, number] = [a.e.x, a.e.y];
      if (imDreieck(p, tris[a.e.triangle]!)) k4Treffer++;
      // (a) zufälliges anderes Dreieck desselben Feldes
      if (tris.length > 1) {
        let idx = wuerfel(tris.length);
        if (idx === a.e.triangle) idx = (idx + 1) % tris.length;
        if (imDreieck(p, tris[idx]!)) k4KontrolleAnderesDreieck++;
      }
      // (b) permutierte Feldzuordnung (nächster Eintrag), Index geklemmt
      const andere = meshCache.get(k4Namen[(i + 1) % k4Namen.length]!)!;
      if (imDreieck(p, andere[a.e.triangle % andere.length]!)) k4KontrollePermutiert++;
    }

    // (D) Verteilungsbeschreibung: Wertebereiche (keine Tabelleninhalte).
    const spanne = (f: (e: RohEintrag) => number): [number, number] => [
      Math.min(...belegt.map((a) => f(a.e))),
      Math.max(...belegt.map((a) => f(a.e))),
    ];
    const bericht = {
      accounting,
      eintraege: { gesamt: alle.length, belegt: belegt.length, leer },
      k1_richtungVierfach: { treffer: k1Treffer, von: belegt.length, kontrolleShift5_6_7: k1Kontrolle },
      k2_fieldIdAufloesung: {
        treffer: k2Treffer,
        von: belegt.length,
        kontrolleVerschoben: k2Kontrolle,
        kontrolleZufall: k2Zufall,
        maplistLaenge: maplist!.names.length,
      },
      k3_triangleImWalkmesh: {
        treffer: k3Treffer,
        von: mitZiel.length,
        kontrollePermutiert: k3Kontrolle,
        nullTriangles: triNull,
        ohneNull: { treffer: k3TrefferOhneNull, von: k3OhneNull.length, kontrolle: k3KontrolleOhneNull },
      },
      k4_punktImDreieck: {
        treffer: k4Treffer,
        von: k4Menge.length,
        kontrolleAnderesDreieck: k4KontrolleAnderesDreieck,
        kontrollePermutiertesFeld: k4KontrollePermutiert,
      },
      wertebereiche: {
        x: spanne((e) => e.x),
        y: spanne((e) => e.y),
        triangle: spanne((e) => e.triangle),
        fieldId: spanne((e) => e.fieldId),
        dir: spanne((e) => e.dir),
      },
      slotBelegung: {
        default: alle.filter((a) => a.slot === 0 && !a.e.allNull).length,
        alternative: alle.filter((a) => a.slot === 1 && !a.e.allNull).length,
        alternativeGleichDefault: Array.from({ length: REC_COUNT }, (_, r) => r).filter((r) => {
          const d = alle.find((a) => a.rec === r && a.slot === 0)!.e;
          const alt = alle.find((a) => a.rec === r && a.slot === 1)!.e;
          return d.x === alt.x && d.y === alt.y && d.triangle === alt.triangle && d.fieldId === alt.fieldId;
        }).length,
      },
    };
    console.log('F06-FIELDTBL:', JSON.stringify(bericht, null, 1));
    await fieldDir.closeAll();

    // Verriegelungen: nur das, was die Messung hergibt.
    expect(accounting.rest).toBe(0);
    expect(k1Treffer).toBe(belegt.length);
    expect(k2Treffer).toBe(belegt.length);
    // K4 ist die eigentliche Verriegelung: Punkt im Zieldreieck 65/65 gegen
    // 0/65 Kontrolle (anderes Dreieck desselben Feldes).
    expect(k4Treffer).toBe(k4Menge.length);
    expect(k4KontrolleAnderesDreieck).toBe(0);
  }, 900_000);

  it('Opcode 0x318: Operandenreihenfolge (Datensatz, Szenario) gegen die Vertauschungskontrolle', async () => {
    const { NodeDirectorySource } = await import('./node-source.js');
    const { parseWorldEv, parseFieldTbl, fieldTblEntry } = await import('@webmidgar/formats-world');
    const dirSrc = new NodeDirectorySource(REAL_DIR, ['data/wm']);
    const index = new IndexService();
    await index.openSource(dirSrc, { deep: false });
    const eintraege = [...index.listEntries('world_us')];
    const tbl = parseFieldTbl(await index.readEntry(eintraege.find((e) => e.name.toLowerCase() === 'field.tbl')!.canonicalId));

    // Muster: PUSH a · PUSH b · 0x318. Der Compiler legt Immediates direkt
    // vor dem Kommando ab (world-cmd-probe: Anweisungen ab 0x100).
    const PUSH = 0x110;
    const ENTER = 0x318;
    const paare: Array<[number, number]> = [];
    let vorkommenGesamt = 0;
    for (const evName of ['wm0.ev', 'wm2.ev', 'wm3.ev']) {
      const e = eintraege.find((x) => x.name.toLowerCase() === evName);
      if (!e) continue;
      const ev = parseWorldEv(await index.readEntry(e.canonicalId));
      const code = ev.code;
      for (let i = 4; i < code.length; i++) {
        if (code[i] !== ENTER) continue;
        vorkommenGesamt++;
        if (code[i - 4] === PUSH && code[i - 2] === PUSH) paare.push([code[i - 3]!, code[i - 1]!]);
      }
    }
    await dirSrc.closeAll();

    // Deutung A (Referenz): args[0] = Datensatz (0..63), args[1] = Szenario (0/1).
    const aDatensatzGueltig = paare.filter((p) => p[0] < 64).length;
    const aSzenarioGueltig = paare.filter((p) => p[1] <= 1).length;
    const aBeides = paare.filter((p) => p[0] < 64 && p[1] <= 1).length;
    const aSlotBelegt = paare.filter((p) => p[0] < 64 && p[1] <= 1 && fieldTblEntry(tbl, p[0], p[1] as 0 | 1) !== null).length;
    // KONTROLLE (Deutung B): Operanden vertauscht.
    const bBeides = paare.filter((p) => p[1] < 64 && p[0] <= 1).length;
    const bSlotBelegt = paare.filter(
      (p) => p[1] < 64 && p[0] <= 1 && fieldTblEntry(tbl, p[1], p[0] as 0 | 1) !== null,
    ).length;

    console.log(
      'F06-0X318:',
      JSON.stringify(
        {
          vorkommenGesamt,
          vorkommenMitDirektenPushes: paare.length,
          deutungA_datensatzDannSzenario: {
            datensatzUnter64: aDatensatzGueltig,
            szenarioNur0oder1: aSzenarioGueltig,
            beides: aBeides,
            trifftBelegtenSlot: aSlotBelegt,
          },
          kontrolleB_vertauscht: { beides: bBeides, trifftBelegtenSlot: bSlotBelegt },
          datensatzMax: Math.max(...paare.map((p) => p[0])),
          datensatzMin: Math.min(...paare.map((p) => p[0])),
          // Basiswahl: 0-basiert vs. 1-basiert (die Referenz ist hier
          // widersprüchlich). Diskriminator ist die Trefferquote auf BELEGTE
          // Slots, besonders bei Szenario 1 (nur 7 belegte alternative Slots).
          basis0: {
            belegt: paare.filter((p) => p[0] < 64 && p[1] <= 1 && fieldTblEntry(tbl, p[0], p[1] as 0 | 1) !== null)
              .length,
            belegtSzenario1: paare.filter((p) => p[1] === 1 && p[0] < 64 && fieldTblEntry(tbl, p[0], 1) !== null).length,
          },
          basis1: {
            belegt: paare.filter(
              (p) => p[0] >= 1 && p[0] <= 64 && p[1] <= 1 && fieldTblEntry(tbl, p[0] - 1, p[1] as 0 | 1) !== null,
            ).length,
            belegtSzenario1: paare.filter(
              (p) => p[1] === 1 && p[0] >= 1 && p[0] <= 64 && fieldTblEntry(tbl, p[0] - 1, 1) !== null,
            ).length,
          },
          szenario1Gesamt: paare.filter((p) => p[1] === 1).length,
          leereSlotTreffer: {
            szenario0: paare.filter((p) => p[0] < 64 && p[1] === 0 && fieldTblEntry(tbl, p[0], 0) === null).length,
            szenario1: paare.filter((p) => p[0] < 64 && p[1] === 1 && fieldTblEntry(tbl, p[0], 1) === null).length,
          },
          szenarioVerteilung: {
            null: paare.filter((p) => p[1] === 0).length,
            eins: paare.filter((p) => p[1] === 1).length,
            sonst: paare.filter((p) => p[1] > 1).length,
          },
        },
        null,
        1,
      ),
    );
    expect(paare.length).toBeGreaterThan(0);
    // Verriegelung: Deutung A schlägt die Vertauschungskontrolle deutlich,
    // und die 1-basierte Datensatznummer trifft 89/89 belegte Slots.
    expect(aSlotBelegt).toBeGreaterThan(bSlotBelegt * 10 + 10);
    expect(aSzenarioGueltig).toBe(paare.length);
    const basis1Belegt = paare.filter(
      (p) => p[0]! >= 1 && p[0]! <= 64 && p[1]! <= 1 && fieldTblEntry(tbl, p[0]! - 1, p[1] as 0 | 1) !== null,
    ).length;
    expect(basis1Belegt).toBe(paare.length);
  }, 900_000);

  it('textureWord: belegte textureId/locationId je Karte (Vorarbeit F11b)', async () => {
    const { parseWorldMap } = await import('@webmidgar/formats-world');
    const bericht: Record<string, unknown> = {};
    for (const name of ['WM0.MAP', 'WM2.MAP', 'WM3.MAP']) {
      const terrain = parseWorldMap(new Uint8Array(readFileSync(join(WM_DIR, name))));
      const texIds = new Set<number>();
      const locIds = new Set<number>();
      const loc5 = new Set<number>();
      const loc5MitBit15 = new Set<number>();
      const loc5OhneBit15 = new Set<number>();
      let bit14 = 0;
      let bit15 = 0;
      let dreiecke = 0;
      for (const b of terrain.blocks) {
        for (const m of b?.meshes ?? []) {
          for (const t of m?.triangles ?? []) {
            dreiecke++;
            texIds.add(t.textureWord & 0x1ff);
            locIds.add(t.textureWord >> 9);
            const l5 = (t.textureWord >> 9) & 0x1f;
            loc5.add(l5);
            if ((t.textureWord >> 14) & 1) bit14++;
            if ((t.textureWord >> 15) & 1) {
              bit15++;
              loc5MitBit15.add(l5);
            } else {
              loc5OhneBit15.add(l5);
            }
          }
        }
      }
      const sortiert = [...texIds].sort((a, b) => a - b);
      bericht[name] = {
        dreiecke,
        textureIdUnikate: texIds.size,
        textureIdMin: sortiert[0],
        textureIdMax: sortiert[sortiert.length - 1],
        textureIdLueckenlos: sortiert.length === (sortiert[sortiert.length - 1] ?? -1) + 1,
        locationIdUnikate_7bit: locIds.size,
        locationIdMax_7bit: Math.max(...locIds),
        locationIdUnikate_5bit: loc5.size,
        locationIdMax_5bit: Math.max(...loc5),
        bit14Gesetzt: bit14,
        bit15Gesetzt: bit15,
        // Entscheidungsmaß gaia (7 Bit locationId) vs. ff7-landscaper
        // (5 Bit + freies Bit 14 + Flagbit 15): Sind die 5-Bit-Werte MIT
        // Bit 15 eine Teilmenge derer OHNE? Dann ist Bit 15 ein FLAG und
        // keine Wertstelle.
        loc5MitBit15TeilmengeVonOhne: [...loc5MitBit15].every((v) => loc5OhneBit15.has(v)),
        loc5MitBit15Unikate: loc5MitBit15.size,
      };
    }
    console.log('F11A-TEXWORD:', JSON.stringify(bericht, null, 1));
    expect(Object.keys(bericht)).toHaveLength(3);
  }, 900_000);
});
