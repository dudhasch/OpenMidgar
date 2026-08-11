import { describe, expect, it } from 'vitest';
import { ShelfPacker, blitRgba, blitRgbaWithBleed } from './shelf-packer.js';

describe('ShelfPacker', () => {
  it('legt gleich große Kacheln zeilenweise ab und wechselt die Seite erst bei Bedarf', () => {
    const p = new ShelfPacker(64, 0);
    const plaetze = Array.from({ length: 20 }, () => p.place(16, 16)!);
    // 64/16 = 4 je Zeile, 4 Zeilen je Seite ⇒ 16 Kacheln, dann Seite 1.
    expect(plaetze[0]).toEqual({ atlas: 0, x: 0, y: 0 });
    expect(plaetze[3]).toEqual({ atlas: 0, x: 48, y: 0 });
    expect(plaetze[4]).toEqual({ atlas: 0, x: 0, y: 16 });
    expect(plaetze[15]).toEqual({ atlas: 0, x: 48, y: 48 });
    expect(plaetze[16]).toEqual({ atlas: 1, x: 0, y: 0 });
    expect(p.atlasCount).toBe(2);
  });

  it('Polsterung verschiebt den Nutzbereich und reserviert Platz ringsum', () => {
    const p = new ShelfPacker(64, 4);
    const a = p.place(16, 16)!;
    const b = p.place(16, 16)!;
    expect(a).toEqual({ atlas: 0, x: 4, y: 4 });
    // 16 + 2·4 = 24 Byte Vorschub, danach wieder 4 Polsterung.
    expect(b).toEqual({ atlas: 0, x: 28, y: 4 });
  });

  it('meldet ein Rechteck, das auch allein nicht auf eine Seite passt', () => {
    const p = new ShelfPacker(32, 4);
    expect(p.place(32, 32)).toBeNull(); // 32 + 8 > 32
    expect(p.place(24, 24)).not.toBeNull();
  });

  it('Kontrolle: ohne Polsterung überlappen die Zellen nie', () => {
    const p = new ShelfPacker(128, 0);
    const rects: Array<{ a: number; x: number; y: number; w: number; h: number }> = [];
    const groessen = [16, 32, 16, 64, 32, 16, 32, 64, 16, 16, 32, 16];
    for (const g of groessen) {
      const s = p.place(g, g)!;
      rects.push({ a: s.atlas, x: s.x, y: s.y, w: g, h: g });
    }
    let ueber = 0;
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        if (a.a === b.a && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) ueber++;
      }
    expect(ueber).toBe(0);
  });
});

describe('Edge-Bleed', () => {
  it('repliziert Randpixel in die Polsterung, statt sie transparent zu lassen', () => {
    const size = 16;
    const ziel = new Uint8Array(size * size * 4);
    // 2×2-Quelle mit vier unterscheidbaren Farben.
    const src = new Uint8Array([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255]);
    blitRgbaWithBleed(ziel, size, src, 2, 2, 4, 4, 2);
    const rot = (x: number, y: number): number => ziel[(y * size + x) * 4]!;
    const alpha = (x: number, y: number): number => ziel[(y * size + x) * 4 + 3]!;
    // Nutzbereich unverändert.
    expect(rot(4, 4)).toBe(10);
    expect(rot(5, 5)).toBe(40);
    // Links/oben davon steht der geklemmte Randpixel, NICHT 0.
    expect(rot(2, 2)).toBe(10);
    expect(rot(3, 4)).toBe(10);
    expect(rot(7, 7)).toBe(40);
    // Kontrolle: die Polsterung ist undurchsichtig — sonst frisst alphaTest die Ränder.
    expect(alpha(2, 2)).toBe(255);
    expect(alpha(7, 7)).toBe(255);
  });

  it('blitRgba schreibt ohne Polsterung an dieselbe Stelle', () => {
    const size = 8;
    const ziel = new Uint8Array(size * size * 4);
    const src = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]); // 2×1
    blitRgba(ziel, size, src, 2, 1, 3, 2);
    expect([...ziel.subarray((2 * size + 3) * 4, (2 * size + 3) * 4 + 8)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
