import { describe, expect, it } from 'vitest';
import { parseWorldTextureNames } from './texture-names.js';
import { parseWorldAnimatedTextures } from './wm-ta.js';

/**
 * Fixtures werden hier ERZEUGT, nicht kopiert (Projektregel 2). Der Aufbau
 * bildet den gemessenen Originalbefund nach: PE32 mit einer Datensektion, ein
 * 4-Byte-ausgerichteter `*.tim`-Zeichenkettenvorrat und ein Zeigerfeld, in dem
 * einzelne Plätze auf einen uninitialisierten Bereich zeigen (die animierten
 * Texturen).
 */

const IMAGE_BASE = 0x400000;
const SEC_VA = 0x1000;
const SEC_RAW = 0x400;

interface PeBau {
  bytes: Uint8Array;
  tableOffset: number;
}

function bauePe(namen: Array<string | null>, bssZiel = 0x00e2d16c): PeBau {
  const strings: number[] = [];
  const pool: number[] = [];
  for (const n of namen) {
    if (n === null) {
      strings.push(-1);
      continue;
    }
    strings.push(pool.length);
    for (const c of `${n}.tim`) pool.push(c.charCodeAt(0));
    pool.push(0);
    while (pool.length % 4 !== 0) pool.push(0);
  }
  const poolRaw = SEC_RAW + 0x100;
  const tableRaw = poolRaw + Math.ceil(pool.length / 4) * 4 + 0x40;
  const total = tableRaw + namen.length * 4 + 0x100;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  const pe = 0x80;
  view.setUint32(0x3c, pe, true);
  view.setUint32(pe, 0x00004550, true);
  view.setUint16(pe + 6, 1, true); // eine Sektion
  view.setUint16(pe + 20, 0xe0, true); // optionaler Kopf
  view.setUint32(pe + 24 + 28, IMAGE_BASE, true);
  const sec = pe + 24 + 0xe0;
  view.setUint32(sec + 8, 0x200000, true); // VirtualSize (groß: BSS dahinter)
  view.setUint32(sec + 12, SEC_VA, true);
  view.setUint32(sec + 16, total - SEC_RAW, true);
  view.setUint32(sec + 20, SEC_RAW, true);

  bytes.set(pool, poolRaw);
  for (let i = 0; i < namen.length; i++) {
    const rel = strings[i]!;
    const wert = rel < 0 ? bssZiel + i * 4 : IMAGE_BASE + SEC_VA + (poolRaw + rel - SEC_RAW);
    view.setUint32(tableRaw + i * 4, wert, true);
  }
  return { bytes, tableOffset: tableRaw };
}

/** 72 Namen: genug für MIN_RUN=64, mit den zwölf Schlussnamen der Kleinkarten. */
function beispielNamen(): Array<string | null> {
  const overworld: Array<string | null> = [];
  for (let i = 0; i < 60; i++) overworld.push(i % 17 === 5 ? null : `ovw${i.toString().padStart(2, '0')}`);
  return [
    ...overworld,
    'cltr',
    'lake_a',
    'rock',
    'scave',
    'ssand',
    'swall02',
    'sng01',
    'sng02',
    'hokola01',
    'hokola02',
    'snwfldl',
    'snwfld2',
  ];
}

describe('Welt-Texturnamen aus dem PE-Abbild', () => {
  it('findet das Zeigerfeld ohne feste Adresse und trennt die drei Karten', () => {
    const namen = beispielNamen();
    const { bytes, tableOffset } = bauePe(namen);
    const t = parseWorldTextureNames(bytes)!;
    expect(t).not.toBeNull();
    expect(t.tableOffset).toBe(tableOffset);
    expect(t.names).toHaveLength(namen.length);
    expect(t.names).toEqual(namen);
    expect(t.bases).toEqual({ wm0: 0, wm2: namen.length - 12, wm3: namen.length - 4 });
    expect(t.names.slice(t.bases.wm2, t.bases.wm3)).toEqual([
      'cltr',
      'lake_a',
      'rock',
      'scave',
      'ssand',
      'swall02',
      'sng01',
      'sng02',
    ]);
    expect(t.names.slice(t.bases.wm3)).toEqual(['hokola01', 'hokola02', 'snwfldl', 'snwfld2']);
    expect(t.animatedCount).toBe(namen.filter((n) => n === null).length);
    expect(t.diagnostics).toEqual([]);
  });

  it('KONTROLLE: das Zeigerfeld verschoben gelesen ergibt keinen Lauf', () => {
    const { bytes } = bauePe(beispielNamen());
    // Ein Byte einschieben zerstört die 4-Byte-Ausrichtung aller Zeiger.
    const verschoben = new Uint8Array(bytes.length + 1);
    verschoben.set(bytes.subarray(0, 0x400), 0);
    verschoben.set(bytes.subarray(0x400), 0x401);
    // Der PE-Kopf zeigt nun auf falsche Rohversätze; erwartet wird KEIN Fund.
    expect(parseWorldTextureNames(verschoben)).toBeNull();
  });

  it('kein PE, keine Tabelle — und kein Absturz', () => {
    expect(parseWorldTextureNames(new Uint8Array(16))).toBeNull();
    expect(parseWorldTextureNames(new Uint8Array([0x4d, 0x5a, 0, 0]))).toBeNull();
  });

  it('zu kurze Tabelle wird abgelehnt statt halb geglaubt', () => {
    const { bytes } = bauePe(['a', 'b', 'c', 'd']);
    expect(parseWorldTextureNames(bytes)).toBeNull();
  });
});

