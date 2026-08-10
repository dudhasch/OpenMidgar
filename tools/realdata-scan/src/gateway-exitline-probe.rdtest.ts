import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { decompressLzs, decompressLzsEntry, parseFieldEntry, type FieldBundle } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * F15-Probe (Austrittslinie der Gateways): Die bisherige Lesart
 * (Recordbeginn bei Sektionsoffset 36, Vec3 = [x,y,z] i16 ab Record-Offset 0
 * bzw. 6) liefert in der Demo Linien, die quer über die Karte laufen und vom
 * Spieler nie gequert werden. Verdacht: Recordbeginn und/oder Achszuordnung
 * verschoben — konkret sieht der 36er-Header nach 32 aus (BG-Parameterblock
 * 12 statt 16 Bytes), was alle Gateway-Records um 4 Bytes verschieben würde,
 * die Ziel-Field-Nummer aber an denselben ABSOLUTEN Bytes ließe
 * (36+24g+14 == 32+24g+18).
 *
 * Messung statt Raten: Für jede Kombination aus Recordverschiebung
 * s ∈ {−4,−2,0,+2,+4} (relativ zur bisherigen Basis 36) und Achspermutation
 * (alle 6) wird über ALLE Fields die Gütefunktion gemessen:
 *   Anteil der belegten Gateways, deren BEIDE Linien-Endpunkte
 *   (a) im Grundriss in der XY-BoundingBox des eigenen Walkmeshes liegen
 *       (+Toleranz),
 *   (b) deren Höhenkomponente im Höhenband des Walkmeshes liegt (+Toleranz),
 *   (c) und deren Linienlänge < 25 % der Walkmesh-Diagonale ist.
 * Kontrollhypothesen sind die verwürfelten Achszuordnungen und die falschen
 * Verschiebungen selbst — sie müssen deutlich schlechter abschneiden.
 *
 * Konsistenzanker: Je Verschiebung wird die Rückkantenquote des
 * Zielfield-Graphen (dest u16 an den UNVERÄNDERTEN absoluten Bytes
 * 36+24g+14, V1 = 0-basierter maplist-Index) gegen das Kontrollniveau
 * (Zielvertauschung um +37) nachgemessen — die S8/S11-Belegung darf unter
 * der neuen Deutung nicht schlechter werden. Ebenso wird die
 * Slot-Belegungszahl (bisher 1095) je Verschiebung berichtet.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const OLD_GW_BASE = 36;
const GW_LEN = 24;
const GW_COUNT = 12;
const SHIFTS = [-4, -2, 0, 2, 4, 16, 18, 20, 22, 24] as const;
const CONTROL_SHIFT = 37;

/** Alle 6 Achspermutationen: perm[i] = Index des gespeicherten Worts, das Achse i (x,y,z) liefert. */
const PERMS: { name: string; p: [number, number, number] }[] = [
  { name: 'xyz', p: [0, 1, 2] },
  { name: 'xzy', p: [0, 2, 1] },
  { name: 'yxz', p: [1, 0, 2] },
  { name: 'yzx', p: [1, 2, 0] },
  { name: 'zxy', p: [2, 0, 1] },
  { name: 'zyx', p: [2, 1, 0] },
];

interface WmStats {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  diag: number;
}

