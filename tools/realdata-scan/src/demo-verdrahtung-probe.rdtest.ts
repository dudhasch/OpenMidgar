import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, resolveFieldMusic, type FieldDiagnostic } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { parseWorldEv } from '@webmidgar/formats-world';
import {
  indexKernelSections,
  inventoryNameLookup,
  parseKernelContainer,
  pickItemTextLists,
  itemNameLookup,
  resolveKernelNameLists,
} from '@webmidgar/formats-kernel';
import { parseOriginalSave, readSavemap } from '@webmidgar/formats-save';
import { NodeDirectorySource } from './node-source.js';

/**
 * Demo-Verdrahtung: die vier Ketten, die `apps/demo` NEU benutzt, an den
 * Realdaten nachgemessen — **jede mit dem Zustand VOR der Verdrahtung als
 * Kontrolle**. Gegenstand ist nicht die Paketlogik (die haben die
 * Paket-Agenten belegt), sondern genau die Auswahl, die die Demo trifft.
 *
 * 1. **W1 — Weltscript-Paarung.** Die Demo wählte das Script mit
 *    `[...worldGm.keys()].find((n) => n.endsWith('.ev'))`. Die Map trägt
 *    TOC-Reihenfolge. Vorhersage: der so gegriffene Eintrag ist NICHT `wm0.ev`,
 *    obwohl `WM0.MAP` als Terrain läuft. Kontrollgröße ist die Zahl der
 *    Mesh-Funktionen — sie unterscheidet die Karten hart voneinander.
 *
 * 2. **F09-A — MUSIC-Kette bis zur OGG-Datei.** Neu:
 *    `Operand → akaoOffsets[v] → AKAO-Kopf → musicId → music.idx → OGG`.
 *    Alt: `musicNames[operand − 1]`. Gemessen wird das ENDE der Kette (liegt
 *    eine spielbare Datei vor), nicht die Zwischenstufe. Nullwert-Zweitrechnung:
 *    Operand 0 wird getrennt ausgewiesen — bei der alten Regel ist
 *    `musicNames[−1]` `undefined`, diese Aufrufe blieben stumm statt falsch.
 *
 * 3. **K1/K2 — Battle-Präfixindex.** Die Demo baut `listBattleEntries` aus
 *    `battle.lgp`. Vorhersage: der Index über `name.slice(0,2)` deckt für jedes
 *    Präfix denselben Namensraum ab wie eine Filterung über alle Einträge.
 *    Kontrolle: das früher abgetastete Suffixfenster `aa..dz` (104 Namen) —
 *    gemessen deckt es 100 % des Bestands, die Auflistung ist also eine
 *    Optimierung und keine Korrektur. Der Lader-Fix wirkte schon vorher.
 *
 * 4. **F18 — Inventarnamen.** Über die Spielstände der Installation: wie viele
 *    Inventarzeilen lösen mit der bereichskodierten Funktion auf, wie viele mit
 *    der alten einlistigen Auswahl. Leere Slots werden getrennt gezählt (sie
 *    bestehen jeden Test trivial).
 *
 * Urheberrecht: Ausgabe sind Zähler, Quoten und Formatbezeichner — kein
 * Werkinhalt, keine Rohbytes, keine Namenslisten.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(join(REAL_DIR, 'data', 'field')) && existsSync(join(REAL_DIR, 'data', 'wm'));

const q = (n: number, d: number): string => `${n}/${d} (${((n / Math.max(1, d)) * 100).toFixed(2)}%)`;

describe.skipIf(!available)('Realdaten: Demo-Verdrahtung (W1, F09-A, K1/K2, F18)', () => {
  it('W1: die TOC-Reihenfolge liefert NICHT wm0.ev — Mesh-Funktionen als Kontrolle', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/wm']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const bericht: Record<string, unknown>[] = [];
    let archiveGeprueft = 0;
    let tocGriffFalsch = 0;

    for (const archiv of ['world_us', 'world_gm', 'world_fr', 'world_sp']) {
      const eintraege = [...index.listEntries(archiv)];
      if (eintraege.length === 0) continue;
      archiveGeprueft++;
      const namen = eintraege.map((e) => e.name.toLowerCase());
      const ersterEv = namen.find((n) => n.endsWith('.ev')) ?? null;
      if (ersterEv !== 'wm0.ev') tocGriffFalsch++;

      // Mesh-Funktionen je Karte — die Kontrollgröße.
      const meshZahl: Record<string, number | null> = {};
      for (const ev of ['wm0.ev', 'wm2.ev', 'wm3.ev']) {
        const e = eintraege.find((x) => x.name.toLowerCase() === ev);
        if (!e) {
          meshZahl[ev] = null;
          continue;
        }
        const parsed = parseWorldEv(await index.readEntry(e.canonicalId));
        meshZahl[ev] = parsed.functions.filter((f) => f.type === 'mesh').length;
      }
      bericht.push({
        archiv,
        eintraege: namen.length,
        ersterEvInTocReihenfolge: ersterEv,
        tocPosition: ersterEv === null ? null : namen.indexOf(ersterEv),
        positionWm0Ev: namen.indexOf('wm0.ev'),
        meshFunktionen: meshZahl,
      });
    }
    await dir.closeAll();

    console.log('W1 — Weltscript-Paarung:\n' + JSON.stringify({ archiveGeprueft, tocGriffFalsch, bericht }, null, 1));

    expect(archiveGeprueft).toBeGreaterThan(0);
    // Der Defekt selbst: in JEDEM Archiv griff die alte Regel daneben.
    expect(tocGriffFalsch).toBe(archiveGeprueft);
    // Und die Karten sind an dieser Größe hart unterscheidbar — sonst wäre die
    // Verwechslung folgenlos gewesen.
    for (const b of bericht) {
      const m = b['meshFunktionen'] as Record<string, number | null>;
      expect(m['wm0.ev']).toBeGreaterThan(40);
      expect(m['wm2.ev'] ?? 0).toBeLessThan(m['wm0.ev']!);
    }
  });

  it('F09-A: neue MUSIC-Kette endet auf einer vorhandenen OGG-Datei, alte Regel nicht', async () => {
    const MUSIC_IDX = join(REAL_DIR, 'data', 'music', 'music.idx');
    const OGG_DIR = join(REAL_DIR, 'data', 'music_ogg');
    const musicNames = existsSync(MUSIC_IDX)
      ? new TextDecoder('latin1')
          .decode(await readFile(MUSIC_IDX))
          .split(/\r?\n/)
          .map((l) => l.trim())
      : [];
    const oggDa = new Map<string, boolean>();
    const hatOgg = (name: string | undefined): boolean => {
      if (!name) return false;
      const cached = oggDa.get(name);
      if (cached !== undefined) return cached;
      const da = existsSync(join(OGG_DIR, `${name}.ogg`));
      oggDa.set(name, da);
      return da;
    };

    const opLen = new Array<number>(256).fill(-1);
    for (const [op, l] of Object.entries(IMPL_OPERAND_LEN)) opLen[Number(op)] = l;
    for (const [op, l] of Object.entries(SKIP_OPERAND_LEN)) opLen[Number(op)] = l;
    const OP_MUSIC = 0xf0;

    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    let vorkommen = 0;
    let neuOgg = 0;
    let altOgg = 0;
    let operandNull = 0;
    let altStillNull = 0; // musicNames[operand−1] === undefined ⇒ es passierte NICHTS
    let altStillWeilUeberIdx = 0; // Operand > Zeilenzahl von music.idx
    let neuNichtAufloesbar = 0;
    const gruende = new Map<string, number>();
    const musicIds = new Set<number>();

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const bundle = parsed.bundle;
      const section1 = bundle?.rawSections[1];
      if (!parsed.ok || !bundle?.script || !section1) continue;

      const operanden: number[] = [];
      for (const s of bundle.script.spans) {
        if (s.end <= s.start) continue;
        let pc = s.start;
        let guard = 0;
        while (pc < s.end && ++guard < 100_000) {
          const op = section1[pc]!;
          if (op === OP_KAWAI) {
            const total = section1[pc + 1];
            if (total === undefined || total < 2) break;
            pc += total;
            continue;
          }
          const l = opLen[op] ?? -1;
          if (l < 0) break;
          if (op === OP_MUSIC && pc + 1 < section1.length) operanden.push(section1[pc + 1]!);
          pc += 1 + l;
        }
      }

      for (const operand of operanden) {
        vorkommen++;
        if (operand === 0) operandNull++;
        // ALT: der Operand galt als Zeile in music.idx (1-basiert).
        const altName = musicNames[operand - 1];
        if (altName === undefined) {
          altStillNull++;
          if (operand > 0) altStillWeilUeberIdx++;
        }
        if (hatOgg(altName)) altOgg++;
        // NEU: die volle Kette.
        const diags: FieldDiagnostic[] = [];
        const res = resolveFieldMusic(bundle.script.akaoOffsets, section1, operand, entry.name, diags);
        gruende.set(res.reason, (gruende.get(res.reason) ?? 0) + 1);
        if (res.musicIndex === null) {
          neuNichtAufloesbar++;
          continue;
        }
        musicIds.add(res.musicId!);
        if (hatOgg(musicNames[res.musicIndex])) neuOgg++;
      }
    }
    await dir.closeAll();

    console.log(
      'F09-A — MUSIC-Kette bis zur Datei:\n' +
        JSON.stringify(
          {
            musicIdxZeilen: musicNames.length,
            vorkommen,
            neuMitOgg: q(neuOgg, vorkommen),
            altMitOgg: q(altOgg, vorkommen),
            operandNull: q(operandNull, vorkommen),
            altStillNull: q(altStillNull, vorkommen),
            altStillWeilUeberIdx,
            neuNichtAufloesbar,
            verschiedeneMusicIds: musicIds.size,
            gruende: Object.fromEntries(gruende),
          },
          null,
          1,
        ),
    );

    expect(vorkommen).toBeGreaterThan(1000);
    // Die Aussage: die neue Kette landet fast immer auf einer spielbaren Datei,
    // die alte in weniger als der Hälfte der Fälle.
    expect(neuOgg / vorkommen).toBeGreaterThan(0.95);
    expect(altOgg / vorkommen).toBeLessThan(neuOgg / vorkommen);
    // Nullwerte separat gerechnet: bei Operand 0 war die alte Regel nicht
    // falsch, sondern STUMM (`musicNames[−1]` ist `undefined`) — genau das hat
    // den Defekt so lange verdeckt. Dazu kommen die Operanden oberhalb der
    // music.idx-Zeilenzahl, die ebenfalls ins Leere liefen.
    expect(altStillNull).toBe(operandNull + altStillWeilUeberIdx);
    expect(operandNull / vorkommen).toBeGreaterThan(0.5);
  });

  it('K1/K2: Präfixindex der Demo deckt denselben Namensraum wie die Vollfilterung', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const namen = index.listEntries('battle').map((e) => e.name.toLowerCase());
    await dir.closeAll();

    // Genau der Aufbau aus apps/demo/src/game/data.ts.
    const praefixIndex = new Map<string, string[]>();
    for (const n of namen) {
      if (n.length !== 4) continue;
      const p = n.slice(0, 2);
      let liste = praefixIndex.get(p);
      if (!liste) {
        liste = [];
        praefixIndex.set(p, liste);
      }
      liste.push(n);
    }

    let abweichungen = 0;
    let summeIndex = 0;
    for (const [p, liste] of praefixIndex) {
      const voll = namen.filter((n) => n.length === 4 && n.startsWith(p));
      summeIndex += liste.length;
      if (voll.length !== liste.length) abweichungen++;
    }
    /**
     * Kontrolle: das frühere Suffixfenster `aa..dz` (4 × 26 = 104 Namen je
     * Modell). GEMESSEN deckt es den Bestand vollständig ab — die Auflistung
     * ist damit eine **Optimierung, keine Korrektur**; sie spart 104 Lookups je
     * Modell, ändert aber am Ergebnis nichts. Das ist die ehrliche Lesart und
     * deckt sich mit der Aussage des Lader-Agenten („bit-identisch").
     */
    const fenster: string[] = [];
    for (const a of ['a', 'b', 'c', 'd']) for (let i = 0; i < 26; i++) fenster.push(a + String.fromCharCode(97 + i));
    let imFenster = 0;
    for (const [p, liste] of praefixIndex) {
      for (const n of liste) if (fenster.includes(n.slice(2))) imFenster++;
      void p;
    }

    console.log(
      'K1/K2 — Battle-Präfixindex:\n' +
        JSON.stringify(
          {
            eintraegeGesamt: namen.length,
            vierZeichenNamen: summeIndex,
            praefixe: praefixIndex.size,
            abweichungenGegenVollfilterung: abweichungen,
            imSuffixfensterAaBisDz: q(imFenster, summeIndex),
          },
          null,
          1,
        ),
    );

    expect(praefixIndex.size).toBeGreaterThan(100);
    expect(abweichungen).toBe(0);
  });

  it('F18: bereichskodierte Inventarnamen gegen die einlistige Altauswahl', async () => {
    const kernelPfad = join(REAL_DIR, 'data', 'kernel', 'KERNEL.BIN');
    if (!existsSync(kernelPfad)) return;
    const container = await parseKernelContainer(new Uint8Array(await readFile(kernelPfad)), 'kernel.bin');
    expect(container).not.toBeNull();
    const idx = indexKernelSections(container!);
    const listen = resolveKernelNameLists(idx);
    const neu = inventoryNameLookup(listen);
    // Altzustand: eine einzige Liste für den gesamten Bereich 0…319.
    const alt = itemNameLookup(pickItemTextLists(idx).names);

    let zeilen = 0;
    let leerSlots = 0;
    let neuTreffer = 0;
    let altTreffer = 0;
    const proBereich: Record<string, { zeilen: number; neu: number; alt: number }> = {};

    for (let s = 0; s < 15; s++) {
      const p = join(REAL_DIR, 'save', `save0${s}.ff7`);
      const p2 = join(REAL_DIR, `save0${s}.ff7`);
      const datei = existsSync(p) ? p : existsSync(p2) ? p2 : null;
      if (!datei) continue;
      const parsed = parseOriginalSave(new Uint8Array(await readFile(datei)), `save0${s}.ff7`);
      for (const slot of parsed?.slots ?? []) {
        if (!slot.occupied) continue;
        const map = readSavemap(slot.raw);
        for (const eintrag of map?.inventory ?? []) {
          if (eintrag.itemId >= 0x1ff || eintrag.count === 0) {
            leerSlots++;
            continue;
          }
          zeilen++;
          const bereich =
            eintrag.itemId <= 127
              ? 'item'
              : eintrag.itemId <= 255
                ? 'weapon'
                : eintrag.itemId <= 287
                  ? 'armor'
                  : 'accessory';
          const b = (proBereich[bereich] ??= { zeilen: 0, neu: 0, alt: 0 });
          b.zeilen++;
          if (neu(eintrag.itemId) !== null) {
            neuTreffer++;
            b.neu++;
          }
          if (alt(eintrag.itemId) !== null) {
            altTreffer++;
            b.alt++;
          }
        }
      }
    }

    console.log(
      'F18 — Inventarnamen über die Spielstände der Installation:\n' +
        JSON.stringify(
          {
            hinweis: listen.reason ?? 'zugeordnet',
            zeilen,
            leerSlotsGetrennt: leerSlots,
            neuAufgeloest: q(neuTreffer, zeilen),
            altAufgeloest: q(altTreffer, zeilen),
            proBereich,
          },
          null,
          1,
        ),
    );

    expect(listen.reason).toBeNull();
    if (zeilen > 0) expect(neuTreffer).toBeGreaterThanOrEqual(altTreffer);
  });
});
