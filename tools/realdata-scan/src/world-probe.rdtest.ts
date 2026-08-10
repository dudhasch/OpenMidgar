import 'fake-indexeddb/auto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decompressLzs } from '@webmidgar/formats-field';

/**
 * S28 — Weltkarten-Probe (VOR jeder Parserzeile, Methodik-Standard seit S7).
 *
 * Gegenstand: `data/wm` der lokalen Installation — WM0/WM2/WM3 jeweils als
 * `.MAP` und `.BOT`, dazu vier Sprach-LGPs. Erste Accounting-Beobachtung
 * (Verzeichnislisting): ALLE sechs Dateien sind exakte Vielfache von 0xB800
 * (47104 B) — WM0.MAP 69, WM2.MAP 12, WM3.MAP 4, WM0.BOT 332, WM2.BOT 48,
 * WM3.BOT 16 Blöcke.
 *
 * Hypothesen (Quelle: FFNx / ff7-landscaper / Qhimm als HYPOTHESENGEBER,
 * belegt wird ausschließlich gegen die eigenen Daten — Zusatzregel 4):
 *  - H-BLK: Jeder 0xB800-Block beginnt mit 16 u32-Offsets (blockrelativ,
 *    erster = 0x40) auf LZS-komprimierte Meshes (u32 Länge + Strom).
 *  - H-MESH: Dekomprimiert: u16 triCount · u16 vertCount · tri[12 B je] ·
 *    vert[8 B je] · normal[8 B je] — byteexakt aufgehend.
 *  - H-GRID: Block = 4×4 Meshes, Mesh-Grundriss 8192×8192 Einheiten lokal
 *    (x und z begrenzt, y = Höhe frei).
 *  - H-WALK: Begehbarkeit liegt in den unteren 5 Bits von Dreiecks-Byte 3.
 *    (Ausgesprochene Annahme der Suchmenge: Die Geländeklasse steht IM
 *    Dreieck — läge sie in einer separaten Tabelle oder der EXE, misst die
 *    Attributprobe nur Rauschen. Deshalb wird hier nur die WerteVIELFALT
 *    berichtet, keine Semantik behauptet.)
 *  - H-BOT: unbekannt. Erst wird die Suche an WM0.MAP validiert (S37-Lehre:
 *    ein Negativbefund braucht eine validierte Suche), dann dieselben
 *    Strukturtests auf .BOT.
 *
 * Kontrollen: um 2 Byte verschobene Offsettabelle; falsche Blockgröße
 * (0xB000); Nahtstetigkeit gegen zufällige Fremdpaare; Nullwert-
 * Zweitrechnung über Wasser-/Flachmeshes.
 *
 * Urheberrecht: ausschließlich Zähler, Quoten, Wertebereiche und Digests —
 * keine Rohbytes, keine Koordinatenlisten.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const WM_DIR = join(REAL_DIR, 'data', 'wm');
const available = existsSync(WM_DIR);

const BLOCK = 0xb800;
const MESHES_PER_BLOCK = 16;
const TABLE_BYTES = MESHES_PER_BLOCK * 4;

interface MeshParse {
  ok: boolean;
  reason?: string;
  triCount?: number;
  vertCount?: number;
  decompressedLen?: number;
  expectedLen?: number;
  tris?: Uint8Array;
  verts?: DataView;
}

function parseBlockTable(block: Uint8Array, tableOffset = 0): { ok: boolean; offsets: number[]; reason?: string } {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const offsets: number[] = [];
  for (let i = 0; i < MESHES_PER_BLOCK; i++) {
    if (tableOffset + i * 4 + 4 > block.length) return { ok: false, offsets, reason: 'Tabelle über Blockende' };
    offsets.push(view.getUint32(tableOffset + i * 4, true));
  }
  for (let i = 0; i < offsets.length; i++) {
    const o = offsets[i]!;
    if (o < TABLE_BYTES || o >= BLOCK) return { ok: false, offsets, reason: `Offset ${i} außerhalb (${o})` };
    if (i > 0 && o < offsets[i - 1]!) return { ok: false, offsets, reason: `Offset ${i} nicht monoton` };
  }
  return { ok: true, offsets };
}

function parseMesh(block: Uint8Array, offset: number): MeshParse {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  if (offset + 4 > block.length) return { ok: false, reason: 'Längenwort über Blockende' };
  const compressed = view.getUint32(offset, true);
  if (offset + 4 + compressed > block.length) return { ok: false, reason: 'Strom über Blockende' };
  let decompressed: Uint8Array;
  try {
    decompressed = decompressLzs(block.subarray(offset + 4, offset + 4 + compressed));
  } catch (e) {
    return { ok: false, reason: `LZS: ${(e as Error).message}` };
  }
  if (decompressed.length < 4) return { ok: false, reason: 'kürzer als Kopf' };
  const d = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
  const triCount = d.getUint16(0, true);
  const vertCount = d.getUint16(2, true);
  const expectedLen = 4 + triCount * 12 + vertCount * 8 + vertCount * 8;
  return {
    ok: true,
    triCount,
    vertCount,
    decompressedLen: decompressed.length,
    expectedLen,
    tris: decompressed.subarray(4, 4 + triCount * 12),
    verts: new DataView(decompressed.buffer, decompressed.byteOffset + 4 + triCount * 12, vertCount * 8),
  };
}

interface EdgePoint {
  t: number; // Position entlang der Kante
  h: number; // Höhe
}

/** Randpunkte eines Meshes an einer der vier Kanten (lokale Koordinaten). */
function edgePoints(mesh: MeshParse, edge: 'left' | 'right' | 'top' | 'bottom', extent: number): EdgePoint[] {
  const pts: EdgePoint[] = [];
  const v = mesh.verts!;
  for (let i = 0; i < mesh.vertCount!; i++) {
    const x = v.getInt16(i * 8, true);
    const h = v.getInt16(i * 8 + 2, true);
    const z = v.getInt16(i * 8 + 4, true);
    if (edge === 'left' && x === 0) pts.push({ t: z, h });
    if (edge === 'right' && x === extent) pts.push({ t: z, h });
    if (edge === 'top' && z === 0) pts.push({ t: x, h });
    if (edge === 'bottom' && z === extent) pts.push({ t: x, h });
  }
  return pts.sort((a, b) => a.t - b.t || a.h - b.h);
}