function walkmeshStats(bundle: FieldBundle): WmStats | null {
  if (!bundle.walkmesh) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let any = false;
  for (const tri of bundle.walkmesh.triangles) {
    if (tri.degenerate) continue;
    for (const v of tri.vertices) {
      any = true;
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  if (!any) return null;
  const diag = Math.hypot(maxX - minX, maxY - minY);
  return { minX, maxX, minY, maxY, minZ, maxZ, diag };
}

function decodeFixedNames(bytes: Uint8Array, headerLen: number, nameLen: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = headerLen + i * nameLen;
    let s = '';
    for (let k = 0; k < nameLen; k++) {
      const b = bytes[start + k] ?? 0;
      if (b === 0) break;
      s += String.fromCharCode(b);
    }
    out.push(s);
  }
  return out;
}

describe.skipIf(!available)('Realdaten: Gateway-Austrittslinie — Recordbasis × Achszuordnung (F15)', () => {
  it('Gütefunktion je (Verschiebung, Permutation) + Rückkanten-Anker je Verschiebung', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const flevelEntries = index.listEntries('flevel').filter((e) => !e.name.includes('.'));
    const bundles: FieldBundle[] = [];
    const bundleNames: string[] = [];
    const bundleIdxByName = new Map<string, number>();
    for (const entry of flevelEntries) {
      if (entry.name === 'maplist') continue;
      try {
        const parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        if (parsed.ok && parsed.bundle) {
          bundleIdxByName.set(entry.name.toLowerCase(), bundles.length);
          bundleNames.push(entry.name.toLowerCase());
          bundles.push(parsed.bundle);
        }
      } catch {
        /* Nicht-Fields überspringen */
      }
    }

    // maplist dekodieren (Muster aus gateway3-probe: raw / LZS-Varianten).
    let maplistToName: string[] = [];
    const maplistEntry = flevelEntries.find((e) => e.name === 'maplist');
    if (maplistEntry) {
      const raw = await index.readEntry(maplistEntry.canonicalId);
      const candidates: Uint8Array[] = [raw];
      try {
        candidates.push(decompressLzsEntry(raw));
      } catch { /* kein u32+LZS */ }
      try {
        candidates.push(decompressLzs(raw));
      } catch { /* kein reiner LZS */ }
      let bestRate = 0;
      for (const bytes of candidates) {
        if (bytes.length < 2) continue;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const count = view.getUint16(0, true);
        if (2 + count * 32 > bytes.length) continue;
        const names = decodeFixedNames(bytes, 2, 32, count);
        const hits = names.filter((n) => bundleIdxByName.has(n.toLowerCase())).length;
        const rate = count > 0 ? hits / count : 0;
        if (rate > bestRate) {
          bestRate = rate;
          maplistToName = names;
        }
      }
    }

    const stats = bundles.map((b) => walkmeshStats(b));

    interface ComboResult {
      shift: number;
      perm: string;
      geprueft: number;
      passAll: number;
      failBBox: number;
      failHoehe: number;
      failLaenge: number;
    }
    const combos: ComboResult[] = [];
    const perShift: {
      shift: number;
      belegteSlots: number;
      rueckkante: string;
      kontrolle: string;
      kanten: number;
    }[] = [];

    for (const shift of SHIFTS) {
      // Belegte Slots unter dieser Recordbasis einsammeln.
      interface Rec {
        words: [number, number, number, number, number, number];
        ownerIdx: number;
        slot: number;
        destRaw: number;
      }
      const occupied: Rec[] = [];
      for (let fieldIdx = 0; fieldIdx < bundles.length; fieldIdx++) {
        const raw = bundles[fieldIdx]!.rawSections[8];
        if (!raw) continue;
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        for (let g = 0; g < GW_COUNT; g++) {
          const base = OLD_GW_BASE + shift + g * GW_LEN;
          if (base < 0 || base + GW_LEN > raw.length) continue;
          const words = [0, 1, 2, 3, 4, 5].map((k) => view.getInt16(base + k * 2, true)) as Rec['words'];
          const degenerate = words[0] === words[3] && words[1] === words[4] && words[2] === words[5];
          if (degenerate) continue;
          // dest als u16@18 RELATIV zur getesteten Recordbasis (Layout:
          // exitLine @0..11, destination @12..17, destFieldId @18, dir @20..23).
          const destRaw = base + 20 <= raw.length ? view.getUint16(base + 18, true) : 0xffff;
          occupied.push({ words, ownerIdx: fieldIdx, slot: g, destRaw });
        }
      }

      // --- Gütefunktion je Permutation. -----------------------------------
      for (const { name, p } of PERMS) {
        let geprueft = 0;
        let passAll = 0;
        let failBBox = 0;
        let failHoehe = 0;
        let failLaenge = 0;
        for (const rec of occupied) {
          const s = stats[rec.ownerIdx];
          if (!s || s.diag <= 0) continue;
          geprueft++;
          const tolXY = Math.max(100, s.diag * 0.05);
          const tolZ = Math.max(200, (s.maxZ - s.minZ) * 0.25);
          const ax = rec.words[p[0]]!, ay = rec.words[p[1]]!, az = rec.words[p[2]]!;
          const bx = rec.words[3 + p[0]]!, by = rec.words[3 + p[1]]!, bz = rec.words[3 + p[2]]!;
          const inBox = (x: number, y: number): boolean =>
            x >= s.minX - tolXY && x <= s.maxX + tolXY && y >= s.minY - tolXY && y <= s.maxY + tolXY;
          const inZ = (z: number): boolean => z >= s.minZ - tolZ && z <= s.maxZ + tolZ;
          const okBox = inBox(ax, ay) && inBox(bx, by);
          const okZ = inZ(az) && inZ(bz);
          const okLen = Math.hypot(bx - ax, by - ay) < s.diag * 0.25;
          if (!okBox) failBBox++;
          if (!okZ) failHoehe++;
          if (!okLen) failLaenge++;
          if (okBox && okZ && okLen) passAll++;
        }
        combos.push({ shift, perm: name, geprueft, passAll, failBBox, failHoehe, failLaenge });
      }

      // --- Rückkanten-Anker (dest bleibt an den alten absoluten Bytes). ----
      const edges: (number | undefined)[] = occupied.map((rec) => {
        const nm = maplistToName[rec.destRaw];
        return nm ? bundleIdxByName.get(nm.toLowerCase()) : undefined;
      });
      const adjacency = new Set<string>();
      for (let i = 0; i < occupied.length; i++) {
        const dst = edges[i];
        if (dst === undefined) continue;
        adjacency.add(`${occupied[i]!.ownerIdx}->${dst}`);
      }
      let back = 0;
      let checked = 0;
      for (let i = 0; i < occupied.length; i++) {
        const dst = edges[i];
        if (dst === undefined || dst === occupied[i]!.ownerIdx) continue;
        checked++;
        if (adjacency.has(`${dst}->${occupied[i]!.ownerIdx}`)) back++;
      }
      const controlAdj = new Set<string>();
      for (let i = 0; i < occupied.length; i++) {
        const dst = edges[(i + CONTROL_SHIFT) % occupied.length];
        if (dst === undefined) continue;
        controlAdj.add(`${occupied[i]!.ownerIdx}->${dst}`);
      }
      let cBack = 0;
      let cChecked = 0;
      for (let i = 0; i < occupied.length; i++) {
        const dst = edges[(i + CONTROL_SHIFT) % occupied.length];
        if (dst === undefined || dst === occupied[i]!.ownerIdx) continue;
        cChecked++;
        if (controlAdj.has(`${dst}->${occupied[i]!.ownerIdx}`)) cBack++;
      }
      perShift.push({
        shift,
        belegteSlots: occupied.length,
        rueckkante: checked > 0 ? `${((back / checked) * 100).toFixed(1)}%` : 'n/a',
        kontrolle: cChecked > 0 ? `${((cBack / cChecked) * 100).toFixed(1)}%` : 'n/a',
        kanten: checked,
      });
    }

    const pct = (a: number, b: number): string => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');
    const tabelle = combos
      .map((c) => ({
        shift: c.shift,
        perm: c.perm,
        geprueft: c.geprueft,
        guete: pct(c.passAll, c.geprueft),
        failBBox: pct(c.failBBox, c.geprueft),
        failHoehe: pct(c.failHoehe, c.geprueft),
        failLaenge: pct(c.failLaenge, c.geprueft),
      }))
      .sort((a, b) => parseFloat(b.guete) - parseFloat(a.guete));

    // --- Stichprobe md1stin: belegte Linien unter alter und bester Deutung. --
    const best = combos.slice().sort((a, b) => b.passAll / (b.geprueft || 1) - a.passAll / (a.geprueft || 1))[0]!;
    const mdIdx = bundleIdxByName.get('md1stin');
    let stichprobe: unknown = null;
    if (mdIdx !== undefined) {
      const raw = bundles[mdIdx]!.rawSections[8]!;
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const readLine = (shift: number): { slot: number; a: number[]; b: number[]; destRaw: number }[] => {
        const out: { slot: number; a: number[]; b: number[]; destRaw: number }[] = [];
        for (let g = 0; g < GW_COUNT; g++) {
          const base = OLD_GW_BASE + shift + g * GW_LEN;
          const words = [0, 1, 2, 3, 4, 5].map((k) => view.getInt16(base + k * 2, true));
          if (words[0] === words[3] && words[1] === words[4] && words[2] === words[5]) continue;
          out.push({
            slot: g,
            a: words.slice(0, 3),
            b: words.slice(3, 6),
            destRaw: view.getUint16(base + 18, true),
          });
        }
        return out;
      };
      stichprobe = {
        walkmesh: stats[mdIdx],
        alteLesart: readLine(0),
        besteLesart: { shift: best.shift, perm: best.perm, linien: readLine(best.shift) },
      };
    }

    // --- Zweitmessung: Trigger-Volumen (16-B-Records direkt nach den 12
    // Gateways). Verschiebt sich die Gateway-Basis, verschiebt sich auch die
    // Trigger-Basis — dieselbe Gütefunktion bestätigt (oder verwirft) das.
    const TR_LEN = 16;
    const TR_COUNT = 12;
    const TR_BASES = [316, 318, 320, 322, 324, 326, 328, 332, 336, 340, 344, 348, 352, 356] as const;
    const triggerTabelle: { base: number; belegte: number; guete: string; failBBox: string; failHoehe: string; failLaenge: string }[] = [];
    for (const trBase0 of TR_BASES) {
      let geprueft = 0;
      let passAll = 0;
      let failBBox = 0;
      let failHoehe = 0;
      let failLaenge = 0;
      for (let fieldIdx = 0; fieldIdx < bundles.length; fieldIdx++) {
        const raw = bundles[fieldIdx]!.rawSections[8];
        const s = stats[fieldIdx];
        if (!raw || !s || s.diag <= 0) continue;
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        for (let t = 0; t < TR_COUNT; t++) {
          const base = trBase0 + t * TR_LEN;
          if (base < 0 || base + TR_LEN > raw.length) continue;
          const w = [0, 1, 2, 3, 4, 5].map((k) => view.getInt16(base + k * 2, true));
          if (w[0] === w[3] && w[1] === w[4] && w[2] === w[5]) continue;
          geprueft++;
          const tolXY = Math.max(100, s.diag * 0.05);
          const tolZ = Math.max(200, (s.maxZ - s.minZ) * 0.25);
          const inBox = (x: number, y: number): boolean =>
            x >= s.minX - tolXY && x <= s.maxX + tolXY && y >= s.minY - tolXY && y <= s.maxY + tolXY;
          const okBox = inBox(w[0]!, w[1]!) && inBox(w[3]!, w[4]!);
          const okZ = w[2]! >= s.minZ - tolZ && w[2]! <= s.maxZ + tolZ && w[5]! >= s.minZ - tolZ && w[5]! <= s.maxZ + tolZ;
          const okLen = Math.hypot(w[3]! - w[0]!, w[4]! - w[1]!) < s.diag * 0.25;
          if (!okBox) failBBox++;
          if (!okZ) failHoehe++;
          if (!okLen) failLaenge++;
          if (okBox && okZ && okLen) passAll++;
        }
      }
      triggerTabelle.push({
        base: trBase0,
        belegte: geprueft,
        guete: pct(passAll, geprueft),
        failBBox: pct(failBBox, geprueft),
        failHoehe: pct(failHoehe, geprueft),
        failLaenge: pct(failLaenge, geprueft),
      });
    }

    console.log(
      'Austrittslinien-Probe:',
      JSON.stringify(
        {
          fields: bundles.length,
          sektionsLaengen: bundles.reduce(
            (acc, b) => {
              const len = b.rawSections[8]?.length ?? 0;
              return { min: Math.min(acc.min, len), max: Math.max(acc.max, len) };
            },
            { min: Infinity, max: 0 },
          ),
          tabelle,
          rueckkantenAnkerJeShift: perShift,
          triggerVolumenJeShift: triggerTabelle,
          stichprobeMd1stin: stichprobe,
        },
        null,
        2,
      ),
    );

    // Alignment-Sichtprüfung (nur lokal, nicht committete Ausgabe): Hexdump
    // der Triggersektion eines Beispielfields, um Recordgrenzen zu sehen.
    if (process.env['WEBMIDGAR_DUMP'] && mdIdx !== undefined) {
      const raw = bundles[mdIdx]!.rawSections[8]!;
      const lines: string[] = [];
      for (let o = 0; o < raw.length; o += 16) {
        const chunk = [...raw.subarray(o, o + 16)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
        lines.push(`${String(o).padStart(4, ' ')}: ${chunk}`);
      }
      console.log(`md1stin Sektion 8 (${raw.length} B):\n${lines.join('\n')}`);
    }

    expect(bundles.length).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
