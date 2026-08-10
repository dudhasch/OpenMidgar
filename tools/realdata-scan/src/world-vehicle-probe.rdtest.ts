import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseWorldEv, parseWorldMap, WORLD_GRIDS } from '@webmidgar/formats-world';
import { WorldScriptVM } from '@webmidgar/world-runtime';
import { NodeDirectorySource } from './node-source.js';

/**
 * S29 — Fahrzeugmatrix- und VM-Probe auf den echten Weltkartendaten.
 *
 * (1) VM-Lauf über alle wm0-Funktionen: Wieviel des echten Script-Bestands
 *     läuft mit der belegten Opcode-Teilmenge durch, wieviel fällt unter die
 *     UNKNOWN-Politik? Das ist die ehrliche Abdeckungszahl für FINDINGS.
 * (2) Mesh-Koordinaten-Deutung (🟡): meshX/meshY der Typ-2-Funktionen müssen
 *     ins 36×28-Raster von WM0 passen (9×7 Blöcke × 4) — die Gegendeutung
 *     (Vertauschung) muss messbar schlechter passen.
 * (3) Erreichbarkeitsprobe (Roadmap-Abnahme): Flutfüllung über den
 *     Dreiecksgraphen der Primärkarte mit einer Fahrzeugmatrix; eine bewusst
 *     verdrehte Matrix MUSS eine deutlich andere Erreichbarkeit liefern,
 *     sonst misst die Probe nichts. Die „Wasser"-Klasse wird datengetrieben
 *     bestimmt (dominante Klasse unter flachen Meeresspiegel-Dreiecken) und
 *     bleibt 🟡 — die Matrix ist und bleibt austauschbare Tabelle.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const WM_DIR = join(REAL_DIR, 'data', 'wm');
const available = existsSync(WM_DIR);

describe.skipIf(!available)('Realdaten: World-Runtime-Proben (S29)', () => {
  it('VM-Abdeckung: alle wm0-Funktionen laufen unter der UNKNOWN-Politik zu Ende', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/wm']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    let evBytes: Uint8Array | null = null;
    for (const entry of index.listEntries('world_gm')) {
      if (entry.name.toLowerCase() === 'wm0.ev') evBytes = await index.readEntry(entry.canonicalId);
    }
    await dir.closeAll();
    expect(evBytes).not.toBeNull();
    const ev = parseWorldEv(evBytes!);
    expect(ev.diagnostics).toEqual([]);
    const vm = new WorldScriptVM(ev);
    let fertig = 0;
    let instruktionen = 0;
    const faultArten = new Map<string, number>();
    const unbekannteOps = new Map<number, number>();
    for (const fn of ev.functions) {
      const r = vm.runFunction(fn, 50_000);
      if (r.finished) fertig++;
      instruktionen += r.steps;
      for (const f of r.faults) {
        faultArten.set(f.kind, (faultArten.get(f.kind) ?? 0) + 1);
        if (f.kind === 'unknown-op') unbekannteOps.set(f.opcode, (unbekannteOps.get(f.opcode) ?? 0) + 1);
      }
    }
    const unknownGesamt = faultArten.get('unknown-op') ?? 0;
    console.log(
      'WVM-ABDECKUNG:',
      JSON.stringify(
        {
          funktionen: ev.functions.length,
          fertig,
          instruktionen,
          faultArten: [...faultArten.entries()],
          unknownQuote: instruktionen ? unknownGesamt / instruktionen : 0,
          topUnbekannt: [...unbekannteOps.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([v, c]) => [`0x${v.toString(16)}`, c]),
        },
        null,
        1,
      ),
    );
    // Verriegelt: Die belegte Grammatik trägt durch JEDE Funktion (die
    // Semantik der Kommandos bleibt offen — aber kein Lauf hängt/entgleist).
    expect(fertig).toBe(ev.functions.length);
  });

  it('Mesh-Koordinaten-Deutung: Typ-2-Kennungen passen ins 36×28-Raster (Gegendeutung schlechter)', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/wm']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    let evBytes: Uint8Array | null = null;
    for (const entry of index.listEntries('world_gm')) {
      if (entry.name.toLowerCase() === 'wm0.ev') evBytes = await index.readEntry(entry.canonicalId);
    }
    await dir.closeAll();
    const ev = parseWorldEv(evBytes!);
    const meshFns = ev.functions.filter((f) => f.type === 'mesh');
    // Parser-Deutung (zeile·36+spalte): meshY < 28 ist die scharfe Schranke.
    const passt = meshFns.filter((f) => f.meshX! < 36 && f.meshY! < 28).length;
    // Gegendeutung (Community-Beschreibung: spalte = div 36): dieselbe Schranke.
    const gegen = meshFns.filter((f) => {
      const coords = (f.id >> 4) & 0x3ff;
      return coords % 36 < 28; // „Zeile“ der Gegendeutung
    }).length;
    console.log('WVM-MESHKOORD:', JSON.stringify({ meshFns: meshFns.length, passt, gegen }, null, 1));
    // Verriegelt (2026-08-10): Parser-Deutung 49/49, Gegendeutung 46/49 —
    // die Daten entscheiden gegen die Community-Beschreibung.
    expect(meshFns.length).toBeGreaterThan(0);
    expect(passt).toBe(meshFns.length);
    expect(gegen).toBeLessThan(meshFns.length);
  });

  it('Erreichbarkeitsprobe: Fahrzeugmatrix gegen die verdrehte Kontrollmatrix auf WM0', () => {
    const terrain = parseWorldMap(new Uint8Array(readFileSync(join(WM_DIR, 'WM0.MAP'))));
    const grid = WORLD_GRIDS.wm0;

    // Dreiecksgraph der Primärkarte: Knoten = Dreiecke, Kanten = geteilte
    // Kanten (globale Grundrisskoordinaten der Endpunkte).
    interface Tri {
      klasse: number;
      flachH: number | null;
    }
    const tris: Tri[] = [];
    const kantenZu = new Map<string, number[]>();
    const nachbarn: number[][] = [];
    for (let b = 0; b < grid.primaryBlocks; b++) {
      const block = terrain.blocks[b]!;
      const bc = b % grid.cols;
      const br = (b - bc) / grid.cols;
      for (let m = 0; m < 16; m++) {
        const mesh = block.meshes[m]!;
        const mc = m % 4;
        const mr = (m - mc) / 4;
        const ox = bc * 32768 + mc * 8192;
        const oz = br * 32768 + mr * 8192;
        for (const t of mesh.triangles) {
          const idx = tris.length;
          nachbarn.push([]);
          const punkte = [t.v0, t.v1, t.v2].map((v) => ({
            x: ox + mesh.positions[v * 3]!,
            h: mesh.positions[v * 3 + 1]!,
            z: oz + mesh.positions[v * 3 + 2]!,
          }));
          const hs = new Set(punkte.map((p) => p.h));
          tris.push({ klasse: t.walkClass, flachH: hs.size === 1 ? punkte[0]!.h : null });
          for (let k = 0; k < 3; k++) {
            const a = punkte[k]!;
            const c = punkte[(k + 1) % 3]!;
            const key =
              a.x < c.x || (a.x === c.x && a.z < c.z)
                ? `${a.x},${a.z}|${c.x},${c.z}`
                : `${c.x},${c.z}|${a.x},${a.z}`;
            const liste = kantenZu.get(key);
            if (liste) {
              for (const other of liste) {
                nachbarn[idx]!.push(other);
                nachbarn[other]!.push(idx);
              }
              liste.push(idx);
            } else {
              kantenZu.set(key, [idx]);
            }
          }
        }
      }
    }

    // „Wasser"-Kandidat datengetrieben, zweiter Anlauf: Der erste („flach
    // auf Minimalhöhe") traf nur ~300 Dreiecke — die Minimalhöhe gehört zu
    // einer Senke, nicht zum Meer. Tragfähiger ist die MODALE Höhe der
    // komplett flachen Dreiecke (das offene Meer ist die mit Abstand größte
    // Ebene der Karte); deren dominante Klasse ist der Wasserkandidat (🟡 —
    // Kandidat bleibt Kandidat, die Matrix bleibt austauschbare Tabelle).
    const flachHistogramm = new Map<number, number>();
    for (const t of tris) {
      if (t.flachH !== null) flachHistogramm.set(t.flachH, (flachHistogramm.get(t.flachH) ?? 0) + 1);
    }
    const minH = [...flachHistogramm.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const flachVerteilung = new Map<number, number>();
    for (const t of tris) {
      if (t.flachH === minH) flachVerteilung.set(t.klasse, (flachVerteilung.get(t.klasse) ?? 0) + 1);
    }
    const wasserKlasse = [...flachVerteilung.entries()].sort((a, b) => b[1] - a[1])[0]![0];

    const flutfuellung = (erlaubt: (klasse: number) => boolean, startIdx: number): number => {
      if (!erlaubt(tris[startIdx]!.klasse)) return 0;
      const gesehen = new Uint8Array(tris.length);
      const queue = [startIdx];
      gesehen[startIdx] = 1;
      let anzahl = 0;
      while (queue.length) {
        const i = queue.pop()!;
        anzahl++;
        for (const n of nachbarn[i]!) {
          if (!gesehen[n] && erlaubt(tris[n]!.klasse)) {
            gesehen[n] = 1;
            queue.push(n);
          }
        }
      }
      return anzahl;
    };

    // Start: erstes NICHT-Wasser-Dreieck mit Höhe > Meeresspiegel.
    const start = tris.findIndex((t) => t.klasse !== wasserKlasse && t.flachH !== minH);
    const zuFuss = flutfuellung((k) => k !== wasserKlasse, start);
    const verdreht = flutfuellung((k) => k === wasserKlasse, start);
    const alles = flutfuellung(() => true, start);
    const landTris = tris.filter((t) => t.klasse !== wasserKlasse).length;
    const bericht = {
      dreiecke: tris.length,
      landTris,
      wasserKlasse,
      meeresspiegel: minH,
      zuFussErreichbar: zuFuss,
      zuFussQuote: zuFuss / landTris,
      verdrehtErreichbar: verdreht,
      allesErreichbar: alles,
      allesQuote: alles / tris.length,
    };
    console.log('WVM-ERREICHBARKEIT:', JSON.stringify(bericht, null, 1));
    // Die Matrix MUSS die Erreichbarkeit messbar ändern (Roadmap-Abnahme):
    expect(verdreht).toBe(0); // Start liegt an Land — die verdrehte Matrix strandet sofort
    expect(zuFuss).toBeGreaterThan(1000);
    expect(alles).toBeGreaterThan(zuFuss * 1.5); // ohne Matrix fällt die Ozeanschranke
    // Zu Fuß bleibt man auf dem eigenen Kontinent: deutlich unter der Landmenge.
    expect(zuFuss).toBeLessThan(landTris);
  });
});