/** Vergleich zweier Kantenpunktlisten: Anteil deckungsgleicher (t,h)-Paare. */
function edgeMatch(a: EdgePoint[], b: EdgePoint[]): { match: number; total: number } {
  const key = (p: EdgePoint): string => `${p.t}:${p.h}`;
  const setB = new Map<string, number>();
  for (const p of b) setB.set(key(p), (setB.get(key(p)) ?? 0) + 1);
  let match = 0;
  for (const p of a) {
    const c = setB.get(key(p)) ?? 0;
    if (c > 0) {
      match++;
      setB.set(key(p), c - 1);
    }
  }
  return { match, total: Math.max(a.length, b.length) };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!available)('Realdaten: Weltkarten-Probe (S28)', () => {
  it('Inventar: data/wm vollständig als 0xB800-Blöcke; Original-/Overlay-Trennung berichtet', () => {
    const files = readdirSync(WM_DIR).map((name) => {
      const size = statSync(join(WM_DIR, name)).size;
      return { name, size, blocks: size % BLOCK === 0 ? size / BLOCK : null };
    });
    const overlayKandidaten = ['mods', 'direct'].map((d) => ({
      dir: d,
      vorhanden: existsSync(join(REAL_DIR, d)),
      wmInhalt:
        existsSync(join(REAL_DIR, d)) &&
        readdirSync(join(REAL_DIR, d), { recursive: true })
          .map(String)
          .some((p) => p.toLowerCase().includes('wm') || p.toLowerCase().includes('world')),
    }));
    console.log('WM-INVENTAR:', JSON.stringify({ files, overlayKandidaten }, null, 1));
    const mapBot = files.filter((f) => /\.(MAP|BOT)$/i.test(f.name));
    expect(mapBot.length).toBe(6);
    // Killerbeobachtung: alle .MAP/.BOT sind exakte Blockvielfache.
    for (const f of mapBot) expect(f.blocks).not.toBeNull();
  });

  it('H-BLK/H-MESH: Blockzerlegung und Mesh-Grammatik per Accounting, gegen verschobene Kontrolle', () => {
    const bericht: Record<string, unknown> = {};
    for (const name of ['WM0.MAP', 'WM2.MAP', 'WM3.MAP']) {
      const bytes = new Uint8Array(readFileSync(join(WM_DIR, name)));
      const blocks = bytes.length / BLOCK;
      let tabellenOk = 0;
      let tabellenKontrolleOk = 0; // um +2 Byte verschoben gelesen
      let meshOk = 0;
      let meshExakt = 0; // decompressedLen === expectedLen
      let meshGesamt = 0;
      let erstOffset0x40 = 0;
      const fehlgruende = new Map<string, number>();
      for (let b = 0; b < blocks; b++) {
        const block = bytes.subarray(b * BLOCK, (b + 1) * BLOCK);
        const table = parseBlockTable(block);
        if (table.ok) tabellenOk++;
        if (parseBlockTable(block, 2).ok) tabellenKontrolleOk++;
        if (table.offsets[0] === TABLE_BYTES) erstOffset0x40++;
        if (!table.ok) continue;
        for (const off of table.offsets) {
          meshGesamt++;
          const m = parseMesh(block, off);
          if (!m.ok) {
            fehlgruende.set(m.reason!, (fehlgruende.get(m.reason!) ?? 0) + 1);
            continue;
          }
          meshOk++;
          if (m.decompressedLen === m.expectedLen) meshExakt++;
        }
      }
      bericht[name] = {
        blocks,
        tabellenOk,
        tabellenKontrolleOk,
        erstOffset0x40,
        meshGesamt,
        meshOk,
        meshExakt,
        fehlgruende: [...fehlgruende.entries()],
      };
    }
    console.log('WM-BLOCKPROBE:', JSON.stringify(bericht, null, 1));
    // Verriegelte Fakten (gemessen 2026-08-10): 85/85 Tabellen, Kontrolle
    // 0/85, ALLE 1360 Meshes dekomprimierbar und byteexakt aufgehend —
    // Lochquote 0. Jede künftige Abweichung ist ein Regressionsbefund.
    for (const name of ['WM0.MAP', 'WM2.MAP', 'WM3.MAP']) {
      const r = bericht[name] as { blocks: number; tabellenOk: number; tabellenKontrolleOk: number; erstOffset0x40: number; meshGesamt: number; meshOk: number; meshExakt: number };
      expect(r.tabellenOk).toBe(r.blocks);
      expect(r.tabellenKontrolleOk).toBe(0);
      expect(r.erstOffset0x40).toBe(r.blocks);
      expect(r.meshGesamt).toBe(r.blocks * MESHES_PER_BLOCK);
      expect(r.meshOk).toBe(r.meshGesamt);
      expect(r.meshExakt).toBe(r.meshGesamt);
    }
  });

  it('H-GRID: Koordinatenraster (x/z begrenzt, y frei) + Wertevielfalt der Dreiecksattribute (H-WALK)', () => {
    const bytes = new Uint8Array(readFileSync(join(WM_DIR, 'WM0.MAP')));
    const blocks = bytes.length / BLOCK;
    let xzInnerhalb8192 = 0;
    let meshes = 0;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    let minH = Infinity;
    let maxH = -Infinity;
    const walkWerte = new Map<number, number>();
    const oberBits = new Map<number, number>();
    for (let b = 0; b < blocks; b++) {
      const block = bytes.subarray(b * BLOCK, (b + 1) * BLOCK);
      const table = parseBlockTable(block);
      if (!table.ok) continue;
      for (const off of table.offsets) {
        const m = parseMesh(block, off);
        if (!m.ok || m.decompressedLen !== m.expectedLen) continue;
        meshes++;
        let lokalOk = true;
        for (let i = 0; i < m.vertCount!; i++) {
          const x = m.verts!.getInt16(i * 8, true);
          const h = m.verts!.getInt16(i * 8 + 2, true);
          const z = m.verts!.getInt16(i * 8 + 4, true);
          if (x < 0 || x > 8192 || z < 0 || z > 8192) lokalOk = false;
          maxX = Math.max(maxX, x);
          maxZ = Math.max(maxZ, z);
          minH = Math.min(minH, h);
          maxH = Math.max(maxH, h);
        }
        if (lokalOk) xzInnerhalb8192++;
        for (let t = 0; t < m.triCount!; t++) {
          const attr = m.tris![t * 12 + 3]!;
          walkWerte.set(attr & 0x1f, (walkWerte.get(attr & 0x1f) ?? 0) + 1);
          oberBits.set(attr >> 5, (oberBits.get(attr >> 5) ?? 0) + 1);
        }
      }
    }
    console.log(
      'WM-RASTERPROBE:',
      JSON.stringify(
        {
          meshes,
          xzInnerhalb8192,
          maxX,
          maxZ,
          minH,
          maxH,
          walkKlassen: [...walkWerte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40),
          oberBits: [...oberBits.entries()].sort((a, b) => b[1] - a[1]),
        },
        null,
        1,
      ),
    );
    expect(meshes).toBeGreaterThan(0);
  });

  it('Nahtstetigkeit: benachbarte Meshes teilen Randhöhen; Kontrolle = zufällige Fremdpaare; Nullmesh-Zweitrechnung', () => {
    const bytes = new Uint8Array(readFileSync(join(WM_DIR, 'WM0.MAP')));
    const blocks = bytes.length / BLOCK;
    // Meshes je Block als 4×4-Raster deuten (H-GRID); Kantenmaß aus der Probe
    // davor: lokale Spannweite 0..8192 je Mesh ODER 0..2048 — gemessen wird
    // gegen die tatsächliche maximale Ausdehnung.
    const meshesJeBlock: MeshParse[][] = [];
    let extent = 0;
    for (let b = 0; b < blocks; b++) {
      const block = bytes.subarray(b * BLOCK, (b + 1) * BLOCK);
      const table = parseBlockTable(block);
      const list: MeshParse[] = [];
      if (table.ok) {
        for (const off of table.offsets) {
          const m = parseMesh(block, off);
          list.push(m);
          if (m.ok && m.decompressedLen === m.expectedLen) {
            for (let i = 0; i < m.vertCount!; i++) {
              extent = Math.max(extent, m.verts!.getInt16(i * 8, true), m.verts!.getInt16(i * 8 + 4, true));
            }
          }
        }
      }
      meshesJeBlock.push(list);
    }

    let nachbarPaare = 0;
    let nachbarQuoteSumme = 0;
    let nachbarPerfekt = 0;
    let leereKanten = 0;
    let flachePaare = 0; // beide Kanten komplett auf einer Höhe (Wasser/Ebene)
    const quoteFlach: number[] = [];
    const quoteStrukturiert: number[] = [];
    for (let b = 0; b < blocks; b++) {
      for (let m = 0; m < MESHES_PER_BLOCK; m++) {
        const col = m % 4;
        const row = (m - col) / 4;
        const me = meshesJeBlock[b]![m]!;
        if (!me.ok || me.decompressedLen !== me.expectedLen) continue;
        // rechter Nachbar im selben Block
        if (col < 3) {
          const nb = meshesJeBlock[b]![m + 1]!;
          if (nb.ok && nb.decompressedLen === nb.expectedLen) {
            const a = edgePoints(me, 'right', extent);
            const bb = edgePoints(nb, 'left', extent);
            if (a.length === 0 || bb.length === 0) {
              leereKanten++;
            } else {
              const { match, total } = edgeMatch(a, bb);
              const quote = match / total;
              nachbarPaare++;
              nachbarQuoteSumme += quote;
              if (quote === 1) nachbarPerfekt++;
              const flach = new Set([...a, ...bb].map((p) => p.h)).size === 1;
              if (flach) {
                flachePaare++;
                quoteFlach.push(quote);
              } else {
                quoteStrukturiert.push(quote);
              }
            }
          }
        }
      }
    }

    // Kontrolle: zufällige NICHT benachbarte Paare mit demselben Maß.
    const rnd = mulberry32(0x57e0);
    let kontrollPaare = 0;
    let kontrollQuoteSumme = 0;
    while (kontrollPaare < 300) {
      const b1 = Math.floor(rnd() * blocks);
      const b2 = Math.floor(rnd() * blocks);
      const m1 = Math.floor(rnd() * MESHES_PER_BLOCK);
      const m2 = Math.floor(rnd() * MESHES_PER_BLOCK);
      if (b1 === b2 && Math.abs(m1 - m2) <= 1) continue;
      const a = meshesJeBlock[b1]![m1]!;
      const c = meshesJeBlock[b2]![m2]!;
      if (!a.ok || !c.ok || a.decompressedLen !== a.expectedLen || c.decompressedLen !== c.expectedLen) continue;
      const pa = edgePoints(a, 'right', extent);
      const pc = edgePoints(c, 'left', extent);
      if (pa.length === 0 || pc.length === 0) continue;
      const { match, total } = edgeMatch(pa, pc);
      kontrollPaare++;
      kontrollQuoteSumme += match / total;
    }

    const mittel = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    const bericht = {
      extent,
      nachbarPaare,
      nachbarQuote: nachbarPaare ? nachbarQuoteSumme / nachbarPaare : 0,
      nachbarPerfekt,
      leereKanten,
      flachePaare,
      quoteOhneFlache: mittel(quoteStrukturiert),
      strukturiertePaare: quoteStrukturiert.length,
      kontrollPaare,
      kontrollQuote: kontrollPaare ? kontrollQuoteSumme / kontrollPaare : 0,
    };
    console.log('WM-NAHTPROBE:', JSON.stringify(bericht, null, 1));
    // Verriegelt: 828/828 Nachbarpaare perfekt (Quote 1,0), auch ohne die
    // 541 Flachpaare (Nullwert-Zweitrechnung: 287 strukturierte Paare, 1,0);
    // Kontrolle (Fremdpaare) deutlich darunter.
    expect(nachbarPaare).toBeGreaterThan(100);
    expect(nachbarPerfekt).toBe(nachbarPaare);
    expect(mittel(quoteStrukturiert)).toBe(1);
    expect(quoteStrukturiert.length).toBeGreaterThan(100);
    expect(bericht.kontrollQuote).toBeLessThan(0.9);
  });

  it('Blockanordnung: 9×7-Raster gegen die Kontrollanordnung 7×9, gemessen an Blockgrenz-Nähten', () => {
    // Annahme (H-GRID09): Die ersten 63 Blöcke von WM0.MAP sind ein Raster
    // von 9 Spalten × 7 Zeilen (Rest = 6 Alternativblöcke). Messbar, ohne
    // irgendetwas zu glauben: An einer echten Blockgrenze müssen die Nähte
    // genauso perfekt sein wie innerhalb eines Blocks. Kontrolle: dieselbe
    // Messung unter der Anordnung 7 Spalten × 9 Zeilen.
    const bytes = new Uint8Array(readFileSync(join(WM_DIR, 'WM0.MAP')));
    const blocks = 63; // nur das Primärraster; Alternativblöcke bleiben außen vor
    const meshes: MeshParse[][] = [];
    for (let b = 0; b < blocks; b++) {
      const block = bytes.subarray(b * BLOCK, (b + 1) * BLOCK);
      const table = parseBlockTable(block);
      meshes.push(table.ok ? table.offsets.map((off) => parseMesh(block, off)) : []);
    }
    const quoteFuerBreite = (breite: number): { quote: number; paare: number } => {
      const zeilen = blocks / breite;
      let summe = 0;
      let paare = 0;
      for (let b = 0; b < blocks; b++) {
        const col = b % breite;
        const row = (b - col) / breite;
        // rechte Blockgrenze
        if (col < breite - 1) {
          for (let r = 0; r < 4; r++) {
            const a = meshes[b]![r * 4 + 3];
            const c = meshes[b + 1]![r * 4];
            if (!a?.ok || !c?.ok) continue;
            const pa = edgePoints(a, 'right', 8192);
            const pc = edgePoints(c, 'left', 8192);
            if (pa.length === 0 || pc.length === 0) continue;
            const { match, total } = edgeMatch(pa, pc);
            summe += match / total;
            paare++;
          }
        }
        // untere Blockgrenze
        if (row < zeilen - 1) {
          for (let cIdx = 0; cIdx < 4; cIdx++) {
            const a = meshes[b]![3 * 4 + cIdx];
            const c = meshes[b + breite]![cIdx];
            if (!a?.ok || !c?.ok) continue;
            const pa = edgePoints(a, 'bottom', 8192);
            const pc = edgePoints(c, 'top', 8192);
            if (pa.length === 0 || pc.length === 0) continue;
            const { match, total } = edgeMatch(pa, pc);
            summe += match / total;
            paare++;
          }
        }
      }
      return { quote: paare ? summe / paare : 0, paare };
    };
    const breite9 = quoteFuerBreite(9);
    const breite7 = quoteFuerBreite(7);
    console.log('WM-RASTER63:', JSON.stringify({ breite9, breite7 }, null, 1));

    // Dieselbe Messung für WM2 (12 Blöcke) und WM3 (4 Blöcke) über alle
    // Teilerbreiten — das Ergebnis bestimmt die Grid-Konstanten des Parsers.
    for (const [name, blockZahl, breiten] of [
      ['WM2.MAP', 12, [2, 3, 4, 6]],
      ['WM3.MAP', 4, [1, 2, 4]],
    ] as const) {
      const bytesN = new Uint8Array(readFileSync(join(WM_DIR, name)));
      const meshesN: MeshParse[][] = [];
      for (let b = 0; b < blockZahl; b++) {
        const block = bytesN.subarray(b * BLOCK, (b + 1) * BLOCK);
        const table = parseBlockTable(block);
        meshesN.push(table.ok ? table.offsets.map((off) => parseMesh(block, off)) : []);
      }
      const probiere = (breite: number): { quote: number; paare: number } => {
        const zeilen = blockZahl / breite;
        let summe = 0;
        let paare = 0;
        for (let b = 0; b < blockZahl; b++) {
          const col = b % breite;
          const row = (b - col) / breite;
          if (col < breite - 1) {
            for (let r = 0; r < 4; r++) {
              const a = meshesN[b]![r * 4 + 3];
              const c = meshesN[b + 1]![r * 4];
              if (!a?.ok || !c?.ok) continue;
              const pa = edgePoints(a, 'right', 8192);
              const pc = edgePoints(c, 'left', 8192);
              if (pa.length === 0 || pc.length === 0) continue;
              const m = edgeMatch(pa, pc);
              summe += m.match / m.total;
              paare++;
            }
          }
          if (row < zeilen - 1) {
            for (let cI = 0; cI < 4; cI++) {
              const a = meshesN[b]![12 + cI];
              const c = meshesN[b + breite]![cI];
              if (!a?.ok || !c?.ok) continue;
              const pa = edgePoints(a, 'bottom', 8192);
              const pc = edgePoints(c, 'top', 8192);
              if (pa.length === 0 || pc.length === 0) continue;
              const m = edgeMatch(pa, pc);
              summe += m.match / m.total;
              paare++;
            }
          }
        }
        return { quote: paare ? summe / paare : 0, paare };
      };
      const ergebnisse = Object.fromEntries(breiten.map((w) => [`breite${w}`, probiere(w)]));
      console.log(`WM-RASTER-${name}:`, JSON.stringify(ergebnisse, null, 1));
    }
    // Verriegelt: 9×7 perfekt (1,0 über 440 Paare), 7×9 deutlich darunter
    // (0,764 — nicht zufällig hoch: Ozeanflächen matchen trivial).
    expect(breite9.paare).toBeGreaterThan(100);
    expect(breite9.quote).toBe(1);
    expect(breite7.quote).toBeLessThan(0.9);
  });

  it('H-BOT: Suche an WM0.MAP validieren, dann dieselben Strukturtests auf den .BOT-Dateien', () => {
    // Validierung der Suche (S37-Lehre): auf WM0.MAP MUSS der Tabellentest
    // anschlagen, sonst ist jeder .BOT-Negativbefund wertlos.
    const map0 = new Uint8Array(readFileSync(join(WM_DIR, 'WM0.MAP')));
    expect(parseBlockTable(map0.subarray(0, BLOCK)).ok).toBe(true);

    const bericht: Record<string, unknown> = {};
    for (const name of ['WM0.BOT', 'WM2.BOT', 'WM3.BOT']) {
      const bytes = new Uint8Array(readFileSync(join(WM_DIR, name)));
      const blocks = bytes.length / BLOCK;
      let tabellenOk = 0;
      let meshOk = 0;
      let meshExakt = 0;
      // Zweithypothese: .BOT trägt dieselben Meshes UNkomprimiert — dann
      // müsste ein Blockanfang direkt als Mesh-Kopf lesbar sein.
      let unkomprimiertPlausibel = 0;
      for (let b = 0; b < blocks; b++) {
        const block = bytes.subarray(b * BLOCK, (b + 1) * BLOCK);
        const table = parseBlockTable(block);
        if (table.ok) {
          tabellenOk++;
          for (const off of table.offsets) {
            const m = parseMesh(block, off);
            if (m.ok) {
              meshOk++;
              if (m.decompressedLen === m.expectedLen) meshExakt++;
            }
          }
        }
        const v = new DataView(block.buffer, block.byteOffset, block.byteLength);
        const tri = v.getUint16(0, true);
        const vert = v.getUint16(2, true);
        if (tri > 0 && tri < 2000 && vert > 0 && vert < 2000 && 4 + tri * 12 + vert * 16 <= block.length) {
          unkomprimiertPlausibel++;
        }
      }
      bericht[name] = { blocks, tabellenOk, meshOk, meshExakt, unkomprimiertPlausibel };
    }
    console.log('WM-BOTPROBE:', JSON.stringify(bericht, null, 1));
  });

  it('MAP↔BOT-Beziehung: Digest-Kreuzvergleich der dekomprimierten Meshes', () => {
    // Frage: Sind die .BOT-Meshes dieselben wie die .MAP-Meshes (Teilmenge /
    // Obermenge / disjunkt)? Gemessen über FNV-Digests der dekomprimierten
    // Meshbytes — assetfrei, nur Zähler im Bericht.
    const digest = (bytes: Uint8Array): string => {
      let h = 0xcbf29ce484222325n;
      const prime = 0x100000001b3n;
      const mask = 0xffffffffffffffffn;
      for (const b of bytes) {
        h ^= BigInt(b);
        h = (h * prime) & mask;
      }
      return h.toString(16);
    };
    const meshDigests = (name: string): { list: string[]; positionen: Map<string, number[]> } => {
      const bytes = new Uint8Array(readFileSync(join(WM_DIR, name)));
      const blocks = bytes.length / BLOCK;
      const list: string[] = [];
      const positionen = new Map<string, number[]>();
      for (let b = 0; b < blocks; b++) {
        const block = bytes.subarray(b * BLOCK, (b + 1) * BLOCK);
        const table = parseBlockTable(block);
        if (!table.ok) continue;
        for (const off of table.offsets) {
          const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
          const compressed = view.getUint32(off, true);
          const d = decompressLzs(block.subarray(off + 4, off + 4 + compressed));
          const dg = digest(d);
          const meshIndex = list.length;
          list.push(dg);
          const at = positionen.get(dg) ?? [];
          at.push(meshIndex);
          positionen.set(dg, at);
        }
      }
      return { list, positionen };
    };
    const bericht: Record<string, unknown> = {};
    for (const [mapName, botName] of [
      ['WM0.MAP', 'WM0.BOT'],
      ['WM2.MAP', 'WM2.BOT'],
      ['WM3.MAP', 'WM3.BOT'],
    ] as const) {
      const map = meshDigests(mapName);
      const bot = meshDigests(botName);
      const botSet = new Set(bot.list);
      const mapInBot = map.list.filter((d) => botSet.has(d)).length;
      const mapSet = new Set(map.list);
      const botInMap = bot.list.filter((d) => mapSet.has(d)).length;
      // Positionsdeutung für den 1:N-Fall: taucht Map-Mesh i an Bot-Position
      // i + k·mapLänge auf (Wiederholung ganzer Karten) oder verstreut?
      const wiederholungGanzerKarte = ((): boolean => {
        if (bot.list.length % map.list.length !== 0) return false;
        for (let i = 0; i < map.list.length; i++) {
          for (let k = 0; k * map.list.length + i < bot.list.length; k++) {
            if (bot.list[k * map.list.length + i] !== map.list[i]) return false;
          }
        }
        return true;
      })();
      bericht[mapName] = {
        mapMeshes: map.list.length,
        botMeshes: bot.list.length,
        mapUnikate: mapSet.size,
        botUnikate: botSet.size,
        mapInBot,
        botInMap,
        wiederholungGanzerKarte,
      };
      // Verriegelt: MAP und BOT tragen exakt dieselben Unikatmengen — die
      // .BOT-Dateien enthalten KEINE eigene Geometrie (nur eine andere
      // Anordnung derselben Meshes; ihr Zweck bleibt 🟡).
      expect(mapInBot).toBe(map.list.length);
      expect(botInMap).toBe(bot.list.length);
      expect(mapSet.size).toBe(botSet.size);
    }
    console.log('WM-MAPBOT:', JSON.stringify(bericht, null, 1));
  });

  it('Sprach-LGPs: Inventar nach Endungen, TOC-Gleichheit über die vier Sprachen', () => {
    // Roh-TOC-Vergleich über Dateigrößen + Byteidentität der ganzen Archive:
    // Sind die vier Sprachdateien überhaupt verschieden?
    const namen = ['world_us.lgp', 'world_gm.lgp', 'world_fr.lgp', 'world_sp.lgp'];
    const bytes = namen.map((n) => new Uint8Array(readFileSync(join(WM_DIR, n))));
    const gleichGross = bytes.every((b) => b.length === bytes[0]!.length);
    let identisch = true;
    if (gleichGross) {
      const a = bytes[0]!;
      for (let i = 1; i < bytes.length && identisch; i++) {
        const b = bytes[i]!;
        for (let j = 0; j < a.length; j += 4093) {
          if (a[j] !== b[j]) {
            identisch = false;
            break;
          }
        }
      }
    }
    console.log('WM-LGP:', JSON.stringify({ gleichGross, stichprobeIdentisch: identisch }, null, 1));
  });

  it('formats-world-Parser gegen den Bestand: 85/85 Blöcke, 1360/1360 Meshes, 0 Diagnosen', async () => {
    // Der Parser ist eine ANDERE Implementierung als die Inline-Zerlegung
    // dieser Probe — Übereinstimmung beider ist ein echter Kreuzbeweis.
    const { parseWorldMap } = await import('@webmidgar/formats-world');
    for (const [name, blocks] of [
      ['WM0.MAP', 69],
      ['WM2.MAP', 12],
      ['WM3.MAP', 4],
    ] as const) {
      const terrain = parseWorldMap(new Uint8Array(readFileSync(join(WM_DIR, name))));
      expect(terrain.diagnostics).toEqual([]);
      expect(terrain.blocks).toHaveLength(blocks);
      expect(terrain.blocks.every((b) => b !== null && b.meshes.every((m) => m !== null))).toBe(true);
    }
  });

  it('world_gm.lgp: Eintragsinventar nach Endungen (S29-Vorschau: wo liegen Script und Texte?)', async () => {
    const { IndexService } = await import('@webmidgar/io');
    const { NodeDirectorySource } = await import('./node-source.js');
    const dir = new NodeDirectorySource(REAL_DIR, ['data/wm']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const proEndung = new Map<string, { anzahl: number; bytes: number }>();
    let gesamt = 0;
    for (const entry of index.listEntries('world_gm')) {
      gesamt++;
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot).toLowerCase() : '(ohne)';
      const agg = proEndung.get(ext) ?? { anzahl: 0, bytes: 0 };
      agg.anzahl++;
      agg.bytes += entry.length ?? 0;
      proEndung.set(ext, agg);
    }
    console.log(
      'WM-LGP-INVENTAR:',
      JSON.stringify({ gesamt, proEndung: [...proEndung.entries()].sort((a, b) => b[1].bytes - a[1].bytes) }, null, 1),
    );
    await dir.closeAll();
    expect(gesamt).toBeGreaterThan(0);
  });
});