// --- wm.ta -------------------------------------------------------------------

function baueWmTa(eintraege: Array<{ frames: number; speed: number }>, w16 = 8, h = 32): Uint8Array {
  const stride = 12 + w16 * h * 2 + 4;
  const tabelle = 4 + eintraege.length * 8;
  const start = Math.ceil(tabelle / 16) * 16;
  const gesamt = start + eintraege.reduce((a, e) => a + e.frames * stride, 0);
  const bytes = new Uint8Array(gesamt);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, eintraege.length, true);
  let off = start;
  eintraege.forEach((e, i) => {
    view.setUint32(4 + i * 8, off, true);
    view.setUint16(4 + i * 8 + 4, stride, true);
    view.setUint8(4 + i * 8 + 6, e.frames);
    view.setUint8(4 + i * 8 + 7, e.speed);
    for (let f = 0; f < e.frames; f++) {
      const o = off + f * stride;
      view.setUint32(o, 12 + w16 * h * 2, true);
      view.setUint16(o + 4, 400 + i * 8, true);
      view.setUint16(o + 6, 256, true);
      view.setUint16(o + 8, w16, true);
      view.setUint16(o + 10, h, true);
      for (let k = 0; k < w16 * h * 2; k++) bytes[o + 12 + k] = ((f + k) & 0x0f) | (((f + k + 1) & 0x0f) << 4);
    }
    off += e.frames * stride;
  });
  return bytes;
}

describe('wm.ta — animierte Weltkarten-Texturen', () => {
  it('4-bpp-Auslegung liefert 32×32 je Halbbild und hält das Accounting ein', () => {
    const bytes = baueWmTa([
      { frames: 8, speed: 25 },
      { frames: 4, speed: 20 },
    ]);
    const r = parseWorldAnimatedTextures(bytes);
    expect(r.diagnostics).toEqual([]);
    expect(r.textures).toHaveLength(2);
    expect(r.textures[0]!.width).toBe(32);
    expect(r.textures[0]!.height).toBe(32);
    expect(r.textures[0]!.frames).toHaveLength(8);
    expect(r.textures[0]!.speed).toBe(25);
    expect(r.textures[1]!.frames).toHaveLength(4);
    // Ein Indexbild hat genau width·height Einträge, jeder < 16.
    const idx = r.textures[0]!.frames[0]!.indices;
    expect(idx).toHaveLength(32 * 32);
    expect(Math.max(...idx)).toBeLessThan(16);
  });

  it('Nibble-Reihenfolge: unteres Halbbyte zuerst', () => {
    const bytes = baueWmTa([{ frames: 1, speed: 1 }]);
    const idx = parseWorldAnimatedTextures(bytes).textures[0]!.frames[0]!.indices;
    // Byte k trägt (f+k)&15 unten und (f+k+1)&15 oben, f = 0.
    expect(idx[0]).toBe(0);
    expect(idx[1]).toBe(1);
    expect(idx[2]).toBe(1);
    expect(idx[3]).toBe(2);
  });

  it('verletztes Accounting quarantäniert das Halbbild statt zu erfinden', () => {
    const bytes = baueWmTa([{ frames: 2, speed: 5 }]);
    const view = new DataView(bytes.buffer);
    const off = view.getUint32(4, true);
    view.setUint32(off, 999, true); // bnum verfälschen
    const r = parseWorldAnimatedTextures(bytes);
    expect(r.diagnostics.length).toBe(1);
    expect(r.textures[0]!.frames).toHaveLength(1);
  });
});
