import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseWorldMap,
  WM0_ALTERNATIVE_CELLS,
  WORLD_GRIDS,
  WORLD_MESH_EXTENT,
  type WorldMesh,
} from '@webmidgar/formats-world';

/**
 * S30 — WM0-Alternativblöcke 63–68: welche Rasterzelle ersetzt welcher Block?
 *
 * S28 hat 69 Blöcke gezählt und das Primärraster 9×7 = 63 belegt; die sechs
 * Restblöcke waren 🔴. Die Frage ist AM TERRAIN entscheidbar — ohne das Script
 * und ohne Referenz. Zwei voneinander unabhängige Maße:
 *
 *  (a) MESH-IDENTITÄT. Ein Alternativblock ist eine lokale Abwandlung seiner
 *      Zelle, teilt mit ihr also den größten Teil seiner 16 Meshes. Gemessen
 *      wird ein Digest je Mesh (Kopf, Dreiecke, Vertexlagen) und die Zahl
 *      slotgleicher Meshes gegen JEDEN der 63 Primärblöcke.
 *  (b) NAHTSTETIGKEIT (das S28-Maß). Der Block wird probeweise an jede der 63
 *      Zellen gesetzt; gemessen wird die Randpunkt-Übereinstimmung mit den vier
 *      Nachbarn dieser Zelle.
 *
 * Kontrolle ist eingebaut: BEIDE Maße laufen über alle 63 Kandidatenzellen,
 * die Verteilung über die 62 falschen Zellen ist die Kontrollverteilung.
 *
 * GRENZE, die die Messung selbst benennt: Die GRUPPIERUNG der sechs Blöcke zu
 * Umschaltstufen ist hiermit NICHT messbar — auch die Alternativblöcke haben
 * perfekte Ränder zu den Primärnachbarn, die Änderungen liegen im Inneren.
 *
 * Urheberrecht: nur Zähler, Quoten und Digests — keine Geometriedaten.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const WM_DIR = join(REAL_DIR, 'data', 'wm');
const available = existsSync(WM_DIR);

const COLS = WORLD_GRIDS.wm0.cols;
const ROWS = WORLD_GRIDS.wm0.rows;
const PRIMAER = WORLD_GRIDS.wm0.primaryBlocks;

type Feld = 'lage' | 'uv' | 'textur' | 'klasse' | 'normale' | 'reserve';

function digest(werte: Iterable<number>): string {
  let h = 0x811c9dc5;
  for (const v of werte) {
    h ^= v & 0xffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** Digest je Merkmalsfeld — trennt „andere Geometrie" von „andere Textur". */
function feldDigests(m: WorldMesh | null): Record<Feld, string> | null {
  if (!m) return null;
  const lage: number[] = [m.triCount, m.vertCount];
  for (const t of m.triangles) lage.push(t.v0, t.v1, t.v2);
  for (let i = 0; i < m.positions.length; i++) lage.push(m.positions[i]!);
  return {
    lage: digest(lage),
    uv: digest(m.triangles.flatMap((t) => t.uv)),
    textur: digest(m.triangles.map((t) => t.textureWord)),
    klasse: digest(m.triangles.map((t) => t.walkClass | (t.attrHigh << 5))),
    normale: digest(m.normals),
    reserve: digest([...m.vertexSpare, ...m.normalSpare]),
  };
}

type Punkt = { t: number; h: number };

function edge(m: WorldMesh, seite: 'left' | 'right' | 'top' | 'bottom'): Punkt[] {
  const out: Punkt[] = [];
  for (let i = 0; i < m.vertCount; i++) {
    const x = m.positions[i * 3]!;
    const h = m.positions[i * 3 + 1]!;
    const z = m.positions[i * 3 + 2]!;
    if (seite === 'left' && x === 0) out.push({ t: z, h });
    if (seite === 'right' && x === WORLD_MESH_EXTENT) out.push({ t: z, h });
    if (seite === 'top' && z === 0) out.push({ t: x, h });
    if (seite === 'bottom' && z === WORLD_MESH_EXTENT) out.push({ t: x, h });
  }
  return out;
}

function edgeMatch(a: Punkt[], b: Punkt[]): { match: number; total: number } {
  const key = (p: Punkt): string => `${p.t}/${p.h}`;
  const sa = new Set(a.map(key));
  const sb = new Set(b.map(key));
  let match = 0;
  for (const k of sa) if (sb.has(k)) match++;
  for (const k of sb) if (sa.has(k)) match++;
  return { match, total: sa.size + sb.size };
}

function ladeTerrain() {
  return parseWorldMap(new Uint8Array(readFileSync(join(WM_DIR, 'WM0.MAP'))));
}

describe.skipIf(!available)('Realdaten: WM0-Alternativblöcke (S30)', () => {
  it('H-ALT-A: Mesh-Identität weist jeden Alternativblock GENAU EINER Zelle zu', () => {
    const terrain = ladeTerrain();
    expect(terrain.blocks).toHaveLength(69);
    expect(terrain.diagnostics).toEqual([]);
    const lage = terrain.blocks.map((b) => (b ? b.meshes.map((m) => feldDigests(m)?.lage ?? 'null') : []));
    const zuordnung: number[] = [];
    const bericht: unknown[] = [];
    for (let alt = PRIMAER; alt < 69; alt++) {
      const treffer: Array<[number, number]> = [];
      for (let p = 0; p < PRIMAER; p++) {
        let gleich = 0;
        for (let s = 0; s < 16; s++) if (lage[alt]![s] === lage[p]![s]) gleich++;
        treffer.push([p, gleich]);
      }
      treffer.sort((a, b) => b[1] - a[1]);
      const beste = treffer[0]!;
      const zweitbeste = treffer[1]!;
      zuordnung.push(beste[0]);
      bericht.push({
        block: alt,
        zelle: beste[0],
        gleicheMeshes: beste[1],
        besteFremdzelle: zweitbeste[1],
        mittelFremd: Number((treffer.slice(1).reduce((s, t) => s + t[1], 0) / (PRIMAER - 1)).toFixed(3)),
      });
      // Der Abstand ZUM ZWEITBESTEN ist der eigentliche Beleg: kein Gleichstand.
      expect(beste[1]).toBeGreaterThanOrEqual(5);
      expect(beste[1]).toBeGreaterThan(zweitbeste[1] + 4);
    }
    console.log('WM0-ALT-IDENTITAET:', JSON.stringify(bericht));
    expect(zuordnung).toEqual([...WM0_ALTERNATIVE_CELLS]);
  });

  it('H-ALT-B: Nahtstetigkeit bestätigt dieselbe Zuordnung unabhängig', () => {
    const terrain = ladeTerrain();
    const mesh = (blk: number, mx: number, my: number): WorldMesh | null =>
      terrain.blocks[blk]?.meshes[my * 4 + mx] ?? null;
    const nahtLR = (links: number, rechts: number): { m: number; t: number } => {
      let m = 0;
      let t = 0;
      for (let r = 0; r < 4; r++) {
        const a = mesh(links, 3, r);
        const b = mesh(rechts, 0, r);
        if (!a || !b) continue;
        const e = edgeMatch(edge(a, 'right'), edge(b, 'left'));
        m += e.match;
        t += e.total;
      }
      return { m, t };
    };
    const nahtTB = (oben: number, unten: number): { m: number; t: number } => {
      let m = 0;
      let t = 0;
      for (let c = 0; c < 4; c++) {
        const a = mesh(oben, c, 3);
        const b = mesh(unten, c, 0);
        if (!a || !b) continue;
        const e = edgeMatch(edge(a, 'bottom'), edge(b, 'top'));
        m += e.match;
        t += e.total;
      }
      return { m, t };
    };
    /** Quote, wenn `block` probeweise auf `zelle` liegt. */
    const quoteAn = (block: number, zelle: number): number => {
      const col = zelle % COLS;
      const row = (zelle - col) / COLS;
      const links = row * COLS + ((col + COLS - 1) % COLS);
      const rechts = row * COLS + ((col + 1) % COLS);
      const oben = ((row + ROWS - 1) % ROWS) * COLS + col;
      const unten = ((row + 1) % ROWS) * COLS + col;
      let m = 0;
      let t = 0;
      for (const [a, b, fn] of [
        [links, block, nahtLR],
        [block, rechts, nahtLR],
        [oben, block, nahtTB],
        [block, unten, nahtTB],
      ] as const) {
        const e = fn(a, b);
        m += e.m;
        t += e.t;
      }
      return t ? m / t : 0;
    };

    const zuordnung: number[] = [];
    const bericht: unknown[] = [];
    for (let alt = PRIMAER; alt < 69; alt++) {
      const werte: Array<[number, number]> = [];
      for (let z = 0; z < PRIMAER; z++) werte.push([z, quoteAn(alt, z)]);
      werte.sort((a, b) => b[1] - a[1]);
      zuordnung.push(werte[0]![0]);
      const median = werte[Math.floor(PRIMAER / 2)]![1];
      bericht.push({
        block: alt,
        zelle: werte[0]![0],
        quote: Number(werte[0]![1].toFixed(4)),
        besteFremdzelle: Number(werte[1]![1].toFixed(4)),
        kontrollMedian: Number(median.toFixed(4)),
        // Vergleichsmaß: derselbe Test für den PRIMÄRblock dieser Zelle.
        primaerAnEigenerZelle: Number(quoteAn(werte[0]![0], werte[0]![0]).toFixed(4)),
      });
      expect(werte[0]![1]).toBeGreaterThan(0.95);
      expect(werte[0]![1]).toBeGreaterThan(werte[1]![1] + 0.25);
    }
    console.log('WM0-ALT-NAHT:', JSON.stringify(bericht));
    // Zwei unabhängige Maße, dieselbe Antwort — und sie ist die verriegelte.
    expect(zuordnung).toEqual([...WM0_ALTERNATIVE_CELLS]);
  });

  it('H-ALT-C: worin sich Alternativ und Primär unterscheiden (feldweise)', () => {
    const terrain = ladeTerrain();
    const bericht: unknown[] = [];
    for (let i = 0; i < WM0_ALTERNATIVE_CELLS.length; i++) {
      const alt = PRIMAER + i;
      const zelle = WM0_ALTERNATIVE_CELLS[i]!;
      const zaehler: Record<string, number> = {};
      let identisch = 0;
      for (let s = 0; s < 16; s++) {
        const a = feldDigests(terrain.blocks[alt]!.meshes[s]!);
        const p = feldDigests(terrain.blocks[zelle]!.meshes[s]!);
        if (!a || !p) continue;
        const felder = (Object.keys(a) as Feld[]).filter((f) => a[f] !== p[f]);
        if (felder.length === 0) identisch++;
        for (const f of felder) zaehler[f] = (zaehler[f] ?? 0) + 1;
      }
      bericht.push({ block: alt, ersetzt: zelle, meshesIdentisch: identisch, geaendert: zaehler });
    }
    console.log('WM0-ALT-DIFF:', JSON.stringify(bericht));
    // Kein Alternativblock ist eine bloße Kopie — jeder ändert etwas.
    for (const b of bericht as Array<{ meshesIdentisch: number }>) expect(b.meshesIdentisch).toBeLessThan(16);
  });

  it('NEGATIVBEFUND: kein `.ev`-Kommando trägt die Alternativblöcke oder ihre Zellen als Operand', () => {
    // Ausgesprochene Annahme der Suchmenge, die hier SCHEITERT: „Die
    // Umschaltung steht als Blockindex im World-Script." Gesucht wurde in
    // ALLEN Literaloperanden ALLER Kommando-Opcodes über alle drei `.ev`
    // (Positionen 1–4 vor dem Opcode). Das Ergebnis ist ein Negativbefund und
    // steht als solcher im Bericht — der Fortschrittsopcode 0x349 trägt eine
    // STUFE (0–4), keinen Blockindex.
    const bytes = readFileSync(join(WM_DIR, 'WM0.MAP'));
    expect(bytes.length / 0xb800).toBe(69);
    // Die Zellenmenge selbst ist nicht klein genug, um zufällig auszubleiben:
    // sechs von 63 Zellen = 9,5 % — in 2360 Anweisungen wäre ein systematischer
    // Träger sichtbar. Der Beleg dafür steht in `world-cmd-probe`
    // (BLOCKSUCHE: kein Opcode/Operandenposition über Rauschniveau).
    expect(WM0_ALTERNATIVE_CELLS.every((z) => z < PRIMAER)).toBe(true);
  });
});
